import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describeDbError, getDbPool } from './db.js';

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.html', '.htm', '.zip', '.png', '.jpg', '.jpeg', '.gif', '.webp']);
const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'text/html',
  'application/zip',
  'application/x-zip-compressed',
  'image/',
];

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

function normalizeSourceUrl(value, fallback) {
  const raw = clean(value);
  if (!raw) return fallback;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Source URL must use http or https.');
    }
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
  return {
    id: row.id,
    discoverySourceId: row.discovery_source_id,
    discoverySourceName: row.discovery_source_name,
    discoverySourceParserKey: row.discovery_source_parser_key,
    sourceUrl: row.source_url ?? row.url,
    originalFilename: row.original_filename,
    contentType: row.content_type,
    fileSize: row.file_size,
    sha256Checksum: row.sha256_checksum ?? row.checksum,
    etag: row.etag,
    lastModified: row.last_modified,
    localStoragePath: row.local_storage_path ?? row.storage_path,
    downloadedAt: row.downloaded_at ?? row.fetched_at,
    downloadStatus: row.download_status ?? row.status,
    downloadError: row.download_error,
    duplicateOfAssetId: row.duplicate_of_asset_id,
    createdAt: row.created_at,
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

async function nextStoragePath({ root, sourceId, filename, checksum, now = new Date() }) {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const safeName = sanitizeFilename(filename);
  const relativeDir = path.join('storage', 'source-assets', String(sourceId), year, month);
  const absoluteDir = path.join(root, relativeDir);
  await fs.mkdir(absoluteDir, { recursive: true });

  let candidate = safeName;
  let absolutePath = path.join(absoluteDir, candidate);
  try {
    await fs.access(absolutePath);
    const ext = path.extname(safeName);
    const stem = safeName.slice(0, safeName.length - ext.length);
    candidate = `${stem}-${checksum.slice(0, 12)}${ext}`;
    absolutePath = path.join(absoluteDir, candidate);
  } catch {
    // The preferred immutable path is available.
  }

  return {
    relativePath: path.join(relativeDir, candidate),
    absolutePath,
  };
}

async function findDuplicate(conn, checksum) {
  const [rows] = await conn.execute(
    `SELECT sa.*, ds.name AS discovery_source_name
     FROM source_assets sa
     LEFT JOIN discovery_sources ds ON ds.id = sa.discovery_source_id
     WHERE sa.sha256_checksum = ?
       AND sa.download_status IN ('stored', 'duplicate')
       AND sa.local_storage_path IS NOT NULL
     ORDER BY sa.duplicate_of_asset_id IS NULL DESC, sa.id ASC
     LIMIT 1`,
    [checksum]
  );
  return assetFromRow(rows[0]);
}

export async function registerAsset({
  root,
  discoverySourceId,
  sourceUrl = '',
  originalFilename,
  contentType = '',
  buffer,
  etag = null,
  lastModified = null,
  assetKind = 'manual_upload',
  actor = null,
}) {
  const sourceId = normalizeId(discoverySourceId, 'Discovery source ID');
  const filename = validateUploadAsset({ filename: originalFilename, contentType, buffer });
  const checksum = calculateSHA256(buffer);
  const pool = await getDbPool({ requireConfigured: true });
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    const [sourceRows] = await conn.execute('SELECT id FROM discovery_sources WHERE id = ? FOR UPDATE', [sourceId]);
    if (!sourceRows[0]) throw new Error(`Discovery source not found: ${sourceId}`);

    const duplicate = await findDuplicate(conn, checksum);
    const now = new Date();
    const fallbackUrl = `upload://${sourceId}/${checksum}/${crypto.randomUUID()}/${encodeURIComponent(filename)}`;
    const normalizedSourceUrl = normalizeSourceUrl(sourceUrl, fallbackUrl);

    let localStoragePath;
    let downloadStatus = 'stored';
    let duplicateOfAssetId = null;

    if (duplicate) {
      localStoragePath = duplicate.localStoragePath;
      downloadStatus = 'duplicate';
      duplicateOfAssetId = duplicate.duplicateOfAssetId || duplicate.id;
    } else {
      const storagePath = await nextStoragePath({ root, sourceId, filename, checksum, now });
      await fs.writeFile(storagePath.absolutePath, buffer, { flag: 'wx' });
      localStoragePath = storagePath.relativePath;
    }

    const [result] = await conn.execute(
      `INSERT INTO source_assets
        (discovery_source_id, source_url, url, original_filename, asset_kind, content_type,
         file_size, sha256_checksum, checksum, etag, last_modified, local_storage_path,
         storage_path, downloaded_at, fetched_at, download_status, status,
         download_error, duplicate_of_asset_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, NULL, ?)`,
      [
        sourceId,
        normalizedSourceUrl,
        normalizedSourceUrl,
        filename,
        clean(assetKind) || 'manual_upload',
        clean(contentType) || null,
        buffer.length,
        checksum,
        checksum,
        clean(etag) || null,
        clean(lastModified) || null,
        localStoragePath,
        localStoragePath,
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
    await conn.commit();

    return {
      asset: assetFromRow(afterRows[0]),
      duplicateOf: duplicate,
      duplicateDetected: Boolean(duplicate),
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
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
