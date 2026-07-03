import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describeDbError, getDbPool } from './db.js';
import { getReleaseApplyPlan } from './release-apply-plan.js';
import { generateReleaseReviewSummary } from './release-review.js';

export const LIVE_APPLY_CONFIRMATION = 'APPLY LIVE JSON';
export const LIVE_ROLLBACK_CONFIRMATION = 'ROLLBACK LIVE JSON';
export const LIVE_RECOVERY_CONFIRMATION = 'RECOVER PARTIAL APPLY';

const ROLLBACK_ALLOWED_STATUSES = new Set([
  'files_written',
  'partial_applied',
  'recovered_applied',
  'published_pending_deploy',
  'published_pending_deploy_recovered',
  'failed',
]);

const VERIFY_ALLOWED_STATUSES = new Set([
  'files_written',
  'verification_running',
  'partial_applied',
  'recovered_applied',
  'manual_rollback_required',
  'published_pending_deploy',
  'published_pending_deploy_recovered',
]);

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  return JSON.parse(value);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function safePlanFileName(filePath) {
  return String(filePath).replaceAll('\\', '/').replace(/[^a-zA-Z0-9._-]+/g, '__');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function collectionArrayName(collection) {
  if (collection === 'subjects') return 'subjects';
  if (collection === 'colleges') return 'colleges';
  if (collection === 'branch_profiles') return 'branch_profiles';
  throw new Error(`Unsupported release apply collection: ${collection}`);
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
  return Boolean(left?.branch && right?.branch && normalize(left.branch) === normalize(right.branch));
}

function entityMatches(collection, left, right) {
  if (collection === 'subjects') return subjectMatches(left, right);
  if (collection === 'colleges') return collegeMatches(left, right);
  if (collection === 'branch_profiles') return branchProfileMatches(left, right);
  return false;
}

function collectionForEntityType(entityType) {
  if (entityType === 'subject') return 'subjects';
  if (entityType === 'college') return 'colleges';
  if (entityType === 'branch_profile') return 'branch_profiles';
  throw new Error(`Unsupported apply entity type: ${entityType}`);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf-8'));
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
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

function assertConfirmation(confirmationPhrase, expected) {
  if (String(confirmationPhrase || '').trim() !== expected) {
    throw new Error(`Confirmation phrase must be exactly "${expected}".`);
  }
}

function assertReviewerNote(note) {
  const clean = String(note || '').trim();
  if (!clean) throw new Error('Reviewer note is required.');
  return clean;
}

function assertNoDuplicateChanges(plan) {
  const entityKeys = new Set();
  const fileKeys = new Set();
  for (const change of plan.changes || []) {
    const entityKey = `${change.entity_type}:${String(change.entity_key || '').toLowerCase()}`;
    if (entityKeys.has(entityKey)) throw new Error(`Duplicate entity change in apply plan: ${entityKey}`);
    entityKeys.add(entityKey);
    if (fileKeys.has(change.file)) throw new Error(`Conflicting file change in apply plan: ${change.file}`);
    fileKeys.add(change.file);
  }
}

async function releaseRows(pool, releaseCandidateId) {
  const [releaseRowsResult] = await pool.execute(
    'SELECT * FROM release_candidates WHERE id = ?',
    [releaseCandidateId]
  );
  const release = releaseRowsResult[0];
  if (!release) throw new Error(`Release candidate not found: ${releaseCandidateId}`);

  const [itemRows] = await pool.execute(
    `SELECT rci.*,
      cp.status AS proposal_status,
      cp.validation_status AS proposal_validation_status,
      pe.validation_status AS export_validation_status,
      pda.validation_status AS draft_validation_status
     FROM release_candidate_items rci
     INNER JOIN content_proposals cp ON cp.id = rci.proposal_id
     LEFT JOIN proposal_exports pe ON pe.id = rci.proposal_export_id
     LEFT JOIN proposal_draft_applies pda ON pda.id = rci.draft_apply_id
     WHERE rci.release_candidate_id = ?
     ORDER BY rci.id ASC`,
    [releaseCandidateId]
  );
  return { release, itemRows };
}

async function assertApplySafety({ root, releaseCandidateId, plan }) {
  const pool = await getDbPool({ requireConfigured: true });
  const { release, itemRows } = await releaseRows(pool, releaseCandidateId);
  if (release.status !== 'ready_for_review') {
    throw new Error(`Release candidate must be ready_for_review before live JSON apply. Current status: ${release.status}.`);
  }
  if (!plan) throw new Error('Generated apply plan is required before live JSON apply.');
  if (plan.release_candidate_id !== Number(releaseCandidateId)) {
    throw new Error('Apply plan release_candidate_id does not match requested release.');
  }
  if ((plan.final_warnings || []).length > 0) {
    throw new Error('Apply plan has final warnings. Resolve them before live JSON apply.');
  }
  const reviewSummary = await generateReleaseReviewSummary({ releaseCandidateId });
  if (reviewSummary.has_blocking_warnings) {
    throw new Error(`Current release review summary has ${reviewSummary.blocking_warning_count} blocking warning(s).`);
  }
  for (const row of itemRows) {
    if (row.proposal_status !== 'approved_for_draft') {
      throw new Error(`Proposal ${row.proposal_id} is not approved_for_draft.`);
    }
    if (row.proposal_validation_status !== 'passed') {
      throw new Error(`Proposal ${row.proposal_id} validation is ${row.proposal_validation_status}.`);
    }
    if (row.export_validation_status !== 'passed') {
      throw new Error(`Proposal export ${row.proposal_export_id || '(missing)'} validation is ${row.export_validation_status || 'missing'}.`);
    }
    if (row.draft_validation_status !== 'passed') {
      throw new Error(`Draft apply ${row.draft_apply_id || '(missing)'} validation is ${row.draft_validation_status || 'missing'}.`);
    }
    if (!row.revision_id) {
      throw new Error(`Release candidate item ${row.id} is missing a revision snapshot.`);
    }
  }
  assertNoDuplicateChanges(plan);

  for (const change of plan.changes || []) {
    if (!change.file || !String(change.file).startsWith('data/')) {
      throw new Error(`Unsafe apply file path: ${change.file}`);
    }
    await fs.access(path.join(root, change.file));
  }

  return { release, itemRows, reviewSummary };
}

function runCommand(command, args, { cwd, label = null }) {
  return new Promise(resolve => {
    const startedAt = new Date().toISOString();
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, CONTENT_SOURCE: process.env.CONTENT_SOURCE || 'json' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', err => {
      finish({
        command: label || [command, ...args].join(' '),
        status: 'failed',
        exit_code: null,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        stdout: stdout.slice(-12000),
        stderr: `${stderr}${stderr ? '\n' : ''}${err.message || String(err)}`.slice(-12000),
      });
    });
    child.on('close', code => {
      finish({
        command: label || [command, ...args].join(' '),
        status: code === 0 ? 'passed' : 'failed',
        exit_code: code,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        stdout: stdout.slice(-12000),
        stderr: stderr.slice(-12000),
      });
    });
  });
}

async function runVerification(root) {
  const checks = [];
  checks.push(await runCommand(process.execPath, ['scripts/build.js'], { cwd: root, label: 'node scripts/build.js' }));
  if (checks.at(-1).status === 'passed') {
    checks.push(await runCommand(process.execPath, ['scripts/build-search-index.js'], { cwd: root, label: 'node scripts/build-search-index.js' }));
  }
  if (checks.at(-1).status === 'passed') {
    checks.push(await runCommand(process.execPath, ['scripts/retrieve-test.js'], { cwd: root, label: 'node scripts/retrieve-test.js' }));
  }
  if (checks.at(-1).status === 'passed') {
    checks.push(await runCommand(process.execPath, ['scripts/audit-site.js'], { cwd: root, label: 'node scripts/audit-site.js' }));
  }
  return {
    status: checks.every(check => check.status === 'passed') ? 'passed' : 'failed',
    checks,
  };
}

async function copyBackups({ root, files, backupPath }) {
  for (const file of files) {
    const source = path.join(root, file);
    const destination = path.join(root, backupPath, file);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  }
}

async function restoreBackups({ root, files, backupPath }) {
  for (const file of files) {
    const backupFile = path.join(root, backupPath, file);
    const destination = path.join(root, file);
    await fs.copyFile(backupFile, destination);
  }
}

async function writePlanAfterFiles({ root, plan }) {
  const files = [...new Set((plan.changes || []).map(change => change.file))];
  let tmpArtifactsAvailable = true;
  for (const file of files) {
    const safeName = safePlanFileName(file);
    const beforePath = path.join(root, plan.plan_path, 'files', `${safeName}.before.json`);
    const afterPath = path.join(root, plan.plan_path, 'files', `${safeName}.after.json`);
    if (!(await pathExists(beforePath)) || !(await pathExists(afterPath))) {
      tmpArtifactsAvailable = false;
      break;
    }
  }

  if (!tmpArtifactsAvailable) {
    return writePlanAfterFilesFromPayload({ root, plan, files });
  }

  for (const file of files) {
    const safeName = safePlanFileName(file);
    const beforePath = path.join(root, plan.plan_path, 'files', `${safeName}.before.json`);
    const afterPath = path.join(root, plan.plan_path, 'files', `${safeName}.after.json`);
    const livePath = path.join(root, file);
    const liveBefore = await readJson(livePath);
    const planBefore = await readJson(beforePath);
    if (stableJson(liveBefore) !== stableJson(planBefore)) {
      throw new Error(`Live file drift detected before apply: ${file}. Regenerate the apply plan.`);
    }
    const afterDocument = await readJson(afterPath);
    await writeJson(livePath, afterDocument);
  }
  return files;
}

async function writePlanAfterFilesFromPayload({ root, plan, files }) {
  const documentCache = new Map();
  for (const file of files) {
    documentCache.set(file, await readJson(path.join(root, file)));
  }

  for (const change of plan.changes || []) {
    const file = change.file;
    const collection = collectionForEntityType(change.entity_type);
    const document = documentCache.get(file);
    const array = document?.[collection];
    if (!Array.isArray(array)) {
      throw new Error(`Target file ${file} does not contain ${collection}.`);
    }

    const after = change.after_json;
    if (!after) throw new Error(`Apply plan change ${change.order || ''} is missing after_json.`);

    const existingIndex = array.findIndex(entry => entityMatches(collection, entry, after));
    if (change.operation === 'add') {
      if (existingIndex >= 0) {
        throw new Error(`Live file already contains add target before apply: ${change.entity_type}:${change.entity_key}. Recover or regenerate the apply plan.`);
      }
      array.push(clone(after));
      continue;
    }

    if (!change.before_json) {
      throw new Error(`DB apply fallback requires before_json for ${change.operation} on ${change.entity_type}:${change.entity_key}. Regenerate the apply plan.`);
    }
    const beforeIndex = array.findIndex(entry => entityMatches(collection, entry, change.before_json));
    if (beforeIndex < 0) {
      throw new Error(`Live file drift detected before apply: ${file}. Regenerate the apply plan.`);
    }
    if (stableJson(array[beforeIndex]) !== stableJson(change.before_json)) {
      throw new Error(`Live file drift detected before apply: ${file}. Regenerate the apply plan.`);
    }
    array[beforeIndex] = clone(after);
  }

  for (const [file, document] of documentCache) {
    await writeJson(path.join(root, file), document);
  }
  return files;
}

async function updateReleaseLiveApply(pool, id, fields) {
  const assignments = [];
  const values = [];
  const map = {
    status: 'status',
    phase: 'phase',
    backupExists: 'backup_exists',
    verification: 'verification_json',
    errorMessage: 'error_message',
    recovery: 'recovery_json',
    finishedAt: 'finished_at',
  };
  for (const [key, column] of Object.entries(map)) {
    if (!Object.hasOwn(fields, key)) continue;
    assignments.push(`${column} = ?`);
    const value = fields[key];
    if (key === 'verification' || key === 'recovery') values.push(value == null ? null : JSON.stringify(value));
    else values.push(value);
  }
  if (!assignments.length) return getReleaseLiveApply(id);
  values.push(id);
  await pool.execute(
    `UPDATE release_live_applies SET ${assignments.join(', ')} WHERE id = ?`,
    values
  );
  return getReleaseLiveApply(id);
}

async function insertLiveApplyStarted({ releaseCandidateId, planPath, backupPath, changedFiles, reviewerNote, actor }) {
  const pool = await getDbPool({ requireConfigured: true });
  const [result] = await pool.execute(
    `INSERT INTO release_live_applies
      (release_candidate_id, apply_plan_path, backup_path, backup_exists, changed_files_json,
       verification_json, status, phase, reviewer_note, applied_by, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      releaseCandidateId,
      planPath,
      backupPath,
      0,
      JSON.stringify(changedFiles),
      JSON.stringify({ status: 'not_run', checks: [] }),
      'started',
      'prepare',
      reviewerNote,
      actor,
    ]
  );
  return getReleaseLiveApply(result.insertId);
}

async function findLatestBackupPath({ root, releaseCandidateId, changedFiles }) {
  const basePath = path.join(root, 'tmp', 'live-release-backups', String(releaseCandidateId));
  let entries = [];
  try {
    entries = await fs.readdir(basePath, { withFileTypes: true });
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
  const directories = entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
    .reverse();
  for (const dir of directories) {
    const candidate = path.join(basePath, dir);
    const ok = await Promise.all(changedFiles.map(file => pathExists(path.join(candidate, file))));
    if (ok.every(Boolean)) return path.relative(root, candidate);
  }
  return null;
}

async function loadReleaseRecoveryRows(pool, releaseCandidateId) {
  const [rows] = await pool.execute(
    `SELECT rc.id AS release_candidate_id, rc.status AS release_status, rc.title,
      rci.id AS release_candidate_item_id,
      rci.proposal_id, rci.proposal_export_id, rci.draft_apply_id, rci.revision_id,
      cp.entity_type, cp.entity_key, cp.validation_status AS proposal_validation_status,
      cp.normalized_payload_json, cp.proposed_payload_json,
      pe.export_payload_json, pe.validation_status AS export_validation_status,
      pda.validation_status AS draft_validation_status
     FROM release_candidates rc
     INNER JOIN release_candidate_items rci ON rci.release_candidate_id = rc.id
     INNER JOIN content_proposals cp ON cp.id = rci.proposal_id
     LEFT JOIN proposal_exports pe ON pe.id = rci.proposal_export_id
     LEFT JOIN proposal_draft_applies pda ON pda.id = rci.draft_apply_id
     WHERE rc.id = ?
     ORDER BY rci.id ASC`,
    [releaseCandidateId]
  );
  if (!rows.length) throw new Error(`Release candidate ${releaseCandidateId} has no release items to recover.`);
  return rows;
}

async function inspectCurrentAppliedContent({ root, rows }) {
  const changedFiles = [];
  const items = [];
  for (const row of rows) {
    const exportPayload = parseJson(row.export_payload_json, null);
    if (!exportPayload) throw new Error(`Release item ${row.release_candidate_item_id} has no export payload.`);
    const targetFile = exportPayload?.target?.data_file_hint;
    const collection = exportPayload?.target?.collection;
    if (!targetFile || !String(targetFile).startsWith('data/')) {
      throw new Error(`Release item ${row.release_candidate_item_id} has unsafe or missing target file.`);
    }
    if (!changedFiles.includes(targetFile)) changedFiles.push(targetFile);
    const arrayName = collectionArrayName(collection);
    const payload = parseJson(row.normalized_payload_json || row.proposed_payload_json, null);
    const document = await readJson(path.join(root, targetFile));
    const index = Array.isArray(document[arrayName])
      ? document[arrayName].findIndex(entry => entityMatches(collection, entry, payload))
      : -1;
    const current = index >= 0 ? document[arrayName][index] : null;
    items.push({
      proposal_id: row.proposal_id,
      entity_type: row.entity_type,
      entity_key: row.entity_key,
      file: targetFile,
      collection,
      index,
      present: index >= 0,
      exact_match: index >= 0 && stableJson(current) === stableJson(payload),
      source_status: current?.source?.status || null,
    });
  }
  return { changedFiles, items };
}

export async function applyReleaseToLiveJson({
  root = process.cwd(),
  releaseCandidateId,
  confirmationPhrase,
  reviewerNote,
  actor = null,
} = {}) {
  assertConfirmation(confirmationPhrase, LIVE_APPLY_CONFIRMATION);
  const cleanNote = assertReviewerNote(reviewerNote);
  const plan = await getReleaseApplyPlan({ root, releaseCandidateId });
  const pool = await getDbPool({ requireConfigured: true });

  let row = null;
  try {
    await assertApplySafety({ root, releaseCandidateId, plan });
    const changedFiles = [...new Set((plan.changes || []).map(change => change.file))];
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join('tmp', 'live-release-backups', String(releaseCandidateId), timestamp);

    row = await insertLiveApplyStarted({
      releaseCandidateId,
      planPath: plan.plan_path,
      backupPath,
      changedFiles,
      reviewerNote: cleanNote,
      actor,
    });
    await audit(pool, {
      actor,
      action: 'release_live_apply.started',
      entityType: 'release_live_apply',
      entityId: row.id,
      after: { release_candidate_id: releaseCandidateId, changed_files: changedFiles, backup_path: backupPath },
    });

    await copyBackups({ root, files: changedFiles, backupPath });
    row = await updateReleaseLiveApply(pool, row.id, {
      status: 'backup_created',
      phase: 'backup_created',
      backupExists: 1,
    });
    await audit(pool, {
      actor,
      action: 'release_live_apply.backup_created',
      entityType: 'release_live_apply',
      entityId: row.id,
      after: { backup_path: backupPath, changed_files: changedFiles },
    });

    await writePlanAfterFiles({ root, plan });
    row = await updateReleaseLiveApply(pool, row.id, {
      status: 'files_written',
      phase: 'files_written',
    });
    await pool.execute(
      "UPDATE release_candidates SET status = 'partial_applied_needs_review' WHERE id = ?",
      [releaseCandidateId]
    );
    await audit(pool, {
      actor,
      action: 'release_live_apply.files_written',
      entityType: 'release_live_apply',
      entityId: row.id,
      after: {
        release_candidate_id: releaseCandidateId,
        changed_files: changedFiles,
        verification_required: true,
      },
    });
    await audit(pool, {
      actor,
      action: 'release_candidate.partial_applied_needs_review',
      entityType: 'release_candidate',
      entityId: releaseCandidateId,
      after: { release_live_apply_id: row.id, verification_required: true },
    });
    return row;
  } catch (err) {
    if (row?.id) {
      await updateReleaseLiveApply(pool, row.id, {
        status: 'failed',
        phase: 'failed',
        errorMessage: err.message || String(err),
        finishedAt: new Date(),
      }).catch(() => {});
      await audit(pool, {
        actor,
        action: 'release_live_apply.error',
        entityType: 'release_live_apply',
        entityId: row.id,
        after: { error: err.message || String(err), phase: row.phase },
      }).catch(() => {});
    } else if (!err?.message?.includes('Confirmation phrase')) {
      await audit(pool, {
        actor,
        action: 'release_live_apply.error',
        entityType: 'release_candidate',
        entityId: releaseCandidateId,
        after: { error: err.message || String(err) },
      }).catch(() => {});
    }
    throw err;
  }
}

export async function recoverPartialLiveApply({
  root = process.cwd(),
  releaseCandidateId,
  confirmationPhrase,
  reviewerNote,
  actor = null,
} = {}) {
  assertConfirmation(confirmationPhrase, LIVE_RECOVERY_CONFIRMATION);
  const cleanNote = assertReviewerNote(reviewerNote);
  const pool = await getDbPool({ requireConfigured: true });
  const [existing] = await pool.execute(
    `SELECT id, status FROM release_live_applies
     WHERE release_candidate_id = ?
     ORDER BY applied_at DESC, id DESC
     LIMIT 1`,
    [releaseCandidateId]
  );
  if (existing[0] && existing[0].status !== 'rolled_back') {
    throw new Error(`Release candidate ${releaseCandidateId} already has live apply row ${existing[0].id} (${existing[0].status}).`);
  }

  const rows = await loadReleaseRecoveryRows(pool, releaseCandidateId);
  const inspected = await inspectCurrentAppliedContent({ root, rows });
  const missing = inspected.items.filter(item => !item.present);
  if (missing.length) {
    throw new Error(`No matching live JSON write found for: ${missing.map(item => item.entity_key).join(', ')}`);
  }

  const backupPath = await findLatestBackupPath({
    root,
    releaseCandidateId,
    changedFiles: inspected.changedFiles,
  });
  const backupExists = Boolean(backupPath);
  const planPath = path.join('tmp', 'release-apply-plans', String(releaseCandidateId));
  const recovery = {
    recovered: true,
    reason: 'Recovered from prior request timeout after live JSON write.',
    backup_exists: backupExists,
    backup_path: backupPath,
    current_file_matches: inspected.items,
    manual_rollback_required: !backupExists,
  };
  const [result] = await pool.execute(
    `INSERT INTO release_live_applies
      (release_candidate_id, apply_plan_path, backup_path, backup_exists, changed_files_json,
       verification_json, status, phase, reviewer_note, applied_by, started_at, recovery_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
    [
      releaseCandidateId,
      planPath,
      backupPath || '',
      backupExists ? 1 : 0,
      JSON.stringify(inspected.changedFiles),
      JSON.stringify({ status: 'not_run', checks: [] }),
      backupExists ? 'recovered_applied' : 'manual_rollback_required',
      'files_written',
      cleanNote,
      actor,
      JSON.stringify(recovery),
    ]
  );
  await pool.execute(
    "UPDATE release_candidates SET status = 'partial_applied_needs_review' WHERE id = ?",
    [releaseCandidateId]
  );
  await audit(pool, {
    actor,
    action: 'release_live_apply.recovered_partial',
    entityType: 'release_live_apply',
    entityId: result.insertId,
    after: {
      release_candidate_id: releaseCandidateId,
      changed_files: inspected.changedFiles,
      backup_exists: backupExists,
      backup_path: backupPath,
      items: inspected.items,
    },
  });
  await audit(pool, {
    actor,
    action: 'release_candidate.partial_applied_needs_review',
    entityType: 'release_candidate',
    entityId: releaseCandidateId,
    after: {
      release_live_apply_id: result.insertId,
      recovered: true,
      verification_required: true,
    },
  });
  return getReleaseLiveApply(result.insertId);
}

function liveApplyFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    releaseCandidateId: row.release_candidate_id,
    applyPlanPath: row.apply_plan_path,
    backupPath: row.backup_path,
    backupExists: Boolean(row.backup_exists),
    changedFiles: parseJson(row.changed_files_json, []),
    verification: parseJson(row.verification_json, null),
    status: row.status,
    phase: row.phase,
    errorMessage: row.error_message,
    recovery: parseJson(row.recovery_json, null),
    reviewerNote: row.reviewer_note,
    appliedBy: row.applied_by,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    appliedAt: row.applied_at,
    rolledBackBy: row.rolled_back_by,
    rolledBackAt: row.rolled_back_at,
    rollbackNote: row.rollback_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getReleaseLiveApply(id) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute('SELECT * FROM release_live_applies WHERE id = ?', [id]);
  return liveApplyFromRow(rows[0]);
}

export async function getLatestReleaseLiveApply(releaseCandidateId) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute(
    `SELECT * FROM release_live_applies
     WHERE release_candidate_id = ?
     ORDER BY applied_at DESC, id DESC
     LIMIT 1`,
    [releaseCandidateId]
  );
  return liveApplyFromRow(rows[0]);
}

export async function runReleaseLiveApplyVerification({
  root = process.cwd(),
  applyId,
  actor = null,
} = {}) {
  const row = await getReleaseLiveApply(applyId);
  if (!row) throw new Error(`Release live apply not found: ${applyId}`);
  if (!VERIFY_ALLOWED_STATUSES.has(row.status)) {
    throw new Error(`Verification cannot run for live apply status ${row.status}.`);
  }

  const pool = await getDbPool({ requireConfigured: true });
  await updateReleaseLiveApply(pool, applyId, {
    status: 'verification_running',
    phase: 'verification_running',
  });
  await audit(pool, {
    actor,
    action: 'release_live_apply.verification_running',
    entityType: 'release_live_apply',
    entityId: applyId,
    after: { release_candidate_id: row.releaseCandidateId },
  });

  const verification = await runVerification(root);
  if (verification.status !== 'passed') {
    if (row.backupExists && row.backupPath) {
      await restoreBackups({ root, files: row.changedFiles, backupPath: row.backupPath });
      const restoreVerification = await runVerification(root);
      const failed = await updateReleaseLiveApply(pool, applyId, {
        status: 'failed',
        phase: 'failed',
        verification: { ...verification, restored_from_backup: true, restore_verification: restoreVerification },
        errorMessage: 'Verification failed; backed-up JSON files were restored.',
        finishedAt: new Date(),
      });
      await pool.execute(
        "UPDATE release_candidates SET status = 'ready_for_review' WHERE id = ?",
        [row.releaseCandidateId]
      );
      await audit(pool, {
        actor,
        action: 'release_live_apply.failed',
        entityType: 'release_live_apply',
        entityId: applyId,
        after: { release_candidate_id: row.releaseCandidateId, verification, restored_from_backup: true },
      });
      return failed;
    }

    const failed = await updateReleaseLiveApply(pool, applyId, {
      status: 'manual_rollback_required',
      phase: 'failed',
      verification,
      errorMessage: 'Verification failed and no backup is available for automatic rollback.',
      finishedAt: new Date(),
    });
    await pool.execute(
      "UPDATE release_candidates SET status = 'partial_applied_needs_review' WHERE id = ?",
      [row.releaseCandidateId]
    );
    await audit(pool, {
      actor,
      action: 'release_live_apply.manual_rollback_required',
      entityType: 'release_live_apply',
      entityId: applyId,
      after: {
        release_candidate_id: row.releaseCandidateId,
        changed_files: row.changedFiles,
        verification_status: verification.status,
      },
    });
    return failed;
  }

  const recovered = Boolean(row.recovery?.recovered) || row.status === 'recovered_applied' || row.status === 'manual_rollback_required';
  const finalStatus = recovered ? 'published_pending_deploy_recovered' : 'published_pending_deploy';
  const passed = await updateReleaseLiveApply(pool, applyId, {
    status: finalStatus,
    phase: 'completed',
    verification,
    finishedAt: new Date(),
  });
  await pool.execute(
    `UPDATE release_candidates SET status = ? WHERE id = ?`,
    [finalStatus, row.releaseCandidateId]
  );
  await audit(pool, {
    actor,
    action: recovered ? 'release_live_apply.recovered_verification_passed' : 'release_live_apply.success',
    entityType: 'release_live_apply',
    entityId: applyId,
    after: {
      release_candidate_id: row.releaseCandidateId,
      changed_files: row.changedFiles,
      backup_path: row.backupPath,
      backup_exists: row.backupExists,
      verification_status: verification.status,
    },
  });
  await audit(pool, {
    actor,
    action: recovered ? 'release_candidate.published_pending_deploy_recovered' : 'release_candidate.published_pending_deploy',
    entityType: 'release_candidate',
    entityId: row.releaseCandidateId,
    after: {
      release_live_apply_id: applyId,
      manual_git_commit_required: true,
      auto_deploy_triggered: false,
    },
  });
  return passed;
}

export async function rollbackReleaseLiveApply({
  root = process.cwd(),
  applyId,
  confirmationPhrase,
  reviewerNote,
  actor = null,
} = {}) {
  assertConfirmation(confirmationPhrase, LIVE_ROLLBACK_CONFIRMATION);
  const cleanNote = assertReviewerNote(reviewerNote);
  const row = await getReleaseLiveApply(applyId);
  if (!row) throw new Error(`Release live apply not found: ${applyId}`);
  if (!ROLLBACK_ALLOWED_STATUSES.has(row.status)) {
    throw new Error(`Rollback is unavailable for live apply status ${row.status}.`);
  }
  if (!row.backupExists || !row.backupPath) {
    throw new Error('Automatic rollback is unavailable because no backup path was recorded. Manual rollback is required.');
  }

  const pool = await getDbPool({ requireConfigured: true });
  try {
    await restoreBackups({ root, files: row.changedFiles, backupPath: row.backupPath });
    const verification = await runVerification(root);
    if (verification.status !== 'passed') {
      await pool.execute(
        `UPDATE release_live_applies
         SET status = 'rollback_failed', phase = 'failed', verification_json = ?, rolled_back_by = ?, rolled_back_at = CURRENT_TIMESTAMP, rollback_note = ?, error_message = ?
         WHERE id = ?`,
        [JSON.stringify({ rollback_verification: verification }), actor, cleanNote, 'Rollback restored backups but verification failed.', applyId]
      );
      await audit(pool, {
        actor,
        action: 'release_live_apply.rollback_failed',
        entityType: 'release_live_apply',
        entityId: applyId,
        after: { verification },
      });
      throw new Error('Rollback restored backups but verification failed. Inspect working tree before continuing.');
    }

    await pool.execute(
      `UPDATE release_live_applies
       SET status = 'rolled_back', phase = 'completed', verification_json = ?, rolled_back_by = ?, rolled_back_at = CURRENT_TIMESTAMP, rollback_note = ?, finished_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [JSON.stringify({ ...(row.verification || {}), rollback_verification: verification }), actor, cleanNote, applyId]
    );
    await pool.execute(
      `UPDATE release_candidates
       SET status = 'ready_for_review'
       WHERE id = ? AND status IN ('partial_applied_needs_review', 'published_pending_deploy', 'published_pending_deploy_recovered')`,
      [row.releaseCandidateId]
    );
    await audit(pool, {
      actor,
      action: 'release_live_apply.rollback',
      entityType: 'release_live_apply',
      entityId: applyId,
      after: {
        release_candidate_id: row.releaseCandidateId,
        changed_files: row.changedFiles,
        verification_status: verification.status,
      },
    });
    return getReleaseLiveApply(applyId);
  } catch (err) {
    await audit(pool, {
      actor,
      action: 'release_live_apply.rollback_error',
      entityType: 'release_live_apply',
      entityId: applyId,
      after: { error: err.message || String(err) },
    }).catch(() => {});
    throw err;
  }
}

export function releaseLiveApplyErrorSummary(err) {
  const safe = describeDbError(err);
  if (err?.name === 'DatabaseConfigError') {
    return 'Live release apply requires MySQL configuration. Set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, and run migrations.';
  }
  if (safe.code === 'ER_NO_SUCH_TABLE' || safe.code === 'ER_BAD_FIELD_ERROR') {
    return 'Live release apply tables are missing or out of date. Run npm run db:migrate.';
  }
  return `${safe.code ? `${safe.code}: ` : ''}${safe.message}`;
}
