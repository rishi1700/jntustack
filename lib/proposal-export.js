import fs from 'node:fs/promises';
import path from 'node:path';
import { loadContent } from './content-store/index.js';
import { describeDbError, getDbPool } from './db.js';
import { getContentProposal } from './proposals.js';
import { validateProposalPayload } from './proposal-validation.js';
import { isVerifiedPromotionDiff } from './verification-review.js';

const SUPPORTED_ENTITY_TYPES = new Set(['subject', 'college', 'branch_profile']);
const EXPORTABLE_PROPOSAL_STATUS = 'approved_for_draft';

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  return JSON.parse(value);
}

function exportFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    proposalId: row.proposal_id,
    exportPath: row.export_path,
    exportPayload: parseJson(row.export_payload_json, null),
    validationStatus: row.validation_status || 'not_validated',
    validationErrors: parseJson(row.validation_errors_json, []),
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function collegeStableKey(college) {
  return [
    college.affiliated_to || '',
    college.short_code || '',
    college.name || '',
    college.location?.district || '',
  ].join(':');
}

function findTarget(content, entityType, entityKey, payload) {
  const key = normalize(entityKey);
  if (entityType === 'subject') {
    const payloadKeys = [
      key,
      normalize(payload?.id),
      normalize(payload?.seo?.slug),
      normalize(payload?.subject_code),
      normalize(payload?.name),
    ].filter(Boolean);
    const index = (content.data.subjects || []).findIndex(subject => [
      subject.id,
      subject.seo?.slug,
      subject.subject_code,
      subject.name,
    ].some(candidate => payloadKeys.includes(normalize(candidate))));
    return {
      collection: 'subjects',
      dataFileHint: `data/subjects-${normalize(payload?.branch || 'branch') || 'branch'}.json`,
      index,
    };
  }
  if (entityType === 'college') {
    const payloadKeys = [
      key,
      normalize(payload?.short_code),
      normalize(payload?.name),
      normalize(payload?.official_website),
    ].filter(Boolean);
    const index = (content.colleges || []).findIndex(college => [
      collegeStableKey(college),
      college.short_code,
      college.name,
      college.official_website,
    ].some(candidate => payloadKeys.includes(normalize(candidate))));
    return {
      collection: 'colleges',
      dataFileHint: `data/colleges-${normalize(payload?.affiliated_to || 'campus') || 'campus'}.json`,
      index,
    };
  }
  const payloadKeys = [
    key,
    normalize(payload?.branch),
  ].filter(Boolean);
  const index = (content.branchProfiles || []).findIndex(profile => [
    profile.branch,
    profile.tagline,
  ].some(candidate => payloadKeys.includes(normalize(candidate))));
  return {
    collection: 'branch_profiles',
    dataFileHint: 'data/branch-guide-data.json',
    index,
  };
}

function patchForTarget(target, payload) {
  if (target.index >= 0) {
    return [{
      op: 'replace',
      path: `/${target.collection}/${target.index}`,
      value: payload,
    }];
  }
  return [{
    op: 'add',
    path: `/${target.collection}/-`,
    value: payload,
  }];
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

async function writeExportFiles(root, proposalId, exportPayload, replacement, patch) {
  const relativeDir = path.join('tmp', 'proposal-exports', String(proposalId));
  const absoluteDir = path.join(root, relativeDir);
  await fs.mkdir(absoluteDir, { recursive: true });
  await fs.writeFile(path.join(absoluteDir, 'export.json'), `${JSON.stringify(exportPayload, null, 2)}\n`);
  await fs.writeFile(path.join(absoluteDir, 'replacement.json'), `${JSON.stringify(replacement, null, 2)}\n`);
  await fs.writeFile(path.join(absoluteDir, 'patch.json'), `${JSON.stringify(patch, null, 2)}\n`);
  return relativeDir;
}

export async function exportProposalForReview({ root, proposalId, actor = null }) {
  await audit({
    actor,
    action: 'proposal_export.run',
    entityType: 'content_proposal',
    entityId: proposalId,
    after: { proposal_id: proposalId },
  });

  try {
    const proposal = await getContentProposal(proposalId);
    if (!proposal) throw new Error(`Content proposal not found: ${proposalId}`);
    if (!SUPPORTED_ENTITY_TYPES.has(proposal.entityType)) {
      throw new Error(`Unsupported export entity type: ${proposal.entityType}`);
    }
    if (proposal.validationStatus !== 'passed') {
      throw new Error('Only proposals with passed validation can be exported for review.');
    }
    if (proposal.status !== EXPORTABLE_PROPOSAL_STATUS) {
      throw new Error('Only approved_for_draft proposals can be exported for review.');
    }

    const sourcePayload = proposal.normalizedPayload || proposal.proposedPayload;
    const verifiedPromotion = isVerifiedPromotionDiff(proposal.diff);
    const validation = validateProposalPayload({
      root,
      entityType: proposal.entityType,
      payload: sourcePayload,
      allowVerifiedSource: verifiedPromotion,
    });
    const content = await loadContent({ root });
    const target = findTarget(content, proposal.entityType, proposal.entityKey, validation.normalizedPayload);
    const patch = patchForTarget(target, validation.normalizedPayload);
    const exportPayload = {
      proposal_id: Number(proposal.id),
      entity_type: proposal.entityType,
      entity_key: proposal.entityKey,
      validation_status: validation.status,
      validation_errors: validation.errors,
      target: {
        collection: target.collection,
        data_file_hint: target.dataFileHint,
        operation: target.index >= 0 ? 'replace' : 'add',
        index: target.index >= 0 ? target.index : null,
      },
      patch,
      replacement: validation.normalizedPayload,
      notes: verifiedPromotion ? [
        'Review artifact only.',
        'Verified promotion proposals must continue through release candidate, apply plan, and final live apply.',
        'Do not copy into data/*.json outside the guarded release workflow.',
      ] : [
        'Review artifact only.',
        'Do not copy into data/*.json without human review.',
        'This export does not publish or mark content verified.',
      ],
    };
    const exportPath = await writeExportFiles(root, proposal.id, exportPayload, validation.normalizedPayload, patch);

    const pool = await getDbPool({ requireConfigured: true });
    const [result] = await pool.execute(
      `INSERT INTO proposal_exports
        (proposal_id, export_path, export_payload_json, validation_status, validation_errors_json, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        proposal.id,
        exportPath,
        JSON.stringify(exportPayload),
        validation.status,
        JSON.stringify(validation.errors),
        actor,
      ]
    );
    const exportId = result.insertId;
    await audit({
      actor,
      action: 'proposal_export.success',
      entityType: 'proposal_export',
      entityId: exportId,
      after: { proposal_id: proposal.id, export_path: exportPath, validation_status: validation.status },
    });
    return getProposalExport(exportId);
  } catch (err) {
    await audit({
      actor,
      action: 'proposal_export.error',
      entityType: 'content_proposal',
      entityId: proposalId,
      after: { proposal_id: proposalId, error: err.message || String(err) },
    });
    throw err;
  }
}

export async function listProposalExports(proposalId, { limit = 25 } = {}) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute(
    `SELECT *
     FROM proposal_exports
     WHERE proposal_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    [proposalId, limit]
  );
  return rows.map(exportFromRow);
}

export async function getProposalExport(id) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute('SELECT * FROM proposal_exports WHERE id = ?', [id]);
  return exportFromRow(rows[0]);
}

export function proposalExportErrorSummary(err) {
  const safe = describeDbError(err);
  if (err?.name === 'DatabaseConfigError') {
    return 'Proposal export requires MySQL configuration. Set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, and run migrations.';
  }
  if (safe.code === 'ER_NO_SUCH_TABLE' || safe.code === 'ER_BAD_FIELD_ERROR') {
    return 'Proposal export tables are missing or out of date. Run npm run db:migrate.';
  }
  return `${safe.code ? `${safe.code}: ` : ''}${safe.message}`;
}
