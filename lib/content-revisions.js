import { describeDbError, getDbPool } from './db.js';

const SUPPORTED_ENTITY_TYPES = new Set(['subject', 'college', 'branch_profile']);

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  return JSON.parse(value);
}

function revisionFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    entityType: row.entity_type,
    entityKey: row.entity_key,
    revisionNumber: row.revision_number,
    content: parseJson(row.content_json, null),
    sourceStatus: row.source_status,
    proposalId: row.proposal_id,
    exportId: row.export_id,
    draftApplyId: row.draft_apply_id,
    parentRevisionId: row.parent_revision_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, stripUndefined(entry)])
    );
  }
  return value;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function valuesEqual(left, right) {
  return stableJson(stripUndefined(left)) === stableJson(stripUndefined(right));
}

function diffObjects(before, after, basePath = '') {
  const changes = [];
  const keys = new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ]);

  for (const key of [...keys].sort()) {
    const path = basePath ? `${basePath}.${key}` : key;
    const left = before?.[key];
    const right = after?.[key];
    if (
      left && right &&
      typeof left === 'object' &&
      typeof right === 'object' &&
      !Array.isArray(left) &&
      !Array.isArray(right)
    ) {
      changes.push(...diffObjects(left, right, path));
    } else if (!valuesEqual(left, right)) {
      changes.push({ path, before: left, after: right });
    }
  }

  return changes;
}

async function audit({ actor, action, entityType, entityId, before = null, after = null }) {
  const pool = await getDbPool({ requireConfigured: true });
  await pool.execute(
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

function assertRevisionInput({ entityType, entityKey, content }) {
  if (!SUPPORTED_ENTITY_TYPES.has(entityType)) {
    throw new Error(`Unsupported revision entity type: ${entityType}`);
  }
  if (!entityKey || !String(entityKey).trim()) {
    throw new Error('Entity key is required for content revision.');
  }
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    throw new Error('Revision content_json must be an object.');
  }
}

function inferSourceStatus(content, sourceStatus) {
  return String(sourceStatus || content?.source?.status || 'needs_verification').trim() || 'needs_verification';
}

export async function createRevision({
  entityType,
  entityKey,
  content,
  sourceStatus = null,
  proposalId = null,
  exportId = null,
  draftApplyId = null,
  parentRevisionId = undefined,
  createdBy = null,
  actor = createdBy,
}) {
  assertRevisionInput({ entityType, entityKey, content });
  const pool = await getDbPool({ requireConfigured: true });
  const latest = await getLatestRevision(entityType, entityKey);
  const resolvedParentRevisionId = parentRevisionId === undefined ? latest?.id || null : parentRevisionId;
  const revisionNumber = latest ? Number(latest.revisionNumber) + 1 : 1;
  const status = inferSourceStatus(content, sourceStatus);

  const [result] = await pool.execute(
    `INSERT INTO content_revisions
      (entity_type, entity_key, revision_number, content_json, source_status,
       proposal_id, export_id, draft_apply_id, parent_revision_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entityType,
      entityKey,
      revisionNumber,
      JSON.stringify(stripUndefined(content)),
      status,
      proposalId,
      exportId,
      draftApplyId,
      resolvedParentRevisionId,
      createdBy,
    ]
  );

  const revision = await getRevision(result.insertId);
  await audit({
    actor,
    action: 'content_revision.create',
    entityType: 'content_revision',
    entityId: revision.id,
    after: {
      entity_type: entityType,
      entity_key: entityKey,
      revision_number: revisionNumber,
      source_status: status,
      proposal_id: proposalId,
      export_id: exportId,
      draft_apply_id: draftApplyId,
      parent_revision_id: resolvedParentRevisionId,
    },
  });
  return revision;
}

export async function getRevision(id) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute('SELECT * FROM content_revisions WHERE id = ?', [id]);
  return revisionFromRow(rows[0]);
}

export async function getLatestRevision(entityType, entityKey) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute(
    `SELECT *
     FROM content_revisions
     WHERE entity_type = ? AND entity_key = ?
     ORDER BY revision_number DESC
     LIMIT 1`,
    [entityType, entityKey]
  );
  return revisionFromRow(rows[0]);
}

export async function listRevisions({ entityType = null, entityKey = null, limit = 100 } = {}) {
  const pool = await getDbPool({ requireConfigured: true });
  const params = [];
  const clauses = [];
  if (entityType) {
    clauses.push('entity_type = ?');
    params.push(entityType);
  }
  if (entityKey) {
    clauses.push('entity_key = ?');
    params.push(entityKey);
  }
  params.push(limit);
  const [rows] = await pool.execute(
    `SELECT *
     FROM content_revisions
     ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    params
  );
  return rows.map(revisionFromRow);
}

export async function listRevisionEntities({ limit = 100 } = {}) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute(
    `SELECT cr.*
     FROM content_revisions cr
     INNER JOIN (
       SELECT entity_type, entity_key, MAX(revision_number) AS revision_number
       FROM content_revisions
       GROUP BY entity_type, entity_key
     ) latest
       ON latest.entity_type = cr.entity_type
      AND latest.entity_key = cr.entity_key
      AND latest.revision_number = cr.revision_number
     ORDER BY cr.created_at DESC, cr.id DESC
     LIMIT ?`,
    [limit]
  );
  return rows.map(revisionFromRow);
}

export async function compareRevisions({ leftId, rightId, actor = null }) {
  const left = await getRevision(leftId);
  const right = await getRevision(rightId);
  if (!left) throw new Error(`Left revision not found: ${leftId}`);
  if (!right) throw new Error(`Right revision not found: ${rightId}`);
  if (left.entityType !== right.entityType || left.entityKey !== right.entityKey) {
    throw new Error('Revisions must belong to the same entity_type and entity_key to compare.');
  }

  const changes = diffObjects(left.content, right.content);
  const result = {
    left,
    right,
    diff: {
      algorithm: 'revision-json-compare',
      entity_type: left.entityType,
      entity_key: left.entityKey,
      from_revision_id: left.id,
      to_revision_id: right.id,
      from_revision_number: left.revisionNumber,
      to_revision_number: right.revisionNumber,
      change_count: changes.length,
      changes,
    },
  };

  await audit({
    actor,
    action: 'content_revision.compare',
    entityType: 'content_revision',
    entityId: `${left.id}:${right.id}`,
    after: {
      entity_type: left.entityType,
      entity_key: left.entityKey,
      left_revision_id: left.id,
      right_revision_id: right.id,
      change_count: changes.length,
    },
  });
  return result;
}

export function contentRevisionErrorSummary(err) {
  const safe = describeDbError(err);
  if (err?.name === 'DatabaseConfigError') {
    return 'Content revisions require MySQL configuration. Set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, and run migrations.';
  }
  if (safe.code === 'ER_NO_SUCH_TABLE' || safe.code === 'ER_BAD_FIELD_ERROR') {
    return 'Content revision tables are missing or out of date. Run npm run db:migrate.';
  }
  return `${safe.code ? `${safe.code}: ` : ''}${safe.message}`;
}
