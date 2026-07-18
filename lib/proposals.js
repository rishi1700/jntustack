import { describeDbError, getDbPool } from './db.js';
import {
  normalizeEntityKey,
  validateProposalPayload,
} from './proposal-validation.js';
import { isVerifiedPromotionDiff } from './verification-review.js';
import { acquireReleasePublicationLocks } from './release-publication-lock.js';

const ACTIONS = {
  reject: {
    status: 'rejected',
    audit: 'content_proposal.reject',
    requireNote: true,
    allowedFrom: ['draft', 'needs_review', 'needs_verification', 'changes_requested', 'approved_for_draft', 'approved'],
  },
  mark_needs_verification: {
    status: 'needs_verification',
    audit: 'content_proposal.mark_needs_verification',
    requireNote: true,
    allowedFrom: ['needs_review', 'changes_requested', 'approved_for_draft'],
  },
  request_changes: {
    status: 'changes_requested',
    audit: 'content_proposal.request_changes',
    requireNote: true,
    allowedFrom: ['needs_review', 'needs_verification', 'approved_for_draft'],
  },
  approve_for_draft: {
    status: 'approved_for_draft',
    audit: 'proposal.approve_for_draft',
    requireNote: true,
    requireValidationPassed: true,
    allowedFrom: ['needs_review', 'needs_verification', 'changes_requested'],
  },
};

export function proposalActionAllowed(status, action) {
  return Boolean(ACTIONS[action]?.allowedFrom.includes(status));
}

const MANUAL_ENTITY_TYPES = new Set(['subject', 'college', 'branch_profile', 'guide']);

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

function diffSafetyWarnings(diffValue) {
  const diff = parseJson(diffValue, null);
  const warnings = diff?.safety?.warnings;
  return Array.isArray(warnings) ? warnings : [];
}

function blockingDiffSafetyWarnings(diffValue) {
  return diffSafetyWarnings(diffValue).filter(warning => warning?.blocking);
}

async function acquireProposalPublicationLocks(pool, proposalId) {
  const [rows] = await pool.execute(
    `SELECT DISTINCT release_candidate_id
     FROM release_candidate_items
     WHERE proposal_id = ?
     ORDER BY release_candidate_id ASC`,
    [proposalId]
  );
  return acquireReleasePublicationLocks(pool, rows.map(row => row.release_candidate_id));
}

async function assertProposalNotSealed(conn, proposalId) {
  const [rows] = await conn.execute(
    `SELECT gp.id, gp.status
     FROM github_publications gp
     INNER JOIN release_candidate_items rci
       ON rci.release_candidate_id = gp.release_candidate_id
     WHERE rci.proposal_id = ?
     ORDER BY gp.id DESC
     LIMIT 1
     FOR UPDATE`,
    [proposalId]
  );
  if (rows[0]) {
    throw new Error(
      `Proposal ${proposalId} is sealed in GitHub publication ${rows[0].id} (${rows[0].status}) and can no longer be changed. Create a new proposal instead.`
    );
  }
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
  const releaseLock = await acquireProposalPublicationLocks(pool, id);
  const conn = releaseLock.db;
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute('SELECT * FROM content_proposals WHERE id = ? FOR UPDATE', [id]);
    const before = rows[0];
    if (!before) throw new Error(`Content proposal not found: ${id}`);
    await assertProposalNotSealed(conn, id);
    const validation = validateProposalPayload({
      root,
      entityType: before.entity_type,
      payload: before.proposed_payload_json,
      allowVerifiedSource: isVerifiedPromotionDiff(before.diff_json),
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
    await releaseLock.release();
  }
}

export async function reviewContentProposal({ id, action, note = '', actor = null, safetyOverride = false }) {
  const config = ACTIONS[action];
  if (!config) throw new Error(`Unsupported proposal action: ${action}`);
  if (config.requireNote && !note.trim()) {
    if (action === 'approve_for_draft') {
      throw new Error('A reviewer note is required when approving for draft preparation.');
    }
    if (action === 'mark_needs_verification') {
      throw new Error('A reviewer note is required when marking a proposal as needing verification.');
    }
    if (action === 'reject') {
      throw new Error('A reviewer note is required when rejecting a proposal.');
    }
    throw new Error('A reviewer note is required for this review action.');
  }

  const pool = await getDbPool({ requireConfigured: true });
  const releaseLock = await acquireProposalPublicationLocks(pool, id);
  const conn = releaseLock.db;
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute('SELECT * FROM content_proposals WHERE id = ? FOR UPDATE', [id]);
    const before = rows[0];
    if (!before) throw new Error(`Content proposal not found: ${id}`);
    await assertProposalNotSealed(conn, id);
    if (!proposalActionAllowed(before.status, action)) {
      throw new Error(`Proposal action ${action} is not allowed from status ${before.status}. Refresh the review page and follow its next safe action.`);
    }
    if (config.requireValidationPassed && before.validation_status !== 'passed') {
      await conn.execute(
        `INSERT INTO audit_log
          (actor, action, entity_type, entity_id, before_json, after_json)
         VALUES (?, 'proposal.approval_blocked', 'content_proposal', ?, ?, ?)`,
        [
          actor,
          String(id),
          JSON.stringify(before),
          JSON.stringify({
            reason: 'validation_not_passed',
            validation_status: before.validation_status,
            source_id: before.source_id,
            parse_result_id: before.parse_result_id,
            diff_result_id: before.diff_result_id,
          }),
        ]
      );
      await conn.commit();
      const err = new Error('Proposal must pass validation before it can be approved for draft preparation.');
      err.auditCommitted = true;
      throw err;
    }

    const blockingSafetyWarnings = action === 'approve_for_draft'
      ? blockingDiffSafetyWarnings(before.diff_json)
      : [];
    if (blockingSafetyWarnings.length && !safetyOverride) {
      await conn.execute(
        `INSERT INTO audit_log
          (actor, action, entity_type, entity_id, before_json, after_json)
         VALUES (?, 'proposal.approval_blocked', 'content_proposal', ?, ?, ?)`,
        [
          actor,
          String(id),
          JSON.stringify(before),
          JSON.stringify({
            reason: 'blocking_diff_safety_warnings',
            warning_count: blockingSafetyWarnings.length,
            warnings: blockingSafetyWarnings,
          }),
        ]
      );
      await conn.commit();
      const err = new Error('Proposal has blocking diff safety warnings. Review them and use the explicit safety override checkbox before approving for draft preparation.');
      err.auditCommitted = true;
      throw err;
    }

    if (blockingSafetyWarnings.length && safetyOverride) {
      await conn.execute(
        `INSERT INTO review_events
          (proposal_id, actor, action, from_status, to_status, note)
         VALUES (?, ?, 'safety_override', ?, ?, ?)`,
        [id, actor, before.status, before.status, note || null]
      );
      await conn.execute(
        `INSERT INTO audit_log
          (actor, action, entity_type, entity_id, before_json, after_json)
         VALUES (?, 'proposal.safety_override', 'content_proposal', ?, ?, ?)`,
        [
          actor,
          String(id),
          JSON.stringify(before),
          JSON.stringify({
            warning_count: blockingSafetyWarnings.length,
            warnings: blockingSafetyWarnings,
            note,
          }),
        ]
      );
    }

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
    if (!err?.auditCommitted) await conn.rollback();
    throw err;
  } finally {
    await releaseLock.release();
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
