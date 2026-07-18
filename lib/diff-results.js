import { loadContent } from './content-store/index.js';
import { describeDbError, getDbPool } from './db.js';
import { createStructuredDiff } from './diff-engine.js';
import { getExtractionResult } from './extraction-results.js';
import { getParseResult } from './parse-results.js';

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  return JSON.parse(value);
}

function diffResultFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    parseResultId: row.parse_result_id,
    extractionResultId: row.extraction_result_id,
    entityType: row.entity_type,
    entityKey: row.entity_key,
    existingPayload: parseJson(row.existing_payload_json, null),
    proposedPayload: parseJson(row.proposed_payload_json, null),
    diff: parseJson(row.diff_json, null),
    confidence: parseJson(row.confidence_json, null),
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    parserKey: row.parser_key,
  };
}

const SUPPORTED_ENTITY_TYPES = new Set(['subject', 'college', 'branch_profile', 'guide']);

function validateDiffTarget({ entityType, entityKey }) {
  const cleanType = String(entityType || '').trim();
  const cleanKey = String(entityKey || '').trim();
  if (!cleanType) {
    throw new Error('Choose an entity type before running a diff.');
  }
  if (!SUPPORTED_ENTITY_TYPES.has(cleanType)) {
    throw new Error('Diff entity type must be subject, college, branch_profile, or guide.');
  }
  if (!cleanKey) {
    throw new Error('Enter an exact entity key before running a diff. Fuzzy matching is intentionally not automatic.');
  }
  return { entityType: cleanType, entityKey: cleanKey };
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

async function insertDiffResult(conn, {
  parseResultId,
  extractionResultId = null,
  entityType,
  entityKey,
  existingPayload = null,
  proposedPayload = null,
  diff = null,
  confidence = null,
  status,
  errorMessage = null,
}) {
  const [result] = await conn.execute(
    `INSERT INTO diff_results
      (parse_result_id, extraction_result_id, entity_type, entity_key, existing_payload_json,
       proposed_payload_json, diff_json, confidence_json, status, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      parseResultId,
      extractionResultId,
      entityType,
      entityKey,
      existingPayload == null ? null : JSON.stringify(existingPayload),
      proposedPayload == null ? null : JSON.stringify(proposedPayload),
      diff == null ? null : JSON.stringify(diff),
      confidence == null ? null : JSON.stringify(confidence),
      status,
      errorMessage,
    ]
  );
  return result.insertId;
}

async function createStoredDiff({
  root,
  parseResultId,
  extractionResultId = null,
  entityType,
  entityKey,
  proposedPayload = null,
  parsedPayload = null,
  actor = null,
  auditEntityType = 'parse_result',
  auditEntityId = parseResultId,
}) {
  const pool = await getDbPool({ requireConfigured: true });
  const conn = await pool.getConnection();
  await audit(conn, {
    actor,
    action: 'diff.run',
    entityType: auditEntityType,
    entityId: auditEntityId,
    after: { parse_result_id: parseResultId, extraction_result_id: extractionResultId, entity_type: entityType, entity_key: entityKey },
  });

  try {
    const content = await loadContent({ root });
    const structured = createStructuredDiff({
      content,
      parsedPayload,
      proposedPayload,
      entityType,
      entityKey,
    });
    const diffResultId = await insertDiffResult(conn, {
      parseResultId,
      extractionResultId,
      entityType,
      entityKey,
      existingPayload: structured.existingPayload,
      proposedPayload: structured.proposedPayload,
      diff: structured.diff,
      confidence: {
        ...structured.confidence,
        extraction_result_id: extractionResultId,
      },
      status: 'success',
    });
    const [rows] = await conn.execute('SELECT * FROM diff_results WHERE id = ?', [diffResultId]);
    await audit(conn, {
      actor,
      action: 'diff.success',
      entityType: 'diff_result',
      entityId: diffResultId,
      after: rows[0],
    });
    return diffResultFromRow(rows[0]);
  } catch (err) {
    const diffResultId = await insertDiffResult(conn, {
      parseResultId,
      extractionResultId,
      entityType,
      entityKey,
      confidence: { requires_human_review: true, no_auto_proposal: true, extraction_result_id: extractionResultId },
      status: 'error',
      errorMessage: err.message || String(err),
    });
    const [rows] = await conn.execute('SELECT * FROM diff_results WHERE id = ?', [diffResultId]);
    await audit(conn, {
      actor,
      action: 'diff.error',
      entityType: 'diff_result',
      entityId: diffResultId,
      after: rows[0],
    });
    return diffResultFromRow(rows[0]);
  } finally {
    conn.release();
  }
}

export async function createDiffFromParseResult({ root, parseResultId, entityType, entityKey, actor = null }) {
  const target = validateDiffTarget({ entityType, entityKey });
  const parseResult = await getParseResult(parseResultId);
  if (!parseResult) throw new Error(`Parse result not found: ${parseResultId}`);
  return createStoredDiff({
    root,
    parseResultId,
    entityType: target.entityType,
    entityKey: target.entityKey,
    parsedPayload: parseResult.parsedPayload,
    actor,
  });
}

export async function createDiffFromExtractionResult({ root, extractionResultId, actor = null }) {
  const extractionResult = await getExtractionResult(extractionResultId);
  if (!extractionResult) throw new Error(`Extraction result not found: ${extractionResultId}`);
  if (extractionResult.status !== 'success') {
    throw new Error('Only successful extraction results can be diffed.');
  }
  if (!extractionResult.entityKey) {
    throw new Error('Extraction result needs an entity key before a diff can be created.');
  }
  const target = validateDiffTarget({
    entityType: extractionResult.entityType,
    entityKey: extractionResult.entityKey,
  });
  return createStoredDiff({
    root,
    parseResultId: extractionResult.parseResultId,
    extractionResultId: extractionResult.id,
    entityType: target.entityType,
    entityKey: target.entityKey,
    proposedPayload: extractionResult.extractedPayload,
    actor,
    auditEntityType: 'extraction_result',
    auditEntityId: extractionResult.id,
  });
}

export async function listDiffResultsForParseResult(parseResultId, { limit = 50 } = {}) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute(
    `SELECT dr.*, pr.parser_key
     FROM diff_results dr
     LEFT JOIN parse_results pr ON pr.id = dr.parse_result_id
     WHERE dr.parse_result_id = ?
     ORDER BY dr.created_at DESC, dr.id DESC
     LIMIT ?`,
    [parseResultId, limit]
  );
  return rows.map(diffResultFromRow);
}

export async function listDiffResults({ limit = 100 } = {}) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute(
    `SELECT dr.*, pr.parser_key
     FROM diff_results dr
     LEFT JOIN parse_results pr ON pr.id = dr.parse_result_id
     ORDER BY dr.created_at DESC, dr.id DESC
     LIMIT ?`,
    [limit]
  );
  return rows.map(diffResultFromRow);
}

export async function getDiffResult(id) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute(
    `SELECT dr.*, pr.parser_key
     FROM diff_results dr
     LEFT JOIN parse_results pr ON pr.id = dr.parse_result_id
     WHERE dr.id = ?`,
    [id]
  );
  return diffResultFromRow(rows[0]);
}

export function diffResultErrorSummary(err) {
  const safe = describeDbError(err);
  if (err?.name === 'DatabaseConfigError') {
    return 'Diff engine requires MySQL configuration. Set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, and run migrations.';
  }
  if (safe.code === 'ER_NO_SUCH_TABLE' || safe.code === 'ER_BAD_FIELD_ERROR') {
    return 'Diff result tables are missing or out of date. Run npm run db:migrate.';
  }
  return `${safe.code ? `${safe.code}: ` : ''}${safe.message}`;
}
