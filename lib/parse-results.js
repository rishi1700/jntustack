import fs from 'node:fs/promises';
import path from 'node:path';
import { getAsset } from './assets.js';
import { describeDbError, getDbPool } from './db.js';
import { getParser } from './parsers/index.js';

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  return JSON.parse(value);
}

function resultFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    assetId: row.asset_id,
    parserKey: row.parser_key,
    parsedPayload: parseJson(row.parsed_payload_json, null),
    confidence: parseJson(row.confidence_json, null),
    parserVersion: row.parser_version,
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    assetFilename: row.original_filename,
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

async function readAssetBuffer(root, asset) {
  if (!asset?.localStoragePath) throw new Error('Asset has no local storage path.');
  const storageRoot = path.resolve(root, 'storage', 'source-assets');
  const absolutePath = path.resolve(root, asset.localStoragePath);
  if (!absolutePath.startsWith(`${storageRoot}${path.sep}`)) {
    throw new Error('Asset storage path is outside storage/source-assets.');
  }
  return fs.readFile(absolutePath);
}

async function insertParseResult(conn, { assetId, parser, parsedPayload = null, confidence = null, status, errorMessage = null }) {
  const [result] = await conn.execute(
    `INSERT INTO parse_results
      (asset_id, parser_key, parsed_payload_json, confidence_json, parser_version, status, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      assetId,
      parser.key,
      parsedPayload == null ? null : JSON.stringify(parsedPayload),
      confidence == null ? null : JSON.stringify(confidence),
      parser.version,
      status,
      errorMessage,
    ]
  );
  return result.insertId;
}

export async function runParser({ root, assetId, parserKey, actor = null }) {
  const asset = await getAsset(assetId);
  if (!asset) throw new Error(`Source asset not found: ${assetId}`);

  const parser = getParser(parserKey);
  if (!parser) throw new Error(`Parser not registered: ${parserKey}`);

  const pool = await getDbPool({ requireConfigured: true });
  const conn = await pool.getConnection();
  await audit(conn, {
    actor,
    action: 'parser.run',
    entityType: 'source_asset',
    entityId: asset.id,
    after: { asset_id: asset.id, parser_key: parser.key, parser_version: parser.version },
  });
  if (parser.sourceSpecific) {
    await audit(conn, {
      actor,
      action: 'parser.source_specific_run',
      entityType: 'source_asset',
      entityId: asset.id,
      after: { asset_id: asset.id, parser_key: parser.key, parser_version: parser.version },
    });
  }

  try {
    if (parser.available === false) {
      throw new Error(parser.unavailableReason || `Parser is unavailable: ${parser.key}`);
    }
    const buffer = await readAssetBuffer(root, asset);
    const parsed = await parser.parse({ asset, buffer, root });
    const parseResultId = await insertParseResult(conn, {
      assetId: asset.id,
      parser,
      parsedPayload: parsed.parsedPayload,
      confidence: parsed.confidence,
      status: 'success',
    });
    const [rows] = await conn.execute('SELECT * FROM parse_results WHERE id = ?', [parseResultId]);
    await audit(conn, {
      actor,
      action: 'parser.success',
      entityType: 'parse_result',
      entityId: parseResultId,
      after: rows[0],
    });
    return resultFromRow(rows[0]);
  } catch (err) {
    const parseResultId = await insertParseResult(conn, {
      assetId: asset.id,
      parser,
      parsedPayload: null,
      confidence: { requires_human_review: true },
      status: 'error',
      errorMessage: err.message || String(err),
    });
    const [rows] = await conn.execute('SELECT * FROM parse_results WHERE id = ?', [parseResultId]);
    await audit(conn, {
      actor,
      action: 'parser.error',
      entityType: 'parse_result',
      entityId: parseResultId,
      after: rows[0],
    });
    return resultFromRow(rows[0]);
  } finally {
    conn.release();
  }
}

export async function listParseResultsForAsset(assetId, { limit = 50 } = {}) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute(
    `SELECT pr.*, sa.original_filename
     FROM parse_results pr
     LEFT JOIN source_assets sa ON sa.id = pr.asset_id
     WHERE pr.asset_id = ?
     ORDER BY pr.created_at DESC, pr.id DESC
     LIMIT ?`,
    [assetId, limit]
  );
  return rows.map(resultFromRow);
}

export async function listParseResults({ limit = 100 } = {}) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute(
    `SELECT pr.*, sa.original_filename
     FROM parse_results pr
     LEFT JOIN source_assets sa ON sa.id = pr.asset_id
     ORDER BY pr.created_at DESC, pr.id DESC
     LIMIT ?`,
    [limit]
  );
  return rows.map(resultFromRow);
}

export async function getParseResult(id) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute(
    `SELECT pr.*, sa.original_filename
     FROM parse_results pr
     LEFT JOIN source_assets sa ON sa.id = pr.asset_id
     WHERE pr.id = ?`,
    [id]
  );
  return resultFromRow(rows[0]);
}

export function parseResultErrorSummary(err) {
  const safe = describeDbError(err);
  if (err?.name === 'DatabaseConfigError') {
    return 'Parser framework requires MySQL configuration. Set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, and run migrations.';
  }
  if (safe.code === 'ER_NO_SUCH_TABLE' || safe.code === 'ER_BAD_FIELD_ERROR') {
    return 'Parse result tables are missing or out of date. Run npm run db:migrate.';
  }
  return `${safe.code ? `${safe.code}: ` : ''}${safe.message}`;
}
