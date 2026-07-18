import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  AssetIntegrityError,
} from '../lib/asset-storage.js';
import {
  AssetSourceChangedError,
  acquireAssetWriteLocks,
  calculateSHA256,
  registerAsset,
  repairAssetRecordWithBuffer,
} from '../lib/assets.js';

function normalizedSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

class FakeLockManager {
  constructor() {
    this.owners = new Map();
    this.waiters = new Map();
  }

  async acquire(key, owner) {
    if (!this.owners.has(key)) {
      this.owners.set(key, owner);
      return;
    }
    await new Promise(resolve => {
      const waiters = this.waiters.get(key) || [];
      waiters.push({ owner, resolve });
      this.waiters.set(key, waiters);
    });
  }

  release(key, owner) {
    if (this.owners.get(key) !== owner) return false;
    const waiters = this.waiters.get(key) || [];
    const next = waiters.shift();
    if (next) {
      this.owners.set(key, next.owner);
      if (waiters.length) this.waiters.set(key, waiters);
      else this.waiters.delete(key);
      next.resolve();
    } else {
      this.owners.delete(key);
    }
    return true;
  }
}

class FakeAssetConnection {
  constructor(database) {
    this.database = database;
    this.transactionActive = false;
    this.transactionLocks = new Set();
    this.released = false;
    this.destroyed = false;
  }

  async execute(sql, params = []) {
    return this.database.executeSql(this, sql, params);
  }

  async beginTransaction() {
    assert.equal(this.transactionActive, false);
    if (this.database.failBegin) throw new Error('lost BEGIN response');
    this.transactionActive = true;
    this.database.activeTransactions += 1;
  }

  finishTransaction() {
    if (!this.transactionActive) return;
    this.transactionActive = false;
    this.database.activeTransactions -= 1;
    for (const key of this.transactionLocks) this.database.rowLocks.release(key, this);
    this.transactionLocks.clear();
  }

  async commit() {
    this.finishTransaction();
  }

  async rollback() {
    this.finishTransaction();
  }

  release() {
    this.released = true;
  }

  async destroy() {
    this.finishTransaction();
    this.destroyed = true;
  }
}

class FakeAssetDatabase {
  constructor() {
    this.rows = [];
    this.audits = [];
    this.nextId = 1;
    this.activeTransactions = 0;
    this.failBegin = false;
    this.namedLocks = new FakeLockManager();
    this.rowLocks = new FakeLockManager();
    this.connections = [];
  }

  seed(row) {
    const seeded = {
      id: this.nextId++,
      discovery_source_id: 1,
      source_url: null,
      resolved_url: null,
      url: null,
      original_filename: 'asset.pdf',
      asset_kind: 'manual_fetch',
      content_type: 'application/pdf',
      file_size: 1,
      sha256_checksum: null,
      checksum: null,
      local_storage_path: null,
      storage_provider: 'r2',
      storage_key: null,
      storage_etag: null,
      storage_verified_at: new Date(),
      storage_path: null,
      downloaded_at: new Date(),
      fetched_at: new Date(),
      download_status: 'stored',
      status: 'fetched',
      duplicate_of_asset_id: null,
      supersedes_asset_id: null,
      metadata_json: null,
      ...row,
    };
    this.rows.push(seeded);
    return seeded;
  }

  async execute(sql, params = []) {
    return this.executeSql(null, sql, params);
  }

  async getConnection() {
    const connection = new FakeAssetConnection(this);
    this.connections.push(connection);
    return connection;
  }

  async executeSql(connection, sql, params) {
    const query = normalizedSql(sql);

    if (query.includes('GET_LOCK')) {
      assert.equal(params[0].length, 64, 'asset advisory lock names must fit MySQL limits');
      await this.namedLocks.acquire(params[0], connection);
      return [[{ acquired: 1 }]];
    }
    if (query.includes('RELEASE_LOCK')) {
      return [[{ released: this.namedLocks.release(params[0], connection) ? 1 : 0 }]];
    }
    if (query.startsWith('SELECT id FROM discovery_sources WHERE id = ? FOR UPDATE')) {
      const key = `source:${params[0]}`;
      if (!connection.transactionLocks.has(key)) {
        await this.rowLocks.acquire(key, connection);
        connection.transactionLocks.add(key);
      }
      return [[{ id: params[0] }]];
    }
    if (query.startsWith('SELECT id FROM discovery_sources WHERE id = ?')) {
      return [[{ id: params[0] }]];
    }
    if (query.includes('FROM source_assets sa') && query.includes('sa.sha256_checksum = ?')) {
      const checksum = params[0];
      const excludedId = query.includes('sa.id <> ?') ? Number(params[1]) : null;
      const provider = query.includes('sa.storage_provider = ?') ? params.at(-1) : null;
      const rows = this.rows
        .filter(row => row.sha256_checksum === checksum)
        .filter(row => excludedId == null || Number(row.id) !== excludedId)
        .filter(row => ['stored', 'duplicate'].includes(row.download_status))
        .filter(row => !provider || row.storage_provider === provider)
        .sort((left, right) => {
          const leftDuplicate = left.duplicate_of_asset_id == null ? 0 : 1;
          const rightDuplicate = right.duplicate_of_asset_id == null ? 0 : 1;
          return leftDuplicate - rightDuplicate || Number(left.id) - Number(right.id);
        });
      return [rows.map(row => ({ ...row }))];
    }
    if (query.startsWith('SELECT * FROM source_assets WHERE discovery_source_id = ?')) {
      const sourceId = Number(params[0]);
      const identities = new Set(params.slice(1).filter(Boolean));
      const rows = this.rows
        .filter(row => Number(row.discovery_source_id) === sourceId)
        .filter(row => [row.source_url, row.resolved_url, row.url].some(value => identities.has(value)))
        .sort((left, right) => Number(right.id) - Number(left.id));
      return [rows.length ? [{ ...rows[0] }] : []];
    }
    if (query.startsWith('SELECT * FROM source_assets WHERE supersedes_asset_id = ?')) {
      const rows = this.rows
        .filter(row => Number(row.supersedes_asset_id) === Number(params[0]))
        .sort((left, right) => Number(left.id) - Number(right.id));
      return [rows.map(row => ({ ...row }))];
    }
    if (query.startsWith('SELECT * FROM source_assets WHERE id = ?')) {
      const row = this.rows.find(candidate => Number(candidate.id) === Number(params[0]));
      return [row ? [{ ...row }] : []];
    }
    if (query.startsWith('INSERT INTO source_assets')) {
      const versioned = query.includes('supersedes_asset_id');
      const row = this.seed({
        discovery_source_id: params[0],
        source_url: params[1],
        resolved_url: params[2],
        url: params[3],
        original_filename: params[4],
        asset_kind: params[5],
        content_type: params[6],
        file_size: params[7],
        sha256_checksum: params[8],
        checksum: params[9],
        etag: params[10],
        last_modified: params[11],
        local_storage_path: params[12],
        storage_provider: params[13],
        storage_key: params[14],
        storage_etag: params[15],
        storage_verified_at: params[16],
        storage_path: params[17],
        download_status: params[18],
        status: params[19],
        duplicate_of_asset_id: params[20],
        supersedes_asset_id: versioned ? params[21] : null,
        metadata_json: versioned ? params[22] : null,
      });
      if (versioned) {
        const sibling = this.rows.find(candidate => (
          Number(candidate.id) !== Number(row.id)
          && Number(candidate.supersedes_asset_id) === Number(row.supersedes_asset_id)
        ));
        assert.equal(sibling, undefined, 'unique supersedes_asset_id invariant must hold');
      }
      return [{ insertId: row.id }];
    }
    if (query.startsWith('UPDATE source_assets SET')) {
      const row = this.rows.find(candidate => Number(candidate.id) === Number(params.at(-1)));
      assert.ok(row, 'updated asset must exist');
      Object.assign(row, {
        original_filename: params[0],
        asset_kind: params[1],
        resolved_url: params[2],
        content_type: params[3],
        file_size: params[4],
        sha256_checksum: params[5],
        checksum: params[6],
        etag: params[7],
        last_modified: params[8],
        local_storage_path: params[9],
        storage_provider: params[10],
        storage_key: params[11],
        storage_etag: params[12],
        storage_verified_at: params[13],
        storage_path: params[14],
        download_status: params[15],
        status: params[16],
        duplicate_of_asset_id: params[17],
        metadata_json: params[18],
      });
      return [{ affectedRows: 1 }];
    }
    if (query.startsWith('INSERT INTO audit_log')) {
      this.audits.push({ query, params });
      return [{ insertId: this.audits.length }];
    }

    throw new Error(`Fake database does not implement query: ${query}`);
  }
}

class TransactionAwareStorage {
  constructor(database) {
    this.database = database;
    this.provider = 'r2';
    this.objects = new Map();
    this.invalidKeys = new Set();
    this.putCount = 0;
    this.recoveryCount = 0;
  }

  assertOutsideTransaction() {
    assert.equal(this.database.activeTransactions, 0, 'storage I/O must remain outside SQL transactions');
  }

  async exists({ key, expectedSha256 }) {
    this.assertOutsideTransaction();
    if (this.invalidKeys.has(key)) {
      throw new AssetIntegrityError('corrupt test object', 'checksum_mismatch');
    }
    return this.objects.get(key)?.checksum === expectedSha256;
  }

  async putImmutable({ body, sha256 }) {
    this.assertOutsideTransaction();
    this.putCount += 1;
    const key = `source-assets/sha256/${sha256.slice(0, 2)}/${sha256}`;
    this.objects.set(key, { body: Buffer.from(body), checksum: sha256 });
    return { provider: this.provider, key, etag: `etag-${sha256.slice(0, 8)}`, verifiedAt: new Date() };
  }

  async putRecoveryImmutable({ body, sha256 }) {
    this.assertOutsideTransaction();
    this.recoveryCount += 1;
    const key = `source-assets/recovery/${sha256}/${this.recoveryCount}`;
    this.objects.set(key, { body: Buffer.from(body), checksum: sha256 });
    return { provider: this.provider, key, etag: `recovery-${this.recoveryCount}`, verifiedAt: new Date() };
  }
}

const root = '/tmp/fake-jntustack-assets';
const upload = (database, storage, overrides = {}) => registerAsset({
  root,
  discoverySourceId: 1,
  sourceUrl: 'https://official.example/a.pdf',
  resolvedUrl: 'https://official.example/a.pdf',
  originalFilename: 'a.pdf',
  contentType: 'application/pdf',
  buffer: Buffer.from('identical official bytes'),
  storage,
  database,
  actor: 'test:asset-concurrency',
  ...overrides,
});

{
  const database = new FakeAssetDatabase();
  const storage = new TransactionAwareStorage(database);
  const [first, second] = await Promise.all([
    upload(database, storage, { sourceUrl: 'https://official.example/a.pdf' }),
    upload(database, storage, {
      sourceUrl: 'https://official.example/b.pdf',
      resolvedUrl: 'https://official.example/b.pdf',
    }),
  ]);
  assert.equal(database.rows.length, 2);
  assert.deepEqual(database.rows.map(row => row.download_status).sort(), ['duplicate', 'stored']);
  assert.deepEqual([first.duplicateDetected, second.duplicateDetected].sort(), [false, true]);
  const duplicate = database.rows.find(row => row.download_status === 'duplicate');
  const canonical = database.rows.find(row => row.download_status === 'stored');
  assert.equal(Number(duplicate.duplicate_of_asset_id), Number(canonical.id));
  assert.equal(storage.putCount, 1, 'checksum lock should serialize immutable storage preparation');
}

{
  const database = new FakeAssetDatabase();
  const storage = new TransactionAwareStorage(database);
  const body = Buffer.from('identical official bytes');
  const checksum = calculateSHA256(body);
  const corruptKey = `source-assets/sha256/${checksum.slice(0, 2)}/${checksum}`;
  const corrupt = database.seed({
    source_url: 'https://official.example/corrupt.pdf',
    resolved_url: 'https://official.example/corrupt.pdf',
    url: 'https://official.example/corrupt.pdf',
    sha256_checksum: checksum,
    checksum,
    storage_key: corruptKey,
  });
  storage.invalidKeys.add(corruptKey);
  await Promise.all([
    upload(database, storage, {
      sourceUrl: 'https://official.example/recovery-a.pdf',
      resolvedUrl: 'https://official.example/recovery-a.pdf',
    }),
    upload(database, storage, {
      sourceUrl: 'https://official.example/recovery-b.pdf',
      resolvedUrl: 'https://official.example/recovery-b.pdf',
    }),
  ]);
  assert.equal(storage.recoveryCount, 1, 'concurrent recovery must materialize one verified recovery object');
  const created = database.rows.filter(row => Number(row.id) !== Number(corrupt.id));
  assert.deepEqual(created.map(row => row.download_status).sort(), ['duplicate', 'stored']);
  const canonical = created.find(row => row.download_status === 'stored');
  const duplicate = created.find(row => row.download_status === 'duplicate');
  assert.equal(Number(duplicate.duplicate_of_asset_id), Number(canonical.id));
  assert.notEqual(Number(duplicate.duplicate_of_asset_id), Number(corrupt.id));
}

{
  const database = new FakeAssetDatabase();
  const storage = new TransactionAwareStorage(database);
  const results = await Promise.all([upload(database, storage), upload(database, storage)]);
  assert.equal(database.rows.length, 1, 'same URL and bytes must reuse one row');
  assert.equal(results[0].asset.id, results[1].asset.id);
  assert.deepEqual(results.map(result => Boolean(result.reused)).sort(), [false, true]);
  assert.deepEqual(results.map(result => result.duplicateDetected).sort(), [false, true]);
}

{
  const database = new FakeAssetDatabase();
  const storage = new TransactionAwareStorage(database);
  const finalUrl = 'https://official.example/canonical.pdf';
  const results = await Promise.all([
    upload(database, storage, {
      sourceUrl: 'https://official.example/redirect-one',
      resolvedUrl: finalUrl,
    }),
    upload(database, storage, {
      sourceUrl: 'https://official.example/redirect-two',
      resolvedUrl: finalUrl,
    }),
  ]);
  assert.equal(database.rows.length, 1, 'different requests resolving to one URL must reuse one row');
  assert.equal(results[0].asset.id, results[1].asset.id);
  assert.deepEqual(results.map(result => result.duplicateDetected).sort(), [false, true]);
}

{
  const database = new FakeAssetDatabase();
  const storage = new TransactionAwareStorage(database);
  const outcomes = await Promise.allSettled([
    upload(database, storage, { buffer: Buffer.from('source version one') }),
    upload(database, storage, { buffer: Buffer.from('source version two') }),
  ]);
  assert.equal(database.rows.length, 1, 'changed bytes for one source identity must not create an unlinked row');
  assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
  const rejected = outcomes.find(outcome => outcome.status === 'rejected');
  assert.ok(rejected.reason instanceof AssetSourceChangedError);
}

function seedOriginal(database, storage) {
  const body = Buffer.from('original asset bytes');
  const checksum = calculateSHA256(body);
  const key = `source-assets/sha256/${checksum.slice(0, 2)}/${checksum}`;
  storage.objects.set(key, { body, checksum });
  return database.seed({
    source_url: 'https://official.example/versioned.pdf',
    resolved_url: 'https://official.example/versioned.pdf',
    url: 'https://official.example/versioned.pdf',
    file_size: body.length,
    sha256_checksum: checksum,
    checksum,
    storage_key: key,
  });
}

const repair = (database, storage, assetId, buffer) => repairAssetRecordWithBuffer({
  root,
  assetId,
  originalFilename: 'versioned.pdf',
  contentType: 'application/pdf',
  buffer,
  finalUrl: 'https://official.example/versioned.pdf',
  storage,
  database,
  actor: 'test:asset-concurrency',
  reason: 'test_changed_bytes',
});

{
  const database = new FakeAssetDatabase();
  const storage = new TransactionAwareStorage(database);
  const original = seedOriginal(database, storage);
  const changed = Buffer.from('same concurrent repair bytes');
  const results = await Promise.all([
    repair(database, storage, original.id, changed),
    repair(database, storage, original.id, changed),
  ]);
  assert.equal(database.rows.length, 2, 'identical concurrent repairs must reuse one version');
  assert.equal(database.rows.filter(row => Number(row.supersedes_asset_id) === original.id).length, 1);
  assert.equal(results[0].asset.id, results[1].asset.id);
  assert.deepEqual(results.map(result => Boolean(result.reused)).sort(), [false, true]);
}

{
  const database = new FakeAssetDatabase();
  const storage = new TransactionAwareStorage(database);
  const original = seedOriginal(database, storage);
  await Promise.all([
    repair(database, storage, original.id, Buffer.from('concurrent repair B')),
    repair(database, storage, original.id, Buffer.from('concurrent repair C')),
  ]);
  assert.equal(database.rows.length, 3);
  const firstGeneration = database.rows.filter(row => Number(row.supersedes_asset_id) === original.id);
  assert.equal(firstGeneration.length, 1, 'changed concurrent repairs must not create sibling versions');
  const secondGeneration = database.rows.filter(
    row => Number(row.supersedes_asset_id) === Number(firstGeneration[0].id)
  );
  assert.equal(secondGeneration.length, 1, 'the second changed repair must extend the locked lineage tail');
}

{
  const database = new FakeAssetDatabase();
  const storage = new TransactionAwareStorage(database);
  const originalBytes = Buffer.from('original asset bytes');
  const originalChecksum = calculateSHA256(originalBytes);
  const original = seedOriginal(database, storage);
  const versionB = await repair(database, storage, original.id, Buffer.from('version B bytes'));
  const rollbackA = await repair(database, storage, versionB.asset.id, originalBytes);

  assert.equal(database.rows.length, 3, 'A -> B -> A must preserve three metadata versions');
  assert.equal(Number(rollbackA.supersedesAssetId), Number(versionB.asset.id));
  assert.equal(Number(rollbackA.asset.supersedesAssetId), Number(versionB.asset.id));
  assert.equal(rollbackA.asset.sha256Checksum, originalChecksum);
  assert.equal(rollbackA.reused, false, 'historical content must not reuse the non-tail metadata row');
  assert.equal(rollbackA.duplicateDetected, true, 'historical immutable bytes should be deduplicated');
  assert.equal(Number(rollbackA.duplicateOf.id), Number(original.id));
  assert.equal(rollbackA.asset.storageKey, original.storage_key);
  assert.equal(rollbackA.asset.downloadStatus, 'duplicate');
}

{
  const database = new FakeAssetDatabase();
  const storage = new TransactionAwareStorage(database);
  const originalBytes = Buffer.from('original asset bytes');
  const original = seedOriginal(database, storage);
  const versionB = await repair(database, storage, original.id, Buffer.from('version B stays current'));
  const versionBChecksum = versionB.asset.sha256Checksum;
  const versionBStorageKey = versionB.asset.storageKey;
  storage.invalidKeys.add(original.storage_key);

  const historicalRepair = await repair(database, storage, original.id, originalBytes);
  assert.equal(database.rows.length, 2, 'same-byte historical repair must not append a new version');
  assert.equal(Number(historicalRepair.asset.id), Number(original.id));
  assert.equal(historicalRepair.versioned, undefined);
  assert.equal(historicalRepair.asset.sha256Checksum, original.sha256_checksum);
  assert.match(historicalRepair.asset.storageKey, /^source-assets\/recovery\//);
  assert.equal(storage.recoveryCount, 1);

  const unchangedTail = database.rows.find(row => Number(row.id) === Number(versionB.asset.id));
  assert.equal(unchangedTail.sha256_checksum, versionBChecksum);
  assert.equal(unchangedTail.storage_key, versionBStorageKey);
  assert.equal(Number(unchangedTail.supersedes_asset_id), Number(original.id));
}

{
  let pooled = false;
  let destroyed = false;
  const connection = {
    async execute(sql) {
      if (sql.includes('GET_LOCK')) throw new Error('lost GET_LOCK response');
      return [[{ released: 1 }]];
    },
    release() { pooled = true; },
    async destroy() { destroyed = true; },
  };
  await assert.rejects(
    acquireAssetWriteLocks({ getConnection: async () => connection }, ['checksum:uncertain']),
    /lost GET_LOCK response/
  );
  assert.equal(pooled, false);
  assert.equal(destroyed, true, 'uncertain GET_LOCK sessions must be destroyed');
}

{
  let pooled = false;
  let destroyed = false;
  const connection = {
    async execute(sql) {
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
      return [[{ released: 0 }]];
    },
    release() { pooled = true; },
    async destroy() { destroyed = true; },
  };
  const lock = await acquireAssetWriteLocks({ getConnection: async () => connection }, ['checksum:release']);
  await lock.release();
  assert.equal(pooled, false);
  assert.equal(destroyed, true, 'uncertain RELEASE_LOCK sessions must be destroyed');
}

{
  const database = new FakeAssetDatabase();
  const storage = new TransactionAwareStorage(database);
  database.failBegin = true;
  await assert.rejects(upload(database, storage), /lost BEGIN response/);
  assert.equal(database.connections.length, 1);
  assert.equal(database.connections[0].released, false);
  assert.equal(database.connections[0].destroyed, true, 'uncertain BEGIN sessions must be destroyed');
}

const migration = await fs.readFile(new URL('../migrations/026_github_publication_foundation.sql', import.meta.url), 'utf8');
assert.match(migration, /ADD UNIQUE KEY uq_source_assets_supersedes \(supersedes_asset_id\)/);

console.log('Asset registration and immutable-lineage concurrency checks passed.');
