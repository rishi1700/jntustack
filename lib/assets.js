import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describeDbError, getDbPool } from './db.js';
import {
  AssetIntegrityError,
  createAssetStorage,
  createAssetStorageForProvider,
} from './asset-storage.js';

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.html', '.htm', '.zip', '.png', '.jpg', '.jpeg', '.gif', '.webp']);
const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'text/html',
  'application/zip',
  'application/x-zip-compressed',
  'image/',
];
const SENSITIVE_QUERY_KEY = /(?:^|[_-])(?:access[_-]?key|api[_-]?key|auth|authorization|credential|pass(?:word|wd)?|secret|sig(?:nature)?|token)(?:$|[_-])/i;
const ASSET_WRITE_LOCK_TIMEOUT_SECONDS = 15;
const MAX_ASSET_LINEAGE_DEPTH = 1_000;

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeId(value, label = 'ID') {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function sanitizeFilename(filename) {
  const raw = path.basename(clean(filename) || 'source-asset');
  const cleaned = raw
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 180);
  return cleaned || 'source-asset';
}

function localStorageKey(localStoragePath) {
  const normalized = clean(localStoragePath).replaceAll('\\', '/');
  if (normalized.startsWith('source-assets/')) return normalized;
  if (normalized.startsWith('storage/source-assets/')) return normalized.slice('storage/'.length);
  const embeddedStorage = normalized.toLowerCase().indexOf('/storage/source-assets/');
  if (embeddedStorage >= 0) return normalized.slice(embeddedStorage + '/storage/'.length);
  return '';
}

function normalizeSourceUrl(value, fallback) {
  const raw = clean(value);
  if (!raw) return fallback;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Source URL must use http or https.');
    }
    if (parsed.username || parsed.password) {
      throw new Error('Source URL must not contain embedded credentials.');
    }
    for (const key of parsed.searchParams.keys()) {
      if (key.toLowerCase() === 'key' || SENSITIVE_QUERY_KEY.test(key)) {
        throw new Error(`Source URL must not contain sensitive query parameter "${key}".`);
      }
    }
    parsed.hash = '';
    return parsed.href;
  } catch (err) {
    if (err.message.includes('Source URL')) throw err;
    throw new Error('Source URL must be a valid URL when provided.');
  }
}

function isAllowedUpload({ filename, contentType }) {
  const ext = path.extname(filename).toLowerCase();
  const type = clean(contentType).toLowerCase().split(';')[0].trim();
  if (ALLOWED_EXTENSIONS.has(ext)) return true;
  return ALLOWED_CONTENT_TYPES.some(allowed => allowed.endsWith('/') ? type.startsWith(allowed) : type === allowed);
}

function assetFromRow(row) {
  if (!row) return null;
  const metadataJson = parseJsonValue(row.metadata_json);
  const localStoragePath = row.local_storage_path ?? row.storage_path;
  const storageProvider = row.storage_provider || 'local';
  return {
    id: row.id,
    discoverySourceId: row.discovery_source_id,
    discoverySourceName: row.discovery_source_name,
    discoverySourceParserKey: row.discovery_source_parser_key,
    sourceUrl: row.source_url ?? row.url,
    resolvedUrl: row.resolved_url || null,
    originalFilename: row.original_filename,
    contentType: row.content_type,
    fileSize: row.file_size,
    sha256Checksum: row.sha256_checksum ?? row.checksum,
    etag: row.etag,
    lastModified: row.last_modified,
    localStoragePath,
    storageProvider,
    storageKey: row.storage_key || (storageProvider === 'local' ? localStorageKey(localStoragePath) : null),
    storageEtag: row.storage_etag || null,
    storageVerifiedAt: row.storage_verified_at || null,
    downloadedAt: row.downloaded_at ?? row.fetched_at,
    downloadStatus: row.download_status ?? row.status,
    downloadError: row.download_error,
    duplicateOfAssetId: row.duplicate_of_asset_id,
    supersedesAssetId: row.supersedes_asset_id || null,
    metadataJson,
    createdAt: row.created_at,
  };
}

function parseJsonValue(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function mergeAssetMetadata(existing, patch) {
  const base = parseJsonValue(existing) || {};
  return {
    ...base,
    ...patch,
    file_repair: {
      ...(base.file_repair || {}),
      ...(patch.file_repair || {}),
    },
  };
}

export function calculateSHA256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function validateUploadAsset({ filename, contentType, buffer }) {
  const safeName = sanitizeFilename(filename);
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Uploaded file is empty.');
  }
  if (!isAllowedUpload({ filename: safeName, contentType })) {
    throw new Error('Unsupported asset type. Upload PDF, HTML, ZIP, or image files only.');
  }
  return safeName;
}

export async function assetFileExists(root, localStoragePath) {
  const rawPath = clean(localStoragePath);
  if (!rawPath) return false;
  const storageRoot = path.resolve(root, 'storage', 'source-assets');
  const absolutePath = path.resolve(root, rawPath);
  if (absolutePath !== storageRoot && !absolutePath.startsWith(`${storageRoot}${path.sep}`)) {
    return false;
  }
  try {
    const stat = await fs.stat(absolutePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function storageAdapter({ root, provider, storage = null, env = process.env, fetchImpl = globalThis.fetch }) {
  if (storage) {
    if (storage.provider !== provider) {
      throw new Error(`Storage provider mismatch: asset uses ${provider}, adapter is ${storage.provider}.`);
    }
    return storage;
  }
  return createAssetStorageForProvider(provider, { root, env, fetchImpl });
}

function assertAssetChecksum(asset) {
  const checksum = clean(asset?.sha256Checksum).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(checksum)) {
    throw new AssetIntegrityError('Source asset has no valid SHA-256 checksum.', 'checksum_missing');
  }
  return checksum;
}

export async function readAssetBuffer({
  root,
  asset,
  storage = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
  maxBytes = undefined,
} = {}) {
  if (!asset) throw new Error('Source asset is required.');
  const provider = clean(asset.storageProvider).toLowerCase() || 'local';
  const checksum = assertAssetChecksum(asset);
  const key = clean(asset.storageKey) || (provider === 'local' ? localStorageKey(asset.localStoragePath) : '');
  if (!key) throw new Error(`Source asset ${asset.id || ''} has no ${provider} storage key.`.trim());
  const adapter = storageAdapter({ root, provider, storage, env, fetchImpl });
  return adapter.getBuffer({
    provider,
    key,
    expectedSha256: checksum,
    maxBytes,
  });
}

export async function assetStorageExists({
  root,
  asset,
  storage = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!asset) return false;
  const provider = clean(asset.storageProvider).toLowerCase() || 'local';
  const checksum = assertAssetChecksum(asset);
  const key = clean(asset.storageKey) || (provider === 'local' ? localStorageKey(asset.localStoragePath) : '');
  if (!key) return false;
  const adapter = storageAdapter({ root, provider, storage, env, fetchImpl });
  return adapter.exists({ provider, key, expectedSha256: checksum });
}

function storedLocation(stored) {
  return {
    provider: stored.provider,
    key: stored.key,
    etag: stored.etag || null,
    verifiedAt: stored.verifiedAt ? new Date(stored.verifiedAt) : new Date(),
    localStoragePath: stored.provider === 'local' ? path.posix.join('storage', stored.key) : null,
  };
}

export class AssetWriteBusyError extends Error {
  constructor(message = 'Another source-asset write is already finalizing. Try again shortly.') {
    super(message);
    this.name = 'AssetWriteBusyError';
    this.code = 'asset_write_busy';
  }
}

export class AssetSourceChangedError extends Error {
  constructor({ sourceId, sourceUrl, existingChecksum, incomingChecksum }) {
    super(
      `Source ${sourceId} already registered ${sourceUrl} with different bytes `
      + `(${existingChecksum || 'unknown'} -> ${incomingChecksum}). Retry through the repair/version workflow.`
    );
    this.name = 'AssetSourceChangedError';
    this.code = 'asset_source_changed';
    this.sourceId = sourceId;
    this.sourceUrl = sourceUrl;
    this.existingChecksum = existingChecksum || null;
    this.incomingChecksum = incomingChecksum;
  }
}

function assetWriteLockName(identity) {
  // MySQL lock names are limited to 64 characters on supported deployments.
  // Hashing a namespaced identity keeps the entire key collision-resistant
  // without relying on lossy prefix truncation.
  return crypto
    .createHash('sha256')
    .update(`jntustack:source-asset:${identity}`)
    .digest('hex');
}

async function releaseAssetWriteLocks(connection, keys) {
  let allReleased = true;
  for (const key of [...keys].reverse()) {
    try {
      const [rows] = await connection.execute('SELECT RELEASE_LOCK(?) AS released', [key]);
      if (Number(rows?.[0]?.released) !== 1) allReleased = false;
    } catch {
      allReleased = false;
    }
  }
  return allReleased;
}

async function disposeAssetConnection(connection, reusable) {
  if (reusable) {
    connection.release();
    return;
  }
  try {
    if (typeof connection.destroy === 'function') {
      await connection.destroy();
      return;
    }
    if (typeof connection.end === 'function') await connection.end();
  } catch {
    // A session with uncertain named-lock ownership must not re-enter the pool.
  }
}

/**
 * Acquire all cooperating asset-write locks on one dedicated MySQL session.
 * Callers may perform storage I/O while these advisory locks are held, but
 * must not open the SQL transaction until that I/O is complete. Identities
 * are sorted so checksum and lineage locks cannot deadlock when acquired together.
 */
export async function acquireAssetWriteLocks(database, identities, {
  timeoutSeconds = ASSET_WRITE_LOCK_TIMEOUT_SECONDS,
} = {}) {
  if (typeof database?.getConnection !== 'function') {
    throw new Error('Asset write locking requires a database connection pool.');
  }
  const connection = await database.getConnection();
  const keys = [...new Set((identities || []).map(assetWriteLockName))].sort();
  const acquired = [];
  const timeoutMs = Math.max(0, Number(timeoutSeconds) || 0) * 1_000;
  const deadline = Date.now() + timeoutMs;

  try {
    for (const key of keys) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new AssetWriteBusyError();
      let rows;
      try {
        [rows] = await connection.execute(
          'SELECT GET_LOCK(?, ?) AS acquired',
          [key, Math.max(0.001, remainingMs / 1_000)]
        );
      } catch (error) {
        // The server may have granted this lock even when the response was
        // lost. Discarding the session is the only fail-closed outcome.
        error.lockAcquisitionUncertain = true;
        throw error;
      }
      if (Number(rows?.[0]?.acquired) !== 1) throw new AssetWriteBusyError();
      acquired.push(key);
    }
  } catch (error) {
    const released = await releaseAssetWriteLocks(connection, acquired);
    await disposeAssetConnection(connection, released && !error?.lockAcquisitionUncertain);
    throw error;
  }

  let finished = false;
  return {
    db: connection,
    async release({ discard = false } = {}) {
      if (finished) return;
      finished = true;
      const released = await releaseAssetWriteLocks(connection, acquired);
      await disposeAssetConnection(connection, released && !discard);
    },
  };
}

function locationForAsset(asset) {
  return {
    provider: asset.storageProvider,
    key: asset.storageKey,
    etag: asset.storageEtag,
    verifiedAt: asset.storageVerifiedAt || new Date(),
    localStoragePath: asset.localStoragePath,
  };
}

function assetMatchesPreparedLocation(asset, location) {
  if (!asset || clean(asset.storageProvider).toLowerCase() !== clean(location?.provider).toLowerCase()) {
    return false;
  }
  const preparedKey = clean(location?.key);
  if (preparedKey) return clean(asset.storageKey) === preparedKey;
  return clean(asset.localStoragePath) === clean(location?.localStoragePath);
}

async function lockPreparedChecksumMatches(conn, checksum, location, { excludeAssetIds = [] } = {}) {
  const [rows] = await conn.execute(
    `SELECT sa.*
     FROM source_assets sa
     WHERE sa.sha256_checksum = ?
       AND sa.storage_provider = ?
       AND sa.download_status IN ('stored', 'duplicate')
     ORDER BY sa.duplicate_of_asset_id IS NULL DESC, sa.id ASC
     FOR UPDATE`,
    [checksum, location.provider]
  );
  const excluded = new Set(excludeAssetIds.map(Number));
  const candidates = rows
    .map(assetFromRow)
    .filter(asset => !excluded.has(Number(asset.id)));
  // Prefer the exact object we verified or wrote. A different immutable key is
  // still safe when its row was committed by a checksum-serialized writer
  // (notably recovery writes, whose keys are intentionally unique). Known
  // missing/corrupt rows are explicitly excluded above.
  return [
    ...candidates.filter(asset => assetMatchesPreparedLocation(asset, location)),
    ...candidates.filter(asset => !assetMatchesPreparedLocation(asset, location)),
  ];
}

async function resolveAssetLineageRoot(database, snapshot) {
  let current = snapshot;
  const visited = new Set();
  for (let depth = 0; depth < MAX_ASSET_LINEAGE_DEPTH; depth += 1) {
    const currentId = normalizeId(current?.id, 'Asset ID');
    if (visited.has(currentId)) throw new Error(`Source asset lineage contains a cycle at asset ${currentId}.`);
    visited.add(currentId);
    if (!current.supersedes_asset_id) return currentId;
    const parentId = normalizeId(current.supersedes_asset_id, 'Superseded asset ID');
    const [rows] = await database.execute('SELECT * FROM source_assets WHERE id = ?', [parentId]);
    if (!rows[0]) throw new Error(`Source asset lineage parent not found: ${parentId}`);
    current = rows[0];
  }
  throw new Error(`Source asset lineage exceeds ${MAX_ASSET_LINEAGE_DEPTH} versions.`);
}

async function lockAssetLineage(conn, rootId) {
  const [rootRows] = await conn.execute('SELECT * FROM source_assets WHERE id = ? FOR UPDATE', [rootId]);
  if (!rootRows[0]) throw new Error(`Source asset lineage root not found: ${rootId}`);
  const lineage = [];
  const queue = [rootRows[0]];
  const visited = new Set();

  while (queue.length) {
    const row = queue.shift();
    const rowId = normalizeId(row.id, 'Asset ID');
    if (visited.has(rowId)) throw new Error(`Source asset lineage contains a cycle at asset ${rowId}.`);
    visited.add(rowId);
    lineage.push(row);
    if (lineage.length > MAX_ASSET_LINEAGE_DEPTH) {
      throw new Error(`Source asset lineage exceeds ${MAX_ASSET_LINEAGE_DEPTH} versions.`);
    }
    const [children] = await conn.execute(
      'SELECT * FROM source_assets WHERE supersedes_asset_id = ? ORDER BY id ASC FOR UPDATE',
      [rowId]
    );
    queue.push(...children);
  }

  return lineage;
}

function deterministicLineageTail(lineage) {
  const parentIds = new Set(lineage.map(row => Number(row.supersedes_asset_id)).filter(Boolean));
  return lineage
    .filter(row => !parentIds.has(Number(row.id)))
    .sort((left, right) => Number(right.id) - Number(left.id))[0];
}

async function inspectChecksumMatches(conn, checksum, root, {
  excludeAssetId = null,
  storage = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const [rows] = await conn.execute(
    `SELECT sa.*, ds.name AS discovery_source_name
     FROM source_assets sa
     LEFT JOIN discovery_sources ds ON ds.id = sa.discovery_source_id
     WHERE sa.sha256_checksum = ?
       ${excludeAssetId == null ? '' : 'AND sa.id <> ?'}
       AND sa.download_status IN ('stored', 'duplicate')
     ORDER BY sa.duplicate_of_asset_id IS NULL DESC, sa.id ASC`,
    excludeAssetId == null ? [checksum] : [checksum, excludeAssetId]
  );
  const verificationByLocation = new Map();
  const inspections = await Promise.all(rows.map(async row => {
    const asset = assetFromRow(row);
    // A production R2 write must never silently deduplicate onto legacy local
    // storage. Legacy rows remain readable, but new evidence is materialized
    // in the currently selected provider before its DB row is created.
    if (storage && asset.storageProvider !== storage.provider) return { skipped: true, asset };
    const locationIdentity = [
      asset.storageProvider,
      asset.storageKey || asset.localStoragePath || '',
      checksum,
    ].join('\0');
    if (!verificationByLocation.has(locationIdentity)) {
      const matchingStorage = storage?.provider === asset.storageProvider ? storage : null;
      verificationByLocation.set(locationIdentity, (async () => {
        try {
          return {
            exists: await assetStorageExists({ root, asset, storage: matchingStorage, env, fetchImpl }),
            integrityError: null,
          };
        } catch (err) {
          if (!(err instanceof AssetIntegrityError)) throw err;
          return { exists: false, integrityError: err.message };
        }
      })());
    }
    const verification = await verificationByLocation.get(locationIdentity);
    return { asset, ...verification };
  }));
  const duplicateInspection = inspections.find(item => !item.skipped && item.exists);
  return {
    duplicate: duplicateInspection?.asset || null,
    verified: inspections
      .filter(item => !item.skipped && item.exists)
      .map(item => item.asset),
    missing: inspections
      .filter(item => !item.skipped && !item.exists)
      .map(item => item.integrityError
        ? { ...item.asset, storageIntegrityError: item.integrityError }
        : item.asset),
  };
}

async function audit(conn, { actor, action, entityType, entityId, before = null, after = null }) {
  await conn.execute(
    `INSERT INTO audit_log
      (actor, action, entity_type, entity_id, before_json, after_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      actor,
      action,
      entityType,
      entityId == null ? null : String(entityId),
      before == null ? null : JSON.stringify(before),
      after == null ? null : JSON.stringify(after),
    ]
  );
}

export async function registerAsset({
  root,
  discoverySourceId,
  sourceUrl = '',
  resolvedUrl = null,
  originalFilename,
  contentType = '',
  buffer,
  etag = null,
  lastModified = null,
  assetKind = 'manual_upload',
  actor = null,
  storage = null,
  database = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
}) {
  const sourceId = normalizeId(discoverySourceId, 'Discovery source ID');
  const filename = validateUploadAsset({ filename: originalFilename, contentType, buffer });
  const checksum = calculateSHA256(buffer);
  const fallbackUrl = `upload://${sourceId}/${checksum}/${crypto.randomUUID()}/${encodeURIComponent(filename)}`;
  const normalizedSourceUrl = normalizeSourceUrl(sourceUrl, fallbackUrl);
  const normalizedResolvedUrl = clean(resolvedUrl) ? normalizeSourceUrl(resolvedUrl, null) : null;
  const targetStorage = storage || createAssetStorage({ root, env, fetchImpl });
  const pool = database || await getDbPool({ requireConfigured: true });
  const [initialSourceRows] = await pool.execute('SELECT id FROM discovery_sources WHERE id = ?', [sourceId]);
  if (!initialSourceRows[0]) throw new Error(`Discovery source not found: ${sourceId}`);

  // The checksum advisory lock serializes the preflight as well as the final
  // metadata write. Object-store reads/writes happen while no SQL transaction
  // is open, so slow storage cannot retain row locks or a transaction snapshot.
  const locked = await acquireAssetWriteLocks(pool, [`checksum:${checksum}`]);
  const conn = locked.db;
  let transactionState = 'not_started';
  let discardConnection = false;
  try {
    const checksumInspection = await inspectChecksumMatches(conn, checksum, root, {
      storage: targetStorage,
      env,
      fetchImpl,
    });
    const verifiedAssetIds = new Set(checksumInspection.verified.map(asset => Number(asset.id)));
    const preparedDuplicate = checksumInspection.duplicate;
    let location;

    if (preparedDuplicate) {
      location = locationForAsset(preparedDuplicate);
    } else {
      const needsRecoveryKey = checksumInspection.missing.some(missing => Boolean(missing.storageIntegrityError));
      const putMethod = needsRecoveryKey ? 'putRecoveryImmutable' : 'putImmutable';
      if (typeof targetStorage[putMethod] !== 'function') {
        throw new AssetIntegrityError(
          `Storage adapter cannot write a safe recovery object for checksum ${checksum}.`,
          'recovery_storage_unsupported'
        );
      }
      location = storedLocation(await targetStorage[putMethod]({
        body: buffer,
        contentType: clean(contentType) || 'application/octet-stream',
        sha256: checksum,
      }));
    }

    transactionState = 'starting';
    await conn.beginTransaction();
    transactionState = 'active';
    const [sourceRows] = await conn.execute('SELECT id FROM discovery_sources WHERE id = ? FOR UPDATE', [sourceId]);
    if (!sourceRows[0]) throw new Error(`Discovery source not found: ${sourceId}`);

    // A URL identifies a source version request, not merely an object-store
    // key. Exact retries reuse the existing row; changed bytes must enter the
    // explicit repair/version path so they cannot become unlinked siblings.
    const [sameUrlRows] = await conn.execute(
      `SELECT * FROM source_assets
       WHERE discovery_source_id = ?
         AND (
           source_url = ? OR resolved_url = ? OR url = ?
           OR (? IS NOT NULL AND (source_url = ? OR resolved_url = ? OR url = ?))
         )
       ORDER BY id DESC
       LIMIT 1
       FOR UPDATE`,
      [
        sourceId,
        normalizedSourceUrl,
        normalizedSourceUrl,
        normalizedSourceUrl,
        normalizedResolvedUrl,
        normalizedResolvedUrl,
        normalizedResolvedUrl,
        normalizedResolvedUrl,
      ]
    );
    const sameUrlAsset = assetFromRow(sameUrlRows[0]);
    if (sameUrlAsset) {
      const existingChecksum = clean(sameUrlAsset.sha256Checksum).toLowerCase();
      if (existingChecksum !== checksum) {
        throw new AssetSourceChangedError({
          sourceId,
          sourceUrl: normalizedSourceUrl,
          existingChecksum,
          incomingChecksum: checksum,
        });
      }
      if (
        !assetMatchesPreparedLocation(sameUrlAsset, location)
        && !verifiedAssetIds.has(Number(sameUrlAsset.id))
      ) {
        throw new AssetIntegrityError(
          `Source ${sourceId} already registered ${normalizedSourceUrl}, but its stored object needs repair.`,
          'source_asset_storage_conflict'
        );
      }
      await audit(conn, {
        actor,
        action: 'source_asset.registration_reused',
        entityType: 'source_asset',
        entityId: sameUrlAsset.id,
        after: { checksum, source_url: normalizedSourceUrl },
      });
      transactionState = 'committing';
      await conn.commit();
      transactionState = 'committed';
      return {
        asset: sameUrlAsset,
        duplicateOf: sameUrlAsset,
        duplicateDetected: true,
        reused: true,
      };
    }

    const unsafeAssetIds = checksumInspection.missing.map(asset => asset.id);
    const finalMatches = await lockPreparedChecksumMatches(conn, checksum, location, {
      excludeAssetIds: unsafeAssetIds,
    });
    const duplicate = finalMatches[0] || null;
    const effectiveLocation = duplicate ? locationForAsset(duplicate) : location;
    const downloadStatus = duplicate ? 'duplicate' : 'stored';
    const duplicateOfAssetId = duplicate ? duplicate.duplicateOfAssetId || duplicate.id : null;

    if (!duplicate) {
      for (const missing of checksumInspection.missing) {
        await audit(conn, {
          actor,
          action: 'source_asset.missing_detected',
          entityType: 'source_asset',
          entityId: missing.id,
          after: {
            reason: 'checksum_match_file_missing',
            source_url: missing.sourceUrl,
            storage_provider: missing.storageProvider,
            storage_key: missing.storageKey,
            storage_path: missing.localStoragePath,
            integrity_error: missing.storageIntegrityError || null,
            checksum,
          },
        });
      }
    }

    const [result] = await conn.execute(
      `INSERT INTO source_assets
        (discovery_source_id, source_url, resolved_url, url, original_filename, asset_kind, content_type,
         file_size, sha256_checksum, checksum, etag, last_modified, local_storage_path,
         storage_provider, storage_key, storage_etag, storage_verified_at, storage_path,
         downloaded_at, fetched_at, download_status, status, download_error, duplicate_of_asset_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, NULL, ?)`,
      [
        sourceId,
        normalizedSourceUrl,
        normalizedResolvedUrl,
        normalizedSourceUrl,
        filename,
        clean(assetKind) || 'manual_upload',
        clean(contentType) || null,
        buffer.length,
        checksum,
        checksum,
        clean(etag) || null,
        clean(lastModified) || null,
        effectiveLocation.localStoragePath,
        effectiveLocation.provider,
        effectiveLocation.key,
        effectiveLocation.etag,
        effectiveLocation.verifiedAt,
        effectiveLocation.localStoragePath,
        downloadStatus,
        downloadStatus === 'duplicate' ? 'ignored' : 'fetched',
        duplicateOfAssetId,
      ]
    );
    const id = result.insertId;
    const [afterRows] = await conn.execute('SELECT * FROM source_assets WHERE id = ?', [id]);
    const action = duplicate ? 'source_asset.duplicate_detected' : 'source_asset.upload';
    await conn.execute(
      `INSERT INTO audit_log
        (actor, action, entity_type, entity_id, before_json, after_json)
       VALUES (?, ?, 'source_asset', ?, NULL, ?)`,
      [actor, action, String(id), JSON.stringify(afterRows[0])]
    );
    transactionState = 'committing';
    await conn.commit();
    transactionState = 'committed';

    return {
      asset: assetFromRow(afterRows[0]),
      duplicateOf: duplicate,
      duplicateDetected: Boolean(duplicate),
      reused: false,
    };
  } catch (err) {
    if (transactionState === 'active') {
      try {
        await conn.rollback();
        transactionState = 'rolled_back';
      } catch {
        discardConnection = true;
      }
    } else if (transactionState === 'starting' || transactionState === 'committing') {
      discardConnection = true;
    }
    throw err;
  } finally {
    await locked.release({ discard: discardConnection });
  }
}

export async function repairAssetRecordWithBuffer({
  root,
  assetId,
  originalFilename,
  contentType = '',
  buffer,
  etag = null,
  lastModified = null,
  assetKind = 'manual_fetch',
  finalUrl = null,
  actor = null,
  reason = 'stored_file_missing',
  storage = null,
  database = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
}) {
  const id = normalizeId(assetId, 'Asset ID');
  const filename = validateUploadAsset({ filename: originalFilename, contentType, buffer });
  const checksum = calculateSHA256(buffer);
  const targetStorage = storage || createAssetStorage({ root, env, fetchImpl });
  const pool = database || await getDbPool({ requireConfigured: true });
  const [snapshotRows] = await pool.execute('SELECT * FROM source_assets WHERE id = ?', [id]);
  const beforeSnapshot = snapshotRows[0];
  if (!beforeSnapshot) throw new Error(`Source asset not found: ${id}`);
  normalizeId(beforeSnapshot.discovery_source_id, 'Discovery source ID');
  const rootId = await resolveAssetLineageRoot(pool, beforeSnapshot);
  const locked = await acquireAssetWriteLocks(pool, [
    `checksum:${checksum}`,
    `lineage:${rootId}`,
  ]);
  const conn = locked.db;
  let transactionState = 'not_started';
  let discardConnection = false;
  try {
    // Refresh the requested row after acquiring the lineage lock. All storage
    // verification and immutable writes remain outside the SQL transaction.
    const [refreshedRows] = await conn.execute('SELECT * FROM source_assets WHERE id = ?', [id]);
    const refreshed = refreshedRows[0];
    if (!refreshed) throw new Error(`Source asset not found: ${id}`);
    const snapshotChecksum = clean(refreshed.sha256_checksum ?? refreshed.checksum).toLowerCase();
    const checksumInspection = await inspectChecksumMatches(conn, checksum, root, {
      storage: targetStorage,
      env,
      fetchImpl,
    });
    const verifiedAssetIds = new Set(checksumInspection.verified.map(asset => Number(asset.id)));

    let location;
    if (checksumInspection.duplicate) {
      location = locationForAsset(checksumInspection.duplicate);
    } else {
      const needsRecoveryKey = (
        (snapshotChecksum === checksum && clean(reason).includes('invalid')) ||
        checksumInspection.missing.some(missing => Boolean(missing.storageIntegrityError))
      );
      const putMethod = needsRecoveryKey ? 'putRecoveryImmutable' : 'putImmutable';
      if (typeof targetStorage[putMethod] !== 'function') {
        throw new AssetIntegrityError(
          `Storage adapter cannot write a safe recovery object for checksum ${checksum}.`,
          'recovery_storage_unsupported'
        );
      }
      location = storedLocation(await targetStorage[putMethod]({
        body: buffer,
        contentType: clean(contentType) || 'application/octet-stream',
        sha256: checksum,
      }));
    }

    transactionState = 'starting';
    await conn.beginTransaction();
    transactionState = 'active';
    const lineage = await lockAssetLineage(conn, rootId);
    const before = lineage.find(row => Number(row.id) === id);
    if (!before) throw new Error(`Source asset not found: ${id}`);
    normalizeId(before.discovery_source_id, 'Discovery source ID');
    const now = new Date();
    const lineageTail = deterministicLineageTail(lineage);
    if (!lineageTail) throw new Error(`Source asset lineage ${rootId} has no terminal version.`);
    const previousChecksum = clean(before.sha256_checksum ?? before.checksum).toLowerCase();
    const previousChecksumIsValid = /^[a-f0-9]{64}$/.test(previousChecksum);
    const createVersion = previousChecksumIsValid && previousChecksum !== checksum;

    const lineageAssets = lineage.map(assetFromRow);
    const currentTailAsset = assetFromRow(lineageTail);
    const existingLineageVersion = createVersion
      && clean(currentTailAsset.sha256Checksum).toLowerCase() === checksum
      && (
        assetMatchesPreparedLocation(currentTailAsset, location)
        || verifiedAssetIds.has(Number(currentTailAsset.id))
      )
      ? currentTailAsset
      : null;

    if (existingLineageVersion) {
      await audit(conn, {
        actor,
        action: 'source_asset.repair_version_reused',
        entityType: 'source_asset',
        entityId: existingLineageVersion.id,
        before,
        after: {
          reused_asset_id: existingLineageVersion.id,
          requested_asset_id: id,
          checksum,
        },
      });
      transactionState = 'committing';
      await conn.commit();
      transactionState = 'committed';
      return {
        asset: existingLineageVersion,
        duplicateOf: existingLineageVersion.duplicateOfAssetId ? existingLineageVersion : null,
        duplicateDetected: existingLineageVersion.downloadStatus === 'duplicate',
        repaired: true,
        versioned: Boolean(existingLineageVersion.supersedesAssetId),
        reused: true,
        supersedesAssetId: existingLineageVersion.supersedesAssetId,
      };
    }

    const lineageIds = lineage.map(row => Number(row.id));
    const unsafeAssetIds = checksumInspection.missing.map(asset => Number(asset.id));
    const globalMatches = await lockPreparedChecksumMatches(conn, checksum, location, {
      excludeAssetIds: [...lineageIds, ...unsafeAssetIds],
    });
    const versionParent = createVersion ? lineageTail : before;
    const historicalLineageDuplicate = createVersion
      ? lineageAssets
        .filter(asset => Number(asset.id) !== Number(versionParent.id))
        .filter(asset => clean(asset.sha256Checksum).toLowerCase() === checksum)
        .filter(asset => verifiedAssetIds.has(Number(asset.id)))
        .sort((left, right) => Number(left.id) - Number(right.id))[0] || null
      : null;
    const duplicateOf = historicalLineageDuplicate || globalMatches[0] || null;
    const duplicateDetected = Boolean(duplicateOf);
    const effectiveLocation = duplicateOf ? locationForAsset(duplicateOf) : location;
    const downloadStatus = duplicateOf ? 'duplicate' : 'stored';
    const status = duplicateOf ? 'ignored' : 'fetched';
    const duplicateOfAssetId = duplicateOf ? duplicateOf.duplicateOfAssetId || duplicateOf.id : null;

    for (const missing of checksumInspection.missing) {
      await audit(conn, {
        actor,
        action: 'source_asset.missing_detected',
        entityType: 'source_asset',
        entityId: missing.id,
        after: {
          reason: 'checksum_match_file_missing',
          source_url: missing.sourceUrl,
          storage_provider: missing.storageProvider,
          storage_key: missing.storageKey,
          storage_path: missing.localStoragePath,
          integrity_error: missing.storageIntegrityError || null,
          checksum,
        },
      });
    }

    const normalizedResolvedUrl = clean(finalUrl)
      ? normalizeSourceUrl(finalUrl, null)
      : clean(versionParent.resolved_url) || null;
    const previousState = {
      source_url: versionParent.source_url ?? versionParent.url,
      local_storage_path: versionParent.local_storage_path ?? versionParent.storage_path,
      storage_provider: versionParent.storage_provider || 'local',
      storage_key: versionParent.storage_key || null,
      download_status: versionParent.download_status ?? versionParent.status,
      status: versionParent.status,
      sha256_checksum: versionParent.sha256_checksum ?? versionParent.checksum,
      file_size: versionParent.file_size,
      content_type: versionParent.content_type,
      downloaded_at: versionParent.downloaded_at ?? versionParent.fetched_at,
    };
    const metadata = mergeAssetMetadata(versionParent.metadata_json, {
      file_repair: {
        status: createVersion ? 'versioned' : 'repaired',
        repaired_at: now.toISOString(),
        reason,
        final_url: clean(finalUrl) || null,
        previous_state: previousState,
        duplicate_detected: duplicateDetected,
        duplicate_of_asset_id: duplicateOfAssetId,
      },
    });

    if (createVersion) {
      const sourceUrlForVersion = clean(versionParent.source_url ?? versionParent.url);
      const [result] = await conn.execute(
        `INSERT INTO source_assets
          (discovery_source_id, source_url, resolved_url, url, original_filename, asset_kind, content_type,
           file_size, sha256_checksum, checksum, etag, last_modified, local_storage_path,
           storage_provider, storage_key, storage_etag, storage_verified_at, storage_path,
           downloaded_at, fetched_at, download_status, status, download_error,
           duplicate_of_asset_id, supersedes_asset_id, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, NULL, ?, ?, ?)`,
        [
          versionParent.discovery_source_id,
          sourceUrlForVersion,
          normalizedResolvedUrl,
          sourceUrlForVersion,
          filename,
          clean(assetKind) || versionParent.asset_kind || 'manual_fetch',
          clean(contentType) || null,
          buffer.length,
          checksum,
          checksum,
          clean(etag) || null,
          clean(lastModified) || null,
          effectiveLocation.localStoragePath,
          effectiveLocation.provider,
          effectiveLocation.key,
          effectiveLocation.etag,
          effectiveLocation.verifiedAt,
          effectiveLocation.localStoragePath,
          downloadStatus,
          status,
          duplicateOfAssetId,
          versionParent.id,
          JSON.stringify(metadata),
        ]
      );
      const versionId = result.insertId;
      const [versionRows] = await conn.execute('SELECT * FROM source_assets WHERE id = ?', [versionId]);
      await audit(conn, {
        actor,
        action: 'source_asset.repair_version_created',
        entityType: 'source_asset',
        entityId: versionId,
        before: versionParent,
        after: versionRows[0],
      });
      transactionState = 'committing';
      await conn.commit();
      transactionState = 'committed';
      return {
        asset: assetFromRow(versionRows[0]),
        duplicateOf,
        duplicateDetected,
        repaired: true,
        versioned: true,
        reused: false,
        supersedesAssetId: versionParent.id,
        previousState,
      };
    }

    await conn.execute(
      `UPDATE source_assets
       SET original_filename = ?,
           asset_kind = ?,
           resolved_url = ?,
           content_type = ?,
           file_size = ?,
           sha256_checksum = ?,
           checksum = ?,
           etag = ?,
           last_modified = ?,
           local_storage_path = ?,
           storage_provider = ?,
           storage_key = ?,
           storage_etag = ?,
           storage_verified_at = ?,
           storage_path = ?,
           downloaded_at = CURRENT_TIMESTAMP,
           fetched_at = CURRENT_TIMESTAMP,
           download_status = ?,
           status = ?,
           download_error = NULL,
           duplicate_of_asset_id = ?,
           metadata_json = ?
       WHERE id = ?`,
      [
        filename,
        clean(assetKind) || versionParent.asset_kind || 'manual_fetch',
        normalizedResolvedUrl,
        clean(contentType) || null,
        buffer.length,
        checksum,
        checksum,
        clean(etag) || null,
        clean(lastModified) || null,
        effectiveLocation.localStoragePath,
        effectiveLocation.provider,
        effectiveLocation.key,
        effectiveLocation.etag,
        effectiveLocation.verifiedAt,
        effectiveLocation.localStoragePath,
        downloadStatus,
        status,
        duplicateOfAssetId,
        JSON.stringify(metadata),
        versionParent.id,
      ]
    );
    const [afterRows] = await conn.execute('SELECT * FROM source_assets WHERE id = ?', [versionParent.id]);
    await audit(conn, {
      actor,
      action: 'source_asset.repair_success',
      entityType: 'source_asset',
      entityId: versionParent.id,
      before: versionParent,
      after: afterRows[0],
    });
    transactionState = 'committing';
    await conn.commit();
    transactionState = 'committed';

    return {
      asset: assetFromRow(afterRows[0]),
      duplicateOf,
      duplicateDetected,
      repaired: true,
      reused: false,
      previousState,
    };
  } catch (err) {
    if (transactionState === 'active') {
      try {
        await conn.rollback();
        transactionState = 'rolled_back';
      } catch {
        discardConnection = true;
      }
    } else if (transactionState === 'starting' || transactionState === 'committing') {
      discardConnection = true;
    }
    throw err;
  } finally {
    await locked.release({ discard: discardConnection });
  }
}

export async function listAssets({ limit = 100 } = {}) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute(
    `SELECT sa.*, ds.name AS discovery_source_name, ds.parser_key AS discovery_source_parser_key
     FROM source_assets sa
     LEFT JOIN discovery_sources ds ON ds.id = sa.discovery_source_id
     ORDER BY sa.created_at DESC, sa.id DESC
     LIMIT ?`,
    [limit]
  );
  return rows.map(assetFromRow);
}

export async function getAsset(id) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute(
    `SELECT sa.*, ds.name AS discovery_source_name, ds.parser_key AS discovery_source_parser_key
     FROM source_assets sa
     LEFT JOIN discovery_sources ds ON ds.id = sa.discovery_source_id
     WHERE sa.id = ?`,
    [id]
  );
  return assetFromRow(rows[0]);
}

export async function getAssetFileStatus(root, asset, {
  storage = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!asset) return { status: 'missing', exists: false, repairAvailable: false };
  const repaired = Boolean(asset.metadataJson?.file_repair?.status === 'repaired');
  let exists = false;
  let integrityError = null;
  try {
    exists = await assetStorageExists({ root, asset, storage, env, fetchImpl });
  } catch (err) {
    if (!(err instanceof AssetIntegrityError)) throw err;
    integrityError = err;
  }
  return {
    status: integrityError ? 'invalid' : exists && repaired ? 'repaired' : exists ? 'present' : 'missing',
    exists,
    repaired,
    repairAvailable: !exists && Boolean(asset.sourceUrl && asset.discoverySourceId),
    checkedPath: asset.localStoragePath || (asset.storageKey ? `${asset.storageProvider}:${asset.storageKey}` : null),
    storageProvider: asset.storageProvider,
    storageKey: asset.storageKey,
    integrityError: integrityError?.message || null,
    repairedAt: asset.metadataJson?.file_repair?.repaired_at || null,
  };
}

export async function latestAssetForSource(discoverySourceId) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute(
    `SELECT sa.*, ds.name AS discovery_source_name, ds.parser_key AS discovery_source_parser_key
     FROM source_assets sa
     LEFT JOIN discovery_sources ds ON ds.id = sa.discovery_source_id
     WHERE sa.discovery_source_id = ?
     ORDER BY sa.downloaded_at DESC, sa.id DESC
     LIMIT 1`,
    [normalizeId(discoverySourceId, 'Discovery source ID')]
  );
  return assetFromRow(rows[0]);
}

export async function updateAssetMetadata({ id, metadata = {}, actor = null }) {
  const pool = await getDbPool({ requireConfigured: true });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [beforeRows] = await conn.execute('SELECT * FROM source_assets WHERE id = ? FOR UPDATE', [id]);
    const before = beforeRows[0];
    if (!before) throw new Error(`Source asset not found: ${id}`);

    await conn.execute(
      `UPDATE source_assets
       SET etag = ?, last_modified = ?
       WHERE id = ?`,
      [clean(metadata.etag) || before.etag, clean(metadata.lastModified || metadata.last_modified) || before.last_modified, id]
    );
    const [afterRows] = await conn.execute('SELECT * FROM source_assets WHERE id = ?', [id]);
    await conn.execute(
      `INSERT INTO audit_log
        (actor, action, entity_type, entity_id, before_json, after_json)
       VALUES (?, 'source_asset.metadata_update', 'source_asset', ?, ?, ?)`,
      [actor, String(id), JSON.stringify(before), JSON.stringify(afterRows[0])]
    );
    await conn.commit();
    return assetFromRow(afterRows[0]);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export function assetErrorSummary(err) {
  const safe = describeDbError(err);
  if (err?.name === 'DatabaseConfigError') {
    return 'Asset management requires MySQL configuration. Set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, and run migrations.';
  }
  if (safe.code === 'ER_NO_SUCH_TABLE' || safe.code === 'ER_BAD_FIELD_ERROR') {
    return 'Asset tables are missing or out of date. Run npm run db:migrate.';
  }
  if (safe.code === 'ER_DUP_ENTRY') {
    return 'An asset row with that source URL already exists.';
  }
  if (safe.code === 'ER_NO_REFERENCED_ROW_2') {
    return 'Referenced discovery source does not exist.';
  }
  return `${safe.code ? `${safe.code}: ` : ''}${safe.message}`;
}
