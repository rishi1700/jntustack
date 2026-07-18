import fs from 'node:fs/promises';
import path from 'node:path';
import { loadDataset, loadMergedColleges } from './dataset.js';
import { describeDbError, getDbPool } from './db.js';
import { getProposalExport } from './proposal-export.js';
import { createRevision } from './content-revisions.js';
import { validateData } from './validate.js';

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  return JSON.parse(value);
}

function applyFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    proposalExportId: row.proposal_export_id,
    proposalId: row.proposal_id,
    draftPath: row.draft_path,
    validationStatus: row.validation_status,
    validationErrors: parseJson(row.validation_errors_json, []),
    summary: parseJson(row.summary_json, null),
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function subjectMatches(left, right) {
  if (!left || !right) return false;
  return [
    [left.id, right.id],
    [left.seo?.slug, right.seo?.slug],
    [left.subject_code, right.subject_code],
  ].some(([a, b]) => a && b && normalize(a) === normalize(b));
}

function collegeMatches(left, right) {
  if (!left || !right) return false;
  return [
    [left.short_code, right.short_code],
    [left.official_website, right.official_website],
    [left.name, right.name],
  ].some(([a, b]) => a && b && normalize(a) === normalize(b));
}

function branchProfileMatches(left, right) {
  if (!left || !right) return false;
  return Boolean(left.branch && right.branch && normalize(left.branch) === normalize(right.branch));
}

function guideMatches(left, right) {
  if (!left || !right) return false;
  return [
    [left.id, right.id],
    [left.seo?.slug, right.seo?.slug],
    [left.name, right.name],
  ].some(([a, b]) => a && b && normalize(a) === normalize(b));
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

function schemaValidationErrors(err) {
  return [{
    path: '/',
    message: err?.message || String(err),
    keyword: 'schema_validation',
    params: {},
  }];
}

function targetFilename(exportPayload) {
  const hint = exportPayload?.target?.data_file_hint;
  if (!hint || !String(hint).startsWith('data/')) {
    throw new Error('Export does not include a safe data_file_hint.');
  }
  return path.basename(hint);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf-8'));
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function applySubject(document, patch) {
  if (!Array.isArray(document.subjects)) throw new Error('Subject draft file does not contain a subjects array.');
  if (patch.op === 'replace') {
    const index = Number(patch.path.split('/').pop());
    if (Number.isInteger(index) && index >= 0 && index < document.subjects.length && subjectMatches(document.subjects[index], patch.value)) {
      document.subjects[index] = patch.value;
      return { operation: 'replace', index };
    }
    const byIdentity = document.subjects.findIndex(subject => subjectMatches(subject, patch.value));
    if (byIdentity < 0) throw new Error(`Subject replacement target was not found in draft file for patch path ${patch.path}.`);
    document.subjects[byIdentity] = patch.value;
    return { operation: 'replace', index: byIdentity };
  }
  document.subjects.push(patch.value);
  return { operation: 'add', index: document.subjects.length - 1 };
}

function applyCollege(document, patch) {
  if (!Array.isArray(document.colleges)) throw new Error('College draft file does not contain a colleges array.');
  if (patch.op === 'replace') {
    const index = Number(patch.path.split('/').pop());
    if (Number.isInteger(index) && index >= 0 && index < document.colleges.length && collegeMatches(document.colleges[index], patch.value)) {
      document.colleges[index] = patch.value;
      return { operation: 'replace', index };
    }
    const byIdentity = document.colleges.findIndex(college => collegeMatches(college, patch.value));
    if (byIdentity < 0) throw new Error(`College replacement target was not found in draft file for patch path ${patch.path}.`);
    document.colleges[byIdentity] = patch.value;
    return { operation: 'replace', index: byIdentity };
  }
  document.colleges.push(patch.value);
  return { operation: 'add', index: document.colleges.length - 1 };
}

function applyBranchProfile(document, patch) {
  if (!Array.isArray(document.branch_profiles)) throw new Error('Branch profile draft file does not contain a branch_profiles array.');
  if (patch.op === 'replace') {
    const index = Number(patch.path.split('/').pop());
    if (Number.isInteger(index) && index >= 0 && index < document.branch_profiles.length && branchProfileMatches(document.branch_profiles[index], patch.value)) {
      document.branch_profiles[index] = patch.value;
      return { operation: 'replace', index };
    }
    const byIdentity = document.branch_profiles.findIndex(profile => branchProfileMatches(profile, patch.value));
    if (byIdentity < 0) throw new Error(`Branch profile replacement target was not found in draft file for patch path ${patch.path}.`);
    document.branch_profiles[byIdentity] = patch.value;
    return { operation: 'replace', index: byIdentity };
  }
  document.branch_profiles.push(patch.value);
  return { operation: 'add', index: document.branch_profiles.length - 1 };
}

function applyGuide(document, patch) {
  if (!Array.isArray(document.guides)) throw new Error('Guide draft file does not contain a guides array.');
  if (patch.op === 'replace') {
    const index = Number(patch.path.split('/').pop());
    if (Number.isInteger(index) && index >= 0 && index < document.guides.length && guideMatches(document.guides[index], patch.value)) {
      document.guides[index] = patch.value;
      return { operation: 'replace', index };
    }
    const byIdentity = document.guides.findIndex(guide => guideMatches(guide, patch.value));
    if (byIdentity < 0) throw new Error(`Guide replacement target was not found in draft file for patch path ${patch.path}.`);
    document.guides[byIdentity] = patch.value;
    return { operation: 'replace', index: byIdentity };
  }
  document.guides.push(patch.value);
  return { operation: 'add', index: document.guides.length - 1 };
}

function applyPatchToDocument(document, exportPayload) {
  const patch = exportPayload?.patch?.[0];
  if (!patch || !['replace', 'add'].includes(patch.op)) throw new Error('Export patch must contain one add or replace operation.');
  const collection = exportPayload?.target?.collection;
  if (collection === 'subjects') return applySubject(document, patch);
  if (collection === 'colleges') return applyCollege(document, patch);
  if (collection === 'branch_profiles') return applyBranchProfile(document, patch);
  if (collection === 'guides') return applyGuide(document, patch);
  throw new Error(`Unsupported draft apply collection: ${collection}`);
}

async function validateDraftDataAsync(root, draftDataDir) {
  const fsSync = await import('node:fs');
  const { data } = loadDataset(draftDataDir);
  const { colleges } = loadMergedColleges(draftDataDir);
  const branchProfiles = JSON.parse(fsSync.readFileSync(path.join(draftDataDir, 'branch-guide-data.json'), 'utf-8')).branch_profiles;
  validateData(path.join(root, 'data', 'schema.json'), data);
  return {
    subjects: data.subjects?.length || 0,
    verifiedSubjects: (data.subjects || []).filter(subject => subject.source?.status === 'verified').length,
    colleges: colleges?.length || 0,
    branchProfiles: branchProfiles?.length || 0,
    guides: data.guides?.length || 0,
  };
}

async function insertApply({ proposalExportId, proposalId, draftPath, validationStatus, validationErrors, summary, actor }) {
  const pool = await getDbPool({ requireConfigured: true });
  const [result] = await pool.execute(
    `INSERT INTO proposal_draft_applies
      (proposal_export_id, proposal_id, draft_path, validation_status, validation_errors_json, summary_json, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      proposalExportId,
      proposalId,
      draftPath,
      validationStatus,
      JSON.stringify(validationErrors || []),
      JSON.stringify(summary || {}),
      actor,
    ]
  );
  return getProposalDraftApply(result.insertId);
}

async function updateApplySummary(id, summary) {
  const pool = await getDbPool({ requireConfigured: true });
  await pool.execute(
    'UPDATE proposal_draft_applies SET summary_json = ? WHERE id = ?',
    [JSON.stringify(summary || {}), id]
  );
  return getProposalDraftApply(id);
}

export async function applyProposalExportToDraft({ root, proposalExportId, actor = null }) {
  await audit({
    actor,
    action: 'proposal_draft_apply.run',
    entityType: 'proposal_export',
    entityId: proposalExportId,
    after: { proposal_export_id: proposalExportId },
  });

  try {
    const proposalExport = await getProposalExport(proposalExportId);
    if (!proposalExport) throw new Error(`Proposal export not found: ${proposalExportId}`);
    if (proposalExport.validationStatus !== 'passed') {
      throw new Error('Only exports with passed validation can be applied to a draft workspace.');
    }

    const proposalId = proposalExport.proposalId;
    const relativeDraftPath = path.join('tmp', 'content-drafts', String(proposalId));
    const absoluteDraftPath = path.join(root, relativeDraftPath);
    const draftDataDir = path.join(absoluteDraftPath, 'data');
    await fs.rm(absoluteDraftPath, { recursive: true, force: true });
    await fs.mkdir(absoluteDraftPath, { recursive: true });
    await fs.cp(path.join(root, 'data'), draftDataDir, { recursive: true });

    const filename = targetFilename(proposalExport.exportPayload);
    const targetFile = path.join(draftDataDir, filename);
    const beforeDoc = await readJson(targetFile);
    const beforeText = JSON.stringify(beforeDoc, null, 2);
    const applyResult = applyPatchToDocument(beforeDoc, proposalExport.exportPayload);
    await writeJson(targetFile, beforeDoc);
    const afterText = JSON.stringify(beforeDoc, null, 2);

    let validationStatus = 'passed';
    let validationErrors = [];
    let draftCounts = null;
    const warnings = [];
    try {
      draftCounts = await validateDraftDataAsync(root, draftDataDir);
    } catch (err) {
      validationStatus = 'failed';
      validationErrors = schemaValidationErrors(err);
      warnings.push('Draft dataset schema validation failed.');
    }

    const summary = {
      proposal_export_id: Number(proposalExport.id),
      proposal_id: Number(proposalId),
      entity_type: proposalExport.exportPayload?.entity_type,
      entity_key: proposalExport.exportPayload?.entity_key,
      changed_files: beforeText === afterText ? [] : [path.join('data', filename)],
      target_file: path.join('data', filename),
      operation: applyResult.operation,
      index: applyResult.index,
      validation_status: validationStatus,
      draft_counts: draftCounts,
      revision_id: null,
      warnings,
      not_published: true,
    };

    let row = await insertApply({
      proposalExportId: proposalExport.id,
      proposalId,
      draftPath: relativeDraftPath,
      validationStatus,
      validationErrors,
      summary,
      actor,
    });

    if (validationStatus === 'passed') {
      const revision = await createRevision({
        entityType: summary.entity_type,
        entityKey: summary.entity_key,
        content: proposalExport.exportPayload?.replacement || proposalExport.exportPayload?.patch?.[0]?.value,
        sourceStatus: proposalExport.exportPayload?.replacement?.source?.status,
        proposalId,
        exportId: proposalExport.id,
        draftApplyId: row.id,
        createdBy: actor,
        actor,
      });
      summary.revision_id = revision.id;
      row = await updateApplySummary(row.id, summary);
    }

    await fs.writeFile(path.join(absoluteDraftPath, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

    await audit({
      actor,
      action: 'proposal_draft_apply.success',
      entityType: 'proposal_draft_apply',
      entityId: row.id,
      after: {
        proposal_export_id: proposalExport.id,
        proposal_id: proposalId,
        draft_path: relativeDraftPath,
        validation_status: validationStatus,
        revision_id: summary.revision_id,
      },
    });
    return row;
  } catch (err) {
    await audit({
      actor,
      action: 'proposal_draft_apply.error',
      entityType: 'proposal_export',
      entityId: proposalExportId,
      after: { proposal_export_id: proposalExportId, error: err.message || String(err) },
    });
    throw err;
  }
}

export async function getProposalDraftApply(id) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute('SELECT * FROM proposal_draft_applies WHERE id = ?', [id]);
  return applyFromRow(rows[0]);
}

export async function listProposalDraftApplies(proposalExportId, { limit = 25 } = {}) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute(
    `SELECT *
     FROM proposal_draft_applies
     WHERE proposal_export_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    [proposalExportId, limit]
  );
  return rows.map(applyFromRow);
}

export function proposalDraftApplyErrorSummary(err) {
  const safe = describeDbError(err);
  if (err?.name === 'DatabaseConfigError') {
    return 'Proposal draft apply requires MySQL configuration. Set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, and run migrations.';
  }
  if (safe.code === 'ER_NO_SUCH_TABLE' || safe.code === 'ER_BAD_FIELD_ERROR') {
    return 'Proposal draft apply tables are missing or out of date. Run npm run db:migrate.';
  }
  return `${safe.code ? `${safe.code}: ` : ''}${safe.message}`;
}
