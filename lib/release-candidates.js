import { describeDbError, getDbPool } from './db.js';
import { exportProposalForReview } from './proposal-export.js';
import { applyProposalExportToDraft } from './proposal-apply-draft.js';
import { generateReleaseReviewSummary } from './release-review.js';

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  return JSON.parse(value);
}

function releaseFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    itemCount: row.item_count ?? 0,
    exportedCount: row.exported_count ?? 0,
    draftAppliedCount: row.draft_applied_count ?? 0,
    revisionCount: row.revision_count ?? 0,
  };
}

function itemFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    releaseCandidateId: row.release_candidate_id,
    proposalId: row.proposal_id,
    proposalExportId: row.proposal_export_id,
    draftApplyId: row.draft_apply_id,
    revisionId: row.revision_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    proposal: {
      id: row.proposal_id,
      entityType: row.entity_type,
      entityKey: row.entity_key,
      status: row.proposal_status,
      validationStatus: row.validation_status,
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at,
      reviewNote: row.review_note,
    },
    export: row.proposal_export_id ? {
      id: row.proposal_export_id,
      validationStatus: row.export_validation_status,
      createdAt: row.export_created_at,
    } : null,
    draftApply: row.draft_apply_id ? {
      id: row.draft_apply_id,
      validationStatus: row.draft_validation_status,
      summary: parseJson(row.draft_summary_json, null),
      createdAt: row.draft_created_at,
    } : null,
  };
}

async function audit(connOrPool, { actor, action, entityType, entityId, before = null, after = null }) {
  await connOrPool.execute(
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

function assertTitle(title) {
  const clean = String(title || '').trim();
  if (!clean) throw new Error('Release candidate title is required.');
  if (clean.length > 255) throw new Error('Release candidate title must be 255 characters or less.');
  return clean;
}

export async function listReleaseCandidates({ limit = 100 } = {}) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute(
    `SELECT rc.*,
      COALESCE(counts.item_count, 0) AS item_count,
      COALESCE(counts.exported_count, 0) AS exported_count,
      COALESCE(counts.draft_applied_count, 0) AS draft_applied_count,
      COALESCE(counts.revision_count, 0) AS revision_count
     FROM release_candidates rc
     LEFT JOIN (
       SELECT release_candidate_id,
        COUNT(*) AS item_count,
        SUM(CASE WHEN proposal_export_id IS NULL THEN 0 ELSE 1 END) AS exported_count,
        SUM(CASE WHEN draft_apply_id IS NULL THEN 0 ELSE 1 END) AS draft_applied_count,
        SUM(CASE WHEN revision_id IS NULL THEN 0 ELSE 1 END) AS revision_count
       FROM release_candidate_items
       GROUP BY release_candidate_id
     ) counts ON counts.release_candidate_id = rc.id
     ORDER BY rc.updated_at DESC, rc.id DESC
     LIMIT ?`,
    [limit]
  );
  return rows.map(releaseFromRow);
}

export async function createReleaseCandidate({ title, actor = null }) {
  const cleanTitle = assertTitle(title);
  const pool = await getDbPool({ requireConfigured: true });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      `INSERT INTO release_candidates (title, status, created_by)
       VALUES (?, 'draft', ?)`,
      [cleanTitle, actor]
    );
    const id = result.insertId;
    const [rows] = await conn.execute('SELECT * FROM release_candidates WHERE id = ?', [id]);
    await audit(conn, {
      actor,
      action: 'release_candidate.create',
      entityType: 'release_candidate',
      entityId: id,
      after: rows[0],
    });
    await conn.commit();
    return id;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function getReleaseCandidate(id) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute(
    `SELECT rc.*,
      COALESCE(counts.item_count, 0) AS item_count,
      COALESCE(counts.exported_count, 0) AS exported_count,
      COALESCE(counts.draft_applied_count, 0) AS draft_applied_count,
      COALESCE(counts.revision_count, 0) AS revision_count
     FROM release_candidates rc
     LEFT JOIN (
       SELECT release_candidate_id,
        COUNT(*) AS item_count,
        SUM(CASE WHEN proposal_export_id IS NULL THEN 0 ELSE 1 END) AS exported_count,
        SUM(CASE WHEN draft_apply_id IS NULL THEN 0 ELSE 1 END) AS draft_applied_count,
        SUM(CASE WHEN revision_id IS NULL THEN 0 ELSE 1 END) AS revision_count
       FROM release_candidate_items
       GROUP BY release_candidate_id
     ) counts ON counts.release_candidate_id = rc.id
     WHERE rc.id = ?
     LIMIT 1`,
    [id]
  );
  const release = releaseFromRow(rows[0]);
  if (!release) return null;
  const items = await listReleaseCandidateItems(id);
  return { ...release, items };
}

export async function listReleaseCandidateItems(releaseCandidateId) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute(
    `SELECT rci.*,
      cp.entity_type, cp.entity_key, cp.status AS proposal_status, cp.validation_status,
      cp.reviewed_by, cp.reviewed_at, cp.review_note,
      pe.validation_status AS export_validation_status, pe.created_at AS export_created_at,
      pda.validation_status AS draft_validation_status, pda.summary_json AS draft_summary_json, pda.created_at AS draft_created_at
     FROM release_candidate_items rci
     INNER JOIN content_proposals cp ON cp.id = rci.proposal_id
     LEFT JOIN proposal_exports pe ON pe.id = rci.proposal_export_id
     LEFT JOIN proposal_draft_applies pda ON pda.id = rci.draft_apply_id
     WHERE rci.release_candidate_id = ?
     ORDER BY rci.created_at ASC, rci.id ASC`,
    [releaseCandidateId]
  );
  return rows.map(itemFromRow);
}

export async function listApprovedProposalsForRelease({ releaseCandidateId = null, limit = 100 } = {}) {
  const pool = await getDbPool({ requireConfigured: true });
  const params = [];
  let exclusion = '';
  if (releaseCandidateId) {
    exclusion = `AND cp.id NOT IN (
      SELECT proposal_id FROM release_candidate_items WHERE release_candidate_id = ?
    )`;
    params.push(releaseCandidateId);
  }
  params.push(limit);
  const [rows] = await pool.execute(
    `SELECT cp.id, cp.entity_type, cp.entity_key, cp.status, cp.validation_status,
      cp.reviewed_by, cp.reviewed_at, cp.review_note, cp.updated_at
     FROM content_proposals cp
     WHERE cp.status = 'approved_for_draft'
       AND cp.validation_status = 'passed'
       ${exclusion}
     ORDER BY cp.reviewed_at DESC, cp.id DESC
     LIMIT ?`,
    params
  );
  return rows.map(row => ({
    id: row.id,
    entityType: row.entity_type,
    entityKey: row.entity_key,
    status: row.status,
    validationStatus: row.validation_status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    updatedAt: row.updated_at,
  }));
}

export async function addProposalToReleaseCandidate({ releaseCandidateId, proposalId, actor = null }) {
  const pool = await getDbPool({ requireConfigured: true });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [releaseRows] = await conn.execute('SELECT * FROM release_candidates WHERE id = ? FOR UPDATE', [releaseCandidateId]);
    const release = releaseRows[0];
    if (!release) throw new Error(`Release candidate not found: ${releaseCandidateId}`);
    if (release.status !== 'draft') throw new Error('Only draft release candidates can be changed.');

    const [proposalRows] = await conn.execute('SELECT * FROM content_proposals WHERE id = ? FOR UPDATE', [proposalId]);
    const proposal = proposalRows[0];
    if (!proposal) throw new Error(`Content proposal not found: ${proposalId}`);
    if (proposal.status !== 'approved_for_draft') {
      throw new Error('Only proposals approved for draft can be added to a release candidate.');
    }
    if (proposal.validation_status !== 'passed') {
      throw new Error('Only proposals with passed validation can be added to a release candidate.');
    }

    const [result] = await conn.execute(
      `INSERT INTO release_candidate_items
        (release_candidate_id, proposal_id)
       VALUES (?, ?)`,
      [releaseCandidateId, proposalId]
    );
    await audit(conn, {
      actor,
      action: 'release_candidate.add_item',
      entityType: 'release_candidate',
      entityId: releaseCandidateId,
      after: {
        item_id: result.insertId,
        release_candidate_id: Number(releaseCandidateId),
        proposal_id: Number(proposalId),
        proposal_status: proposal.status,
        validation_status: proposal.validation_status,
      },
    });
    await conn.commit();
    return result.insertId;
  } catch (err) {
    await conn.rollback();
    if (err?.code === 'ER_DUP_ENTRY') {
      throw new Error('This proposal is already in the release candidate.');
    }
    throw err;
  } finally {
    conn.release();
  }
}

export async function removeProposalFromReleaseCandidate({ releaseCandidateId, itemId, actor = null }) {
  const pool = await getDbPool({ requireConfigured: true });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [releaseRows] = await conn.execute('SELECT * FROM release_candidates WHERE id = ? FOR UPDATE', [releaseCandidateId]);
    const release = releaseRows[0];
    if (!release) throw new Error(`Release candidate not found: ${releaseCandidateId}`);
    if (release.status !== 'draft') throw new Error('Only draft release candidates can be changed.');

    const [itemRows] = await conn.execute(
      'SELECT * FROM release_candidate_items WHERE id = ? AND release_candidate_id = ? FOR UPDATE',
      [itemId, releaseCandidateId]
    );
    const item = itemRows[0];
    if (!item) throw new Error(`Release candidate item not found: ${itemId}`);
    await conn.execute('DELETE FROM release_candidate_items WHERE id = ?', [itemId]);
    await audit(conn, {
      actor,
      action: 'release_candidate.remove_item',
      entityType: 'release_candidate',
      entityId: releaseCandidateId,
      before: item,
    });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function markReleaseCandidateReady({ releaseCandidateId, actor = null }) {
  const pool = await getDbPool({ requireConfigured: true });
  const summary = await generateReleaseReviewSummary({ releaseCandidateId, actor, auditEvents: true });
  if (summary.has_blocking_warnings) {
    await audit(pool, {
      actor,
      action: 'release_candidate.ready_blocked',
      entityType: 'release_candidate',
      entityId: releaseCandidateId,
      after: {
        blocking_warning_count: summary.blocking_warning_count,
        warning_codes: (summary.blocking_warnings || summary.warnings).map(warning => warning.code),
      },
    });
    throw new Error(`Release candidate has ${summary.blocking_warning_count} blocking warning(s). Generate and resolve the review summary before marking ready.`);
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [releaseRows] = await conn.execute('SELECT * FROM release_candidates WHERE id = ? FOR UPDATE', [releaseCandidateId]);
    const release = releaseRows[0];
    if (!release) throw new Error(`Release candidate not found: ${releaseCandidateId}`);
    if (!['draft', 'applied_to_draft'].includes(release.status)) {
      throw new Error('Only draft or applied_to_draft release candidates can be marked ready for review.');
    }
    await conn.execute(
      `UPDATE release_candidates
       SET status = 'ready_for_review'
       WHERE id = ?`,
      [releaseCandidateId]
    );
    const [afterRows] = await conn.execute('SELECT * FROM release_candidates WHERE id = ?', [releaseCandidateId]);
    await audit(conn, {
      actor,
      action: 'release_candidate.ready_for_review',
      entityType: 'release_candidate',
      entityId: releaseCandidateId,
      before: release,
      after: afterRows[0],
    });
    await conn.commit();
    return releaseFromRow(afterRows[0]);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function exportReleaseCandidateItem({ root, releaseCandidateId, itemId, actor = null }) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute(
    `SELECT rci.*, cp.status AS proposal_status
     FROM release_candidate_items rci
     INNER JOIN content_proposals cp ON cp.id = rci.proposal_id
     WHERE rci.id = ? AND rci.release_candidate_id = ?`,
    [itemId, releaseCandidateId]
  );
  const item = rows[0];
  if (!item) throw new Error(`Release candidate item not found: ${itemId}`);
  if (item.proposal_status !== 'approved_for_draft') {
    throw new Error('Only approved_for_draft proposals can be exported from a release candidate.');
  }
  const result = await exportProposalForReview({ root, proposalId: item.proposal_id, actor });
  await pool.execute(
    `UPDATE release_candidate_items
     SET proposal_export_id = ?
     WHERE id = ?`,
    [result.id, itemId]
  );
  return result;
}

export async function applyReleaseCandidateItemDraft({ root, releaseCandidateId, itemId, actor = null }) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute(
    `SELECT rci.*, cp.status AS proposal_status
     FROM release_candidate_items rci
     INNER JOIN content_proposals cp ON cp.id = rci.proposal_id
     WHERE rci.id = ? AND rci.release_candidate_id = ?`,
    [itemId, releaseCandidateId]
  );
  const item = rows[0];
  if (!item) throw new Error(`Release candidate item not found: ${itemId}`);
  if (item.proposal_status !== 'approved_for_draft') {
    throw new Error('Only approved_for_draft proposals can be applied from a release candidate.');
  }
  if (!item.proposal_export_id) throw new Error('Export the release candidate item before applying a draft.');
  const draftApply = await applyProposalExportToDraft({
    root,
    proposalExportId: item.proposal_export_id,
    actor,
  });
  const revisionId = draftApply.summary?.revision_id || null;
  await pool.execute(
    `UPDATE release_candidate_items
     SET draft_apply_id = ?, revision_id = ?
     WHERE id = ?`,
    [draftApply.id, revisionId, itemId]
  );

  const [countRows] = await pool.execute(
    `SELECT
      COUNT(*) AS item_count,
      SUM(CASE WHEN draft_apply_id IS NULL THEN 0 ELSE 1 END) AS draft_count
     FROM release_candidate_items
     WHERE release_candidate_id = ?`,
    [releaseCandidateId]
  );
  const counts = countRows[0] || {};
  if (Number(counts.item_count || 0) > 0 && Number(counts.item_count || 0) === Number(counts.draft_count || 0)) {
    await pool.execute(
      `UPDATE release_candidates
       SET status = 'applied_to_draft'
       WHERE id = ? AND status IN ('draft', 'ready_for_review')`,
      [releaseCandidateId]
    );
  }

  return draftApply;
}

export function releaseCandidateErrorSummary(err) {
  const safe = describeDbError(err);
  if (err?.name === 'DatabaseConfigError') {
    return 'Release candidates require MySQL configuration. Set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, and run migrations.';
  }
  if (safe.code === 'ER_NO_SUCH_TABLE' || safe.code === 'ER_BAD_FIELD_ERROR') {
    return 'Release candidate tables are missing or out of date. Run npm run db:migrate.';
  }
  return `${safe.code ? `${safe.code}: ` : ''}${safe.message}`;
}
