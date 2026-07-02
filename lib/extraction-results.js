import { describeDbError, getDbPool } from './db.js';
import { extractEntityPayload } from './entity-extractors/index.js';
import { getParseResult } from './parse-results.js';
import { validateProposalPayload } from './proposal-validation.js';

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  return JSON.parse(value);
}

function extractionResultFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    parseResultId: row.parse_result_id,
    entityType: row.entity_type,
    entityKey: row.entity_key,
    extractedPayload: parseJson(row.extracted_payload_json, null),
    confidence: parseJson(row.confidence_json, null),
    validationStatus: row.validation_status || 'not_validated',
    validationErrors: parseJson(row.validation_errors_json, []),
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    parserKey: row.parser_key,
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

async function insertExtractionResult(conn, {
  parseResultId,
  entityType,
  entityKey = null,
  extractedPayload = null,
  confidence = null,
  validationStatus = 'not_validated',
  validationErrors = [],
  status,
  errorMessage = null,
}) {
  const [result] = await conn.execute(
    `INSERT INTO extraction_results
      (parse_result_id, entity_type, entity_key, extracted_payload_json,
       confidence_json, validation_status, validation_errors_json, status, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      parseResultId,
      entityType,
      entityKey,
      extractedPayload == null ? null : JSON.stringify(extractedPayload),
      confidence == null ? null : JSON.stringify(confidence),
      validationStatus,
      JSON.stringify(validationErrors || []),
      status,
      errorMessage,
    ]
  );
  return result.insertId;
}

export async function runEntityExtraction({
  root,
  parseResultId,
  entityType,
  entityKey = '',
  hints = {},
  candidateIndex = null,
  actor = null,
}) {
  const parseResult = await getParseResult(parseResultId);
  if (!parseResult) throw new Error(`Parse result not found: ${parseResultId}`);

  const pool = await getDbPool({ requireConfigured: true });
  const conn = await pool.getConnection();
  await audit(conn, {
    actor,
    action: 'extraction.run',
    entityType: 'parse_result',
    entityId: parseResultId,
    after: { parse_result_id: parseResultId, entity_type: entityType, entity_key: entityKey, hints, candidate_index: candidateIndex },
  });
  if (candidateIndex !== null && candidateIndex !== '') {
    await audit(conn, {
      actor,
      action: 'extraction.from_candidate',
      entityType: 'parse_result',
      entityId: parseResultId,
      after: { parse_result_id: parseResultId, entity_type: entityType, entity_key: entityKey, candidate_index: Number(candidateIndex) },
    });
  }

  try {
    if (parseResult.status !== 'success') {
      throw new Error('Only successful parse results can be extracted.');
    }
    const extracted = extractEntityPayload({
      parsedPayload: parseResult.parsedPayload,
      entityType,
      entityKey,
      hints,
      candidateIndex,
    });
    const validation = validateProposalPayload({
      root,
      entityType,
      payload: extracted.extractedPayload,
    });
    const extractionResultId = await insertExtractionResult(conn, {
      parseResultId,
      entityType,
      entityKey: extracted.entityKey,
      extractedPayload: validation.normalizedPayload,
      confidence: extracted.confidence,
      validationStatus: validation.status,
      validationErrors: validation.errors,
      status: 'success',
    });
    const [rows] = await conn.execute('SELECT * FROM extraction_results WHERE id = ?', [extractionResultId]);
    await audit(conn, {
      actor,
      action: 'extraction.success',
      entityType: 'extraction_result',
      entityId: extractionResultId,
      after: rows[0],
    });
    return extractionResultFromRow(rows[0]);
  } catch (err) {
    const extractionResultId = await insertExtractionResult(conn, {
      parseResultId,
      entityType,
      entityKey: entityKey || null,
      confidence: { requires_human_review: true, no_auto_proposal: true },
      validationStatus: 'failed',
      validationErrors: [{ path: '/', message: err.message || String(err), keyword: 'extraction_error', params: {} }],
      status: 'error',
      errorMessage: err.message || String(err),
    });
    const [rows] = await conn.execute('SELECT * FROM extraction_results WHERE id = ?', [extractionResultId]);
    await audit(conn, {
      actor,
      action: 'extraction.error',
      entityType: 'extraction_result',
      entityId: extractionResultId,
      after: rows[0],
    });
    return extractionResultFromRow(rows[0]);
  } finally {
    conn.release();
  }
}

export async function listExtractionResultsForParseResult(parseResultId, { limit = 50 } = {}) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute(
    `SELECT er.*, pr.parser_key
     FROM extraction_results er
     LEFT JOIN parse_results pr ON pr.id = er.parse_result_id
     WHERE er.parse_result_id = ?
     ORDER BY er.created_at DESC, er.id DESC
     LIMIT ?`,
    [parseResultId, limit]
  );
  return rows.map(extractionResultFromRow);
}

export async function getExtractionResult(id) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute(
    `SELECT er.*, pr.parser_key
     FROM extraction_results er
     LEFT JOIN parse_results pr ON pr.id = er.parse_result_id
     WHERE er.id = ?`,
    [id]
  );
  return extractionResultFromRow(rows[0]);
}

export function extractionResultErrorSummary(err) {
  const safe = describeDbError(err);
  if (err?.name === 'DatabaseConfigError') {
    return 'Entity extraction requires MySQL configuration. Set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, and run migrations.';
  }
  if (safe.code === 'ER_NO_SUCH_TABLE' || safe.code === 'ER_BAD_FIELD_ERROR') {
    return 'Extraction result tables are missing or out of date. Run npm run db:migrate.';
  }
  return `${safe.code ? `${safe.code}: ` : ''}${safe.message}`;
}
