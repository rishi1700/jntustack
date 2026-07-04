import fs from 'node:fs';
import path from 'node:path';
import { describeDbError, getDbPool } from './db.js';
import { extractEntityPayload } from './entity-extractors/index.js';
import { getParseResult } from './parse-results.js';
import { validateProposalPayload } from './proposal-validation.js';

let subjectCategoryCache = null;

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  return JSON.parse(value);
}

function extractionResultFromRow(row) {
  if (!row) return null;
  const extractedPayload = parseJson(row.extracted_payload_json, null);
  const mappingEvidence = parseJson(row.mapping_evidence_json, null);
  const result = {
    id: row.id,
    parseResultId: row.parse_result_id,
    entityType: row.entity_type,
    entityKey: row.entity_key,
    extractedPayload,
    confidence: parseJson(row.confidence_json, null),
    validationStatus: row.validation_status || 'not_validated',
    validationErrors: parseJson(row.validation_errors_json, []),
    mappedCategory: row.mapped_category || null,
    mappedBy: row.mapped_by || null,
    mappedAt: row.mapped_at || null,
    mappingNote: row.mapping_note || null,
    mappingEvidence,
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    parserKey: row.parser_key,
  };
  if (!result.mappingEvidence && row.parse_payload_json) {
    result.categoryEvidence = categoryEvidenceFromRow(row, result);
  } else {
    result.categoryEvidence = mappingEvidence;
  }
  return result;
}

export function subjectCategoryOptions(root = process.cwd()) {
  if (subjectCategoryCache) return subjectCategoryCache;
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'data', 'schema.json'), 'utf-8'));
  subjectCategoryCache = schema.definitions.Subject.properties.category.enum;
  return subjectCategoryCache;
}

function clean(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function candidateMatchesExtraction(candidate, payload) {
  if (!candidate || !payload) return false;
  const subjectCodeMatch = payload.subject_code && candidate.subject_code && clean(payload.subject_code) === clean(candidate.subject_code);
  const nameMatch = clean(candidate.name).toLowerCase() === clean(payload.name).toLowerCase();
  const yearMatch = Number(candidate.year || 0) === Number(payload.year || 0);
  const semesterMatch = Number(candidate.semester || 0) === Number(payload.semester || 0);
  return Boolean((subjectCodeMatch || nameMatch) && yearMatch && semesterMatch);
}

function categoryEvidenceFromRow(row, extraction) {
  const parsePayload = parseJson(row.parse_payload_json, null);
  const candidates = Array.isArray(parsePayload?.candidates) ? parsePayload.candidates : [];
  const payload = extraction.extractedPayload || {};
  const matched = candidates.find(candidate => candidateMatchesExtraction(candidate, payload)) || null;
  return {
    parse_result_id: row.parse_result_id,
    parser_key: row.parser_key || null,
    source_url: parsePayload?.source_url || payload.source?.origin_url || null,
    evidence_type: parsePayload?.evidence_type || null,
    subject_code: payload.subject_code || matched?.subject_code || null,
    title: payload.name || matched?.name || null,
    year: payload.year || matched?.year || null,
    semester: payload.semester || matched?.semester || null,
    year_sem_label: payload.year_sem_label || matched?.year_sem_label || null,
    credits: payload.credits || matched?.credits || null,
    page_number: matched?.evidence?.page_number || null,
    row_text: matched?.evidence?.row_text || null,
    section_label: matched?.evidence?.section_label || null,
    semester_heading: matched?.evidence?.semester_heading || null,
    category_reason: matched?.evidence?.category_reason || null,
    candidate_confidence: matched?.confidence || null,
  };
}

export function applyReviewerCategoryMappingToPayload({
  root = process.cwd(),
  entityType,
  extractedPayload,
  mappedCategory,
  mappingNote,
  mappedBy = null,
  evidenceReference = null,
}) {
  if (entityType !== 'subject') {
    throw new Error('Category mapping is only supported for subject extraction results.');
  }
  const note = clean(mappingNote);
  if (!note) throw new Error('Reviewer note is required for category mapping.');

  const category = clean(mappedCategory);
  const allowed = subjectCategoryOptions(root);
  if (!allowed.includes(category)) {
    throw new Error(`Invalid category "${category}". Choose one of: ${allowed.join(', ')}.`);
  }
  if (!extractedPayload || typeof extractedPayload !== 'object' || Array.isArray(extractedPayload)) {
    throw new Error('Extraction result does not contain an entity payload to map.');
  }

  const mappedPayload = {
    ...extractedPayload,
    category,
    source: {
      ...(extractedPayload.source || {}),
      status: 'needs_verification',
    },
  };
  const validation = validateProposalPayload({
    root,
    entityType,
    payload: mappedPayload,
  });
  return {
    mappedPayload: validation.normalizedPayload,
    validation,
    mapping: {
      mapped_category: category,
      mapped_by: mappedBy,
      mapping_note: note,
      evidence_reference: evidenceReference,
      source_status: validation.normalizedPayload?.source?.status || null,
    },
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

export async function listExtractionResults({ limit = 100 } = {}) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute(
    `SELECT er.*, pr.parser_key
     FROM extraction_results er
     LEFT JOIN parse_results pr ON pr.id = er.parse_result_id
     ORDER BY er.created_at DESC, er.id DESC
     LIMIT ?`,
    [limit]
  );
  return rows.map(extractionResultFromRow);
}

export async function getExtractionResult(id) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute(
    `SELECT er.*, pr.parser_key, pr.parsed_payload_json AS parse_payload_json
     FROM extraction_results er
     LEFT JOIN parse_results pr ON pr.id = er.parse_result_id
     WHERE er.id = ?`,
    [id]
  );
  return extractionResultFromRow(rows[0]);
}

export async function mapExtractionResultCategory({
  root = process.cwd(),
  extractionResultId,
  mappedCategory,
  mappingNote,
  actor = null,
}) {
  const pool = await getDbPool({ requireConfigured: true });
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute(
      `SELECT er.*, pr.parser_key, pr.parsed_payload_json AS parse_payload_json
       FROM extraction_results er
       LEFT JOIN parse_results pr ON pr.id = er.parse_result_id
       WHERE er.id = ?`,
      [extractionResultId]
    );
    const beforeRow = rows[0];
    const before = extractionResultFromRow(beforeRow);
    if (!before) throw new Error(`Extraction result not found: ${extractionResultId}`);
    if (before.status !== 'success') throw new Error('Only successful extraction results can be category-mapped.');

    const evidenceReference = categoryEvidenceFromRow(beforeRow, before);
    const mapped = applyReviewerCategoryMappingToPayload({
      root,
      entityType: before.entityType,
      extractedPayload: before.extractedPayload,
      mappedCategory,
      mappingNote,
      mappedBy: actor,
      evidenceReference,
    });
    const action = before.mappedCategory ? 'category_mapping.update' : 'category_mapping.create';

    await conn.execute(
      `UPDATE extraction_results
       SET extracted_payload_json = ?,
           validation_status = ?,
           validation_errors_json = ?,
           mapped_category = ?,
           mapped_by = ?,
           mapped_at = CURRENT_TIMESTAMP,
           mapping_note = ?,
           mapping_evidence_json = ?
       WHERE id = ?`,
      [
        JSON.stringify(mapped.mappedPayload),
        mapped.validation.status,
        JSON.stringify(mapped.validation.errors || []),
        mapped.mapping.mapped_category,
        actor,
        mapped.mapping.mapping_note,
        JSON.stringify(mapped.mapping.evidence_reference || null),
        extractionResultId,
      ]
    );

    await audit(conn, {
      actor,
      action,
      entityType: 'extraction_result',
      entityId: extractionResultId,
      before: {
        mapped_category: before.mappedCategory,
        validation_status: before.validationStatus,
        category: before.extractedPayload?.category,
      },
      after: {
        mapped_category: mapped.mapping.mapped_category,
        validation_status: mapped.validation.status,
        mapping_note: mapped.mapping.mapping_note,
        evidence_reference: mapped.mapping.evidence_reference,
      },
    });
    await audit(conn, {
      actor,
      action: mapped.validation.status === 'passed'
        ? 'category_mapping.validation_passed'
        : 'category_mapping.validation_failed',
      entityType: 'extraction_result',
      entityId: extractionResultId,
      after: {
        mapped_category: mapped.mapping.mapped_category,
        validation_status: mapped.validation.status,
        validation_errors: mapped.validation.errors,
      },
    });

    const [afterRows] = await conn.execute(
      `SELECT er.*, pr.parser_key, pr.parsed_payload_json AS parse_payload_json
       FROM extraction_results er
       LEFT JOIN parse_results pr ON pr.id = er.parse_result_id
       WHERE er.id = ?`,
      [extractionResultId]
    );
    return extractionResultFromRow(afterRows[0]);
  } finally {
    conn.release();
  }
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
