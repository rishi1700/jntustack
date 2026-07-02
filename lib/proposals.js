import { describeDbError, getDbPool } from './db.js';
import {
  normalizeEntityKey,
  validateProposalPayload,
} from './proposal-validation.js';

const ACTIONS = {
  reject: { status: 'rejected', audit: 'content_proposal.reject' },
  mark_needs_verification: { status: 'needs_verification', audit: 'content_proposal.mark_needs_verification' },
  request_changes: { status: 'changes_requested', audit: 'content_proposal.request_changes' },
};

const MANUAL_ENTITY_TYPES = new Set(['subject', 'college', 'branch_profile']);

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  return JSON.parse(value);
}

function proposalFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    entityType: row.entity_type,
    entityKey: row.entity_key,
    proposedPayload: parseJson(row.proposed_payload_json, {}),
    diff: parseJson(row.diff_json, null),
    parseResultId: row.parse_result_id,
    diffResultId: row.diff_result_id,
    validationStatus: row.validation_status || 'not_validated',
    validationErrors: parseJson(row.validation_errors_json, []),
    normalizedPayload: parseJson(row.normalized_payload_json, null),
    status: row.status,
    createdBy: row.created_by,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: row.source_id ? {
      id: row.source_id,
      originUrl: row.origin_url,
      sourceType: row.source_type,
      sourceName: row.source_name,
      retrievedAt: row.retrieved_at,
      status: row.source_status,
      caveatText: row.caveat_text,
      rawAssetPath: row.raw_asset_path,
    } : null,
  };
}

function eventFromRow(row) {
  return {
    id: row.id,
    actor: row.actor,
    action: row.action,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    note: row.note,
    createdAt: row.created_at,
  };
}

export async function listContentProposals({ limit = 100 } = {}) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute(
    `SELECT cp.*, s.origin_url, s.source_type, s.source_name, s.retrieved_at,
      s.status AS source_status, s.caveat_text, s.raw_asset_path
     FROM content_proposals cp
     LEFT JOIN sources s ON s.id = cp.source_id
     ORDER BY cp.updated_at DESC, cp.id DESC
     LIMIT ?`,
    [limit]
  );
  return rows.map(proposalFromRow);
}

export async function getContentProposal(id) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute(
    `SELECT cp.*, s.origin_url, s.source_type, s.source_name, s.retrieved_at,
      s.status AS source_status, s.caveat_text, s.raw_asset_path
     FROM content_proposals cp
     LEFT JOIN sources s ON s.id = cp.source_id
     WHERE cp.id = ?`,
    [id]
  );
  const proposal = proposalFromRow(rows[0]);
  if (!proposal) return null;

  const [events] = await pool.execute(
    `SELECT id, actor, action, from_status, to_status, note, created_at
     FROM review_events
     WHERE proposal_id = ?
     ORDER BY created_at DESC, id DESC`,
    [id]
  );
  return { ...proposal, events: events.map(eventFromRow) };
}

export async function getContentProposalByDiffResult(diffResultId) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute(
    `SELECT cp.*, s.origin_url, s.source_type, s.source_name, s.retrieved_at,
      s.status AS source_status, s.caveat_text, s.raw_asset_path
     FROM content_proposals cp
     LEFT JOIN sources s ON s.id = cp.source_id
     WHERE cp.diff_result_id = ?
     ORDER BY cp.id DESC
     LIMIT 1`,
    [diffResultId]
  );
  return proposalFromRow(rows[0]);
}


export async function createContentProposal({
  root = process.cwd(),
  entityType,
  entityKey,
  proposedPayload,
  diff = null,
  sourceId = null,
  parseResultId = null,
  diffResultId = null,
  status = 'needs_review',
  createdBy = null,
  note = '',
}) {
  if (!MANUAL_ENTITY_TYPES.has(entityType)) {
    throw new Error(`Unsupported manual proposal type: ${entityType}`);
  }
  if (!entityKey || !String(entityKey).trim()) {
    throw new Error('Entity key is required.');
  }

  const normalizedEntityKey = normalizeEntityKey(entityType, entityKey);
  const validation = validateProposalPayload({ root, entityType, payload: proposedPayload });
  const pool = await getDbPool({ requireConfigured: true });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      `INSERT INTO content_proposals
        (entity_type, entity_key, proposed_payload_json, diff_json, source_id,
         parse_result_id, diff_result_id, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entityType,
        normalizedEntityKey,
        JSON.stringify(validation.normalizedPayload),
        diff ? JSON.stringify(diff) : null,
        sourceId,
        parseResultId,
        diffResultId,
        status,
        createdBy,
      ]
    );
    const id = result.insertId;

    await conn.execute(
      `UPDATE content_proposals
       SET validation_status = ?, validation_errors_json = ?, normalized_payload_json = ?
       WHERE id = ?`,
      [
        validation.status,
        JSON.stringify(validation.errors),
        JSON.stringify(validation.normalizedPayload),
        id,
      ]
    );

    await conn.execute(
      `INSERT INTO review_events
        (proposal_id, actor, action, from_status, to_status, note)
       VALUES (?, ?, 'create', NULL, ?, ?)`,
      [id, createdBy, status, note || null]
    );

    const [afterRows] = await conn.execute('SELECT * FROM content_proposals WHERE id = ?', [id]);
    await conn.execute(
      `INSERT INTO audit_log
        (actor, action, entity_type, entity_id, before_json, after_json)
       VALUES (?, 'proposal.validation_run', 'content_proposal', ?, NULL, ?)`,
      [createdBy, String(id), JSON.stringify({ source: 'create', validation_status: validation.status })]
    );
    await conn.execute(
      `INSERT INTO audit_log
        (actor, action, entity_type, entity_id, before_json, after_json)
       VALUES (?, ?, 'content_proposal', ?, NULL, ?)`,
      [
        createdBy,
        validation.status === 'passed' ? 'proposal.validation_passed' : 'proposal.validation_failed',
        String(id),
        JSON.stringify({ validation_status: validation.status, validation_errors: validation.errors }),
      ]
    );
    await conn.execute(
      `INSERT INTO audit_log
        (actor, action, entity_type, entity_id, before_json, after_json)
       VALUES (?, 'content_proposal.create', 'content_proposal', ?, NULL, ?)`,
      [createdBy, String(id), JSON.stringify(afterRows[0])]
    );

    await conn.commit();
    return id;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function createContentProposalFromDiffResult({ root = process.cwd(), diffResultId, actor = null, note = '' }) {
  const pool = await getDbPool({ requireConfigured: true });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [existingRows] = await conn.execute(
      'SELECT id FROM content_proposals WHERE diff_result_id = ? LIMIT 1 FOR UPDATE',
      [diffResultId]
    );
    if (existingRows[0]) {
      await conn.commit();
      return { id: existingRows[0].id, created: false };
    }

    const [diffRows] = await conn.execute(
      `SELECT dr.*, pr.asset_id
       FROM diff_results dr
       LEFT JOIN parse_results pr ON pr.id = dr.parse_result_id
       WHERE dr.id = ?
       FOR UPDATE`,
      [diffResultId]
    );
    const diffResult = diffRows[0];
    if (!diffResult) throw new Error(`Diff result not found: ${diffResultId}`);
    if (diffResult.status !== 'success') {
      throw new Error('Only successful diff results can create proposals.');
    }
    if (!diffResult.proposed_payload_json) {
      throw new Error('Diff result does not contain a proposed payload.');
    }

    const validation = validateProposalPayload({
      root,
      entityType: diffResult.entity_type,
      payload: diffResult.proposed_payload_json,
    });
    const entityKey = normalizeEntityKey(diffResult.entity_type, diffResult.entity_key);

    const [insertResult] = await conn.execute(
      `INSERT INTO content_proposals
        (entity_type, entity_key, proposed_payload_json, diff_json, source_id,
         parse_result_id, diff_result_id, status, created_by)
       VALUES (?, ?, ?, ?, NULL, ?, ?, 'needs_review', ?)`,
      [
        diffResult.entity_type,
        entityKey,
        JSON.stringify(validation.normalizedPayload),
        diffResult.diff_json,
        diffResult.parse_result_id,
        diffResult.id,
        actor,
      ]
    );
    const id = insertResult.insertId;

    await conn.execute(
      `UPDATE content_proposals
       SET validation_status = ?, validation_errors_json = ?, normalized_payload_json = ?
       WHERE id = ?`,
      [
        validation.status,
        JSON.stringify(validation.errors),
        JSON.stringify(validation.normalizedPayload),
        id,
      ]
    );

    await conn.execute(
      `INSERT INTO review_events
        (proposal_id, actor, action, from_status, to_status, note)
       VALUES (?, ?, 'create_from_diff', NULL, 'needs_review', ?)`,
      [id, actor, note || `Created from diff result ${diffResult.id}`]
    );

    const [afterRows] = await conn.execute('SELECT * FROM content_proposals WHERE id = ?', [id]);
    await conn.execute(
      `INSERT INTO audit_log
        (actor, action, entity_type, entity_id, before_json, after_json)
       VALUES (?, 'proposal.validation_run', 'content_proposal', ?, NULL, ?)`,
      [actor, String(id), JSON.stringify({ source: 'create_from_diff', validation_status: validation.status })]
    );
    await conn.execute(
      `INSERT INTO audit_log
        (actor, action, entity_type, entity_id, before_json, after_json)
       VALUES (?, ?, 'content_proposal', ?, NULL, ?)`,
      [
        actor,
        validation.status === 'passed' ? 'proposal.validation_passed' : 'proposal.validation_failed',
        String(id),
        JSON.stringify({ validation_status: validation.status, validation_errors: validation.errors }),
      ]
    );
    await conn.execute(
      `INSERT INTO audit_log
        (actor, action, entity_type, entity_id, before_json, after_json)
       VALUES (?, 'content_proposal.create_from_diff', 'content_proposal', ?, NULL, ?)`,
      [actor, String(id), JSON.stringify(afterRows[0])]
    );

    await conn.commit();
    return { id, created: true };
  } catch (err) {
    await conn.rollback();
    if (err?.code === 'ER_DUP_ENTRY') {
      const [rows] = await pool.execute(
        'SELECT id FROM content_proposals WHERE diff_result_id = ? LIMIT 1',
        [diffResultId]
      );
      if (rows[0]) return { id: rows[0].id, created: false };
    }
    throw err;
  } finally {
    conn.release();
  }
}

export async function validateContentProposal({ root = process.cwd(), id, actor = null }) {
  const pool = await getDbPool({ requireConfigured: true });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute('SELECT * FROM content_proposals WHERE id = ? FOR UPDATE', [id]);
    const before = rows[0];
    if (!before) throw new Error(`Content proposal not found: ${id}`);

    const validation = validateProposalPayload({
      root,
      entityType: before.entity_type,
      payload: before.proposed_payload_json,
    });

    await conn.execute(
      `UPDATE content_proposals
       SET validation_status = ?, validation_errors_json = ?, normalized_payload_json = ?
       WHERE id = ?`,
      [
        validation.status,
        JSON.stringify(validation.errors),
        JSON.stringify(validation.normalizedPayload),
        id,
      ]
    );

    const [afterRows] = await conn.execute('SELECT * FROM content_proposals WHERE id = ?', [id]);
    await conn.execute(
      `INSERT INTO audit_log
        (actor, action, entity_type, entity_id, before_json, after_json)
       VALUES (?, 'proposal.validation_run', 'content_proposal', ?, ?, ?)`,
      [actor, String(id), JSON.stringify(before), JSON.stringify(afterRows[0])]
    );
    await conn.execute(
      `INSERT INTO audit_log
        (actor, action, entity_type, entity_id, before_json, after_json)
       VALUES (?, ?, 'content_proposal', ?, ?, ?)`,
      [
        actor,
        validation.status === 'passed' ? 'proposal.validation_passed' : 'proposal.validation_failed',
        String(id),
        JSON.stringify(before),
        JSON.stringify({ validation_status: validation.status, validation_errors: validation.errors }),
      ]
    );

    await conn.commit();
    return proposalFromRow(afterRows[0]);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function reviewContentProposal({ id, action, note = '', actor = null }) {
  const config = ACTIONS[action];
  if (!config) throw new Error(`Unsupported proposal action: ${action}`);
  if (action === 'request_changes' && !note.trim()) {
    throw new Error('A reviewer note is required when requesting changes.');
  }

  const pool = await getDbPool({ requireConfigured: true });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute('SELECT * FROM content_proposals WHERE id = ? FOR UPDATE', [id]);
    const before = rows[0];
    if (!before) throw new Error(`Content proposal not found: ${id}`);

    await conn.execute(
      `UPDATE content_proposals
       SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, review_note = ?
       WHERE id = ?`,
      [config.status, actor, note || null, id]
    );
    await conn.execute(
      `INSERT INTO review_events
        (proposal_id, actor, action, from_status, to_status, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, actor, action, before.status, config.status, note || null]
    );

    const [afterRows] = await conn.execute('SELECT * FROM content_proposals WHERE id = ?', [id]);
    await conn.execute(
      `INSERT INTO audit_log
        (actor, action, entity_type, entity_id, before_json, after_json)
       VALUES (?, ?, 'content_proposal', ?, ?, ?)`,
      [actor, config.audit, String(id), JSON.stringify(before), JSON.stringify(afterRows[0])]
    );

    await conn.commit();
    return proposalFromRow(afterRows[0]);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export function proposalErrorSummary(err) {
  const safe = describeDbError(err);
  if (err?.name === 'DatabaseConfigError') {
    return 'Review queue requires MySQL configuration. Set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, and run migrations.';
  }
  if (safe.code === 'ER_NO_SUCH_TABLE' || safe.code === 'ER_BAD_FIELD_ERROR') {
    return 'Review queue tables are missing or out of date. Run npm run db:migrate.';
  }
  return `${safe.code ? `${safe.code}: ` : ''}${safe.message}`;
}
