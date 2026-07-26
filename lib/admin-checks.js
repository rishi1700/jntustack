import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { getAskConfig, getContentPublicationMode, getContentSource, getDbConfig, getAdminConfig } from './config.js';
import { createAssetStorage, sha256 } from './asset-storage.js';
import { checkAssetStoragePersistence } from './asset-storage-persistence.js';
import { isListingOnlySubject, isPageSubject } from './dataset.js';
import { getDbPool, testDbConnection, describeDbError } from './db.js';
import { loadContent } from './content-store/index.js';

function listMigrationFiles(root) {
  const dir = path.join(root, 'migrations');
  if (!fsSync.existsSync(dir)) return [];
  return fsSync.readdirSync(dir)
    .filter(file => /^\d+.*\.sql$/.test(file))
    .sort();
}

function statusCounts(subjects) {
  return subjects.reduce((acc, subject) => {
    const status = subject.source?.status || 'missing';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
}

const STORAGE_HEALTH_NAMESPACE = 'health/admin-system-checks';
const STORAGE_HEALTH_PAYLOAD_BYTES = 64;
const STORAGE_HEALTH_READ_LIMIT_BYTES = 1024;

class AssetPersistenceHealthError extends Error {
  constructor(stage) {
    super(`Asset persistence health probe failed during ${stage}.`);
    this.name = 'AssetPersistenceHealthError';
    this.code = 'ASSET_PERSISTENCE_PROBE_FAILED';
    this.stage = stage;
  }
}

function healthObjectKey() {
  return `${STORAGE_HEALTH_NAMESPACE}/${crypto.randomUUID()}.bin`;
}

function assertHealthPayload(buffer, expectedSha256) {
  if (!Buffer.isBuffer(buffer) || buffer.length > STORAGE_HEALTH_READ_LIMIT_BYTES) {
    throw new AssetPersistenceHealthError('read');
  }
  if (buffer.length !== STORAGE_HEALTH_PAYLOAD_BYTES || sha256(buffer) !== expectedSha256) {
    throw new AssetPersistenceHealthError('checksum');
  }
}

async function probeLocalStorage(storage, payload, expectedSha256, key) {
  let absolute;
  try {
    absolute = await storage.safeAbsolutePathForKey(key, { createParent: true });
  } catch {
    throw new AssetPersistenceHealthError('setup');
  }
  let cleanupRequired = false;
  let failure = null;
  try {
    try {
      await fs.writeFile(absolute, payload, {
        flag: fsSync.constants.O_WRONLY
          | fsSync.constants.O_CREAT
          | fsSync.constants.O_EXCL
          | (fsSync.constants.O_NOFOLLOW || 0),
        mode: 0o600,
      });
      cleanupRequired = true;
    } catch (err) {
      throw new AssetPersistenceHealthError('write');
    }

    const stored = await storage.getBuffer({
      provider: 'local',
      key,
      expectedSha256,
      maxBytes: STORAGE_HEALTH_READ_LIMIT_BYTES,
    });
    assertHealthPayload(stored, expectedSha256);

    try {
      const verifiedAbsolute = await storage.safeAbsolutePathForKey(key, { requireFile: true });
      await fs.unlink(verifiedAbsolute);
      cleanupRequired = false;
    } catch {
      throw new AssetPersistenceHealthError('delete');
    }
  } catch (err) {
    failure = err instanceof AssetPersistenceHealthError
      ? err
      : new AssetPersistenceHealthError('probe');
  } finally {
    if (cleanupRequired) {
      try {
        const verifiedAbsolute = await storage.safeAbsolutePathForKey(key, { requireFile: true });
        await fs.unlink(verifiedAbsolute);
        cleanupRequired = false;
      } catch (err) {
        if (err?.code === 'ENOENT') {
          cleanupRequired = false;
        } else {
          failure = new AssetPersistenceHealthError('cleanup');
        }
      }
    }
  }
  if (failure) throw failure;
}

function r2ResponseOk(result) {
  return Boolean(result?.response?.ok);
}

async function deleteR2HealthObject(storage, key, { allowMissing = false } = {}) {
  const result = await storage.request({ method: 'DELETE', key });
  if (!r2ResponseOk(result) && !(allowMissing && result?.response?.status === 404)) {
    throw new AssetPersistenceHealthError('delete');
  }
}

async function probeR2Storage(storage, payload, expectedSha256, key) {
  let cleanupRequired = true;
  let failure = null;
  try {
    const written = await storage.request({
      method: 'PUT',
      key,
      body: payload,
      contentType: 'application/octet-stream',
      extraHeaders: {
        'if-none-match': '*',
        'x-amz-meta-purpose': 'admin-storage-health',
        'x-amz-meta-sha256': expectedSha256,
      },
    });
    if (written?.response?.status === 412) cleanupRequired = false;
    if (!r2ResponseOk(written)) throw new AssetPersistenceHealthError('write');

    const read = await storage.request({
      method: 'GET',
      key,
      responseMaxBytes: STORAGE_HEALTH_READ_LIMIT_BYTES,
    });
    if (!r2ResponseOk(read)) throw new AssetPersistenceHealthError('read');
    assertHealthPayload(read.responseBody, expectedSha256);

    await deleteR2HealthObject(storage, key);
    cleanupRequired = false;
  } catch (err) {
    failure = err instanceof AssetPersistenceHealthError
      ? err
      : new AssetPersistenceHealthError('probe');
  } finally {
    if (cleanupRequired) {
      try {
        await deleteR2HealthObject(storage, key, { allowMissing: true });
        cleanupRequired = false;
      } catch {
        failure = new AssetPersistenceHealthError('cleanup');
      }
    }
  }
  if (failure) throw failure;
}

export async function checkStorage(root, {
  env = process.env,
  storageFactory = createAssetStorage,
  randomBytes = crypto.randomBytes,
} = {}) {
  const provider = String(env.ASSET_STORAGE_PROVIDER || 'local').trim().toLowerCase();
  if (provider === 'r2') {
    const required = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];
    const bucketPresent = Boolean(env.R2_BUCKET || env.R2_BUCKET_NAME);
    const missing = required.filter(key => !env[key]);
    if (!bucketPresent) missing.push('R2_BUCKET');
    if (missing.length) {
      return {
        provider,
        configured: false,
        ok: false,
        missing,
        message: `R2 configuration is incomplete: ${missing.join(', ')}`,
      };
    }
  }
  if (provider !== 'local' && provider !== 'r2') {
    return {
      provider: 'unsupported',
      configured: false,
      ok: false,
      message: 'An unsupported storage provider is configured.',
    };
  }
  if (provider === 'local' && String(env.ASSET_STORAGE_ROOT || '').trim()) {
    const rootSafety = await checkAssetStoragePersistence({
      root,
      env,
      seedIfMissing: false,
      storageFactory,
    });
    if (rootSafety.status === 'unsafe_storage_root') {
      return {
        provider,
        configured: false,
        ok: false,
        publicationReady: false,
        persistenceStatus: rootSafety.status,
        persistenceVerified: false,
        code: 'ASSET_STORAGE_UNSAFE_ROOT',
        message: 'The configured persistent asset root is inside an unsafe deployment or public path.',
      };
    }
  }

  try {
    const storage = storageFactory({ env, root });
    if (storage?.provider !== provider) throw new AssetPersistenceHealthError('setup');
    const payload = Buffer.from(randomBytes(STORAGE_HEALTH_PAYLOAD_BYTES));
    if (payload.length !== STORAGE_HEALTH_PAYLOAD_BYTES) {
      throw new AssetPersistenceHealthError('setup');
    }
    const expectedSha256 = sha256(payload);
    const key = healthObjectKey();
    if (provider === 'local') {
      await probeLocalStorage(storage, payload, expectedSha256, key);
    } else {
      await probeR2Storage(storage, payload, expectedSha256, key);
    }
    const persistence = await checkAssetStoragePersistence({
      root,
      env,
      seedIfMissing: true,
      storageFactory,
    });
    const productionPersistenceRequired = provider === 'r2'
      || Boolean(String(env.ASSET_STORAGE_ROOT || '').trim());
    const ok = productionPersistenceRequired ? persistence.ready : true;
    return {
      provider,
      configured: true,
      ok,
      publicationReady: persistence.ready,
      persistenceStatus: persistence.status,
      persistenceVerified: persistence.verified,
      message: persistence.ready
        ? 'write/read/checksum/delete probe passed; deployment persistence verified'
        : productionPersistenceRequired
          ? 'I/O probe passed, but deployment persistence is not yet verified.'
          : 'write/read/checksum/delete probe passed; configure a persistent production root before publication',
    };
  } catch (err) {
    const stage = err instanceof AssetPersistenceHealthError ? err.stage : 'setup';
    return {
      ok: false,
      provider,
      configured: true,
      message: 'Asset persistence probe failed; storage is not ready.',
      code: 'ASSET_PERSISTENCE_PROBE_FAILED',
      stage,
    };
  }
}

function sanitizeDbError(error) {
  if (!error) return null;
  const summary = describeDbError(error);
  const messageByCode = {
    ER_ACCESS_DENIED_ERROR: 'Access denied for the configured database user. Check DB credentials and database remote-access rules.',
    ECONNREFUSED: 'Database host refused the connection. Check DB_HOST and DB_PORT.',
    ENOTFOUND: 'Database host could not be resolved. Check DB_HOST.',
    ETIMEDOUT: 'Database connection timed out. Check DB_HOST, DB_PORT, and firewall/remote access.',
  };
  return {
    name: summary.name,
    code: summary.code,
    errno: summary.errno,
    sqlState: summary.sqlState,
    message: messageByCode[summary.code] || 'Database check failed. Review DB credentials, host, port, and access rules.',
  };
}

async function readSearchIndex(root) {
  const filePath = path.join(root, 'dist', 'search-index.json');
  try {
    const docs = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    const byType = docs.reduce((acc, doc) => {
      const type = doc.type || 'unknown';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});
    return {
      ok: true,
      path: path.relative(root, filePath),
      total: docs.length,
      byType,
    };
  } catch (err) {
    return {
      ok: false,
      path: path.relative(root, filePath),
      message: err?.code === 'ENOENT' ? 'search index is missing' : 'search index could not be read',
      code: err?.code,
    };
  }
}

async function checkDb(root) {
  const db = getDbConfig();
  const migrationFiles = listMigrationFiles(root);
  const base = {
    configured: db.configured,
    missing: db.missing,
    expectedMigrations: migrationFiles.length,
    appliedMigrations: null,
    pendingMigrations: null,
    ok: false,
    skipped: !db.configured,
  };

  if (!db.configured) {
    return {
      ...base,
      message: `Database env is incomplete. Missing: ${db.missing.join(', ')}`,
    };
  }

  const connection = await testDbConnection({ requireConfigured: true });
  if (!connection.ok) {
    return {
      ...base,
      skipped: false,
      message: 'Database connection failed.',
      error: sanitizeDbError(connection.error),
    };
  }

  try {
    const pool = await getDbPool({ requireConfigured: true });
    const [rows] = await pool.query('SELECT id FROM schema_migrations ORDER BY id');
    const applied = new Set(rows.map(row => row.id));
    const expected = migrationFiles.map(file => file.replace(/\.sql$/, ''));
    const pending = expected.filter(id => !applied.has(id));
    return {
      ...base,
      ok: pending.length === 0,
      skipped: false,
      connected: true,
      appliedMigrations: rows.length,
      pendingMigrations: pending,
      message: pending.length ? `${pending.length} pending migration(s).` : 'connected; migrations current',
    };
  } catch (err) {
    return {
      ...base,
      skipped: false,
      connected: true,
      message: 'Database connected, but migration status could not be read.',
      error: sanitizeDbError(err),
    };
  }
}

export async function getAdminChecks({ root }) {
  const admin = getAdminConfig();
  const ask = getAskConfig();
  const contentSource = getContentSource();
  const contentPublicationMode = getContentPublicationMode();

  const [content, db, storage, searchIndex] = await Promise.all([
    loadContent({ root }),
    checkDb(root),
    checkStorage(root),
    readSearchIndex(root),
  ]);

  const countsByStatus = statusCounts(content.data.subjects);
  return {
    generatedAt: new Date().toISOString(),
    runtime: {
      contentSource,
      contentPublicationMode,
      adminEnabled: admin.enabled,
      adminConfigured: Boolean(admin.email && (admin.passwordHash || admin.password)),
      askEnabled: ask.enabled,
      nodeVersion: process.version,
    },
    db,
    storage,
    content: {
      source: content.source,
      subjectsTotal: content.data.subjects.length,
      subjectsVerified: countsByStatus.verified || 0,
      subjectPages: content.data.subjects.filter(subject => subject.source?.status === 'verified' && isPageSubject(subject)).length,
      subjectListings: content.data.subjects.filter(subject => subject.source?.status === 'verified' && isListingOnlySubject(subject)).length,
      subjectsNeedsVerification: countsByStatus.needs_verification || 0,
      subjectsPlaceholder: countsByStatus.placeholder || 0,
      collegesTotal: content.colleges.length,
      branchProfilesTotal: content.branchProfiles.length,
      guidesTotal: (content.guides || content.data.guides || []).length,
    },
    searchIndex,
  };
}
