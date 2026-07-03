import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describeDbError, getDbPool } from './db.js';
import { getReleaseApplyPlan } from './release-apply-plan.js';
import { generateReleaseReviewSummary } from './release-review.js';

export const LIVE_APPLY_CONFIRMATION = 'APPLY LIVE JSON';
export const LIVE_ROLLBACK_CONFIRMATION = 'ROLLBACK LIVE JSON';

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

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf-8'));
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
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

function runCommand(command, args, { cwd }) {
  return new Promise(resolve => {
    const startedAt = new Date().toISOString();
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
    child.on('close', code => {
      resolve({
        command: [command, ...args].join(' '),
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
  checks.push(await runCommand('npm', ['run', 'build'], { cwd: root }));
  if (checks.at(-1).status === 'passed') checks.push(await runCommand('npm', ['run', 'test:retrieve'], { cwd: root }));
  if (checks.at(-1).status === 'passed') checks.push(await runCommand('npm', ['run', 'audit:site'], { cwd: root }));
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

async function insertLiveApply({ releaseCandidateId, plan, backupPath, changedFiles, verification, status, reviewerNote, actor }) {
  const pool = await getDbPool({ requireConfigured: true });
  const [result] = await pool.execute(
    `INSERT INTO release_live_applies
      (release_candidate_id, apply_plan_path, backup_path, changed_files_json,
       verification_json, status, reviewer_note, applied_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      releaseCandidateId,
      plan.plan_path,
      backupPath,
      JSON.stringify(changedFiles),
      JSON.stringify(verification),
      status,
      reviewerNote,
      actor,
    ]
  );
  return getReleaseLiveApply(result.insertId);
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

  try {
    await assertApplySafety({ root, releaseCandidateId, plan });
    const changedFiles = [...new Set((plan.changes || []).map(change => change.file))];
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join('tmp', 'live-release-backups', String(releaseCandidateId), timestamp);
    await copyBackups({ root, files: changedFiles, backupPath });

    let verification = null;
    try {
      await writePlanAfterFiles({ root, plan });
      verification = await runVerification(root);
      if (verification.status !== 'passed') {
        await restoreBackups({ root, files: changedFiles, backupPath });
        const restoreVerification = await runVerification(root);
        const failed = await insertLiveApply({
          releaseCandidateId,
          plan,
          backupPath,
          changedFiles,
          verification: { ...verification, restored_from_backup: true, restore_verification: restoreVerification },
          status: 'failed',
          reviewerNote: cleanNote,
          actor,
        });
        await audit(pool, {
          actor,
          action: 'release_live_apply.failed',
          entityType: 'release_live_apply',
          entityId: failed.id,
          after: { release_candidate_id: releaseCandidateId, backup_path: backupPath, verification },
        });
        throw new Error('Live JSON apply failed verification and was restored from backup.');
      }
    } catch (err) {
      if (!verification) {
        await restoreBackups({ root, files: changedFiles, backupPath }).catch(() => {});
        await audit(pool, {
          actor,
          action: 'release_live_apply.error',
          entityType: 'release_candidate',
          entityId: releaseCandidateId,
          after: { error: err.message || String(err), restored_from_backup: true },
        });
      }
      throw err;
    }

    const row = await insertLiveApply({
      releaseCandidateId,
      plan,
      backupPath,
      changedFiles,
      verification,
      status: 'published_pending_deploy',
      reviewerNote: cleanNote,
      actor,
    });
    await pool.execute(
      "UPDATE release_candidates SET status = 'published_pending_deploy' WHERE id = ?",
      [releaseCandidateId]
    );
    await audit(pool, {
      actor,
      action: 'release_live_apply.success',
      entityType: 'release_live_apply',
      entityId: row.id,
      after: {
        release_candidate_id: releaseCandidateId,
        changed_files: changedFiles,
        backup_path: backupPath,
        verification_status: verification.status,
      },
    });
    await audit(pool, {
      actor,
      action: 'release_candidate.published_pending_deploy',
      entityType: 'release_candidate',
      entityId: releaseCandidateId,
      after: {
        release_live_apply_id: row.id,
        manual_git_commit_required: true,
        auto_deploy_triggered: false,
      },
    });
    return row;
  } catch (err) {
    if (err?.message?.includes('Confirmation phrase')) throw err;
    await audit(pool, {
      actor,
      action: 'release_live_apply.error',
      entityType: 'release_candidate',
      entityId: releaseCandidateId,
      after: { error: err.message || String(err) },
    }).catch(() => {});
    throw err;
  }
}

function liveApplyFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    releaseCandidateId: row.release_candidate_id,
    applyPlanPath: row.apply_plan_path,
    backupPath: row.backup_path,
    changedFiles: parseJson(row.changed_files_json, []),
    verification: parseJson(row.verification_json, null),
    status: row.status,
    reviewerNote: row.reviewer_note,
    appliedBy: row.applied_by,
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
  if (row.status !== 'published_pending_deploy') {
    throw new Error('Only published_pending_deploy release applies can be rolled back from this UI.');
  }

  const pool = await getDbPool({ requireConfigured: true });
  try {
    await restoreBackups({ root, files: row.changedFiles, backupPath: row.backupPath });
    const verification = await runVerification(root);
    if (verification.status !== 'passed') {
      await pool.execute(
        `UPDATE release_live_applies
         SET status = 'rollback_failed', verification_json = ?, rolled_back_by = ?, rolled_back_at = CURRENT_TIMESTAMP, rollback_note = ?
         WHERE id = ?`,
        [JSON.stringify({ rollback_verification: verification }), actor, cleanNote, applyId]
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
       SET status = 'rolled_back', verification_json = ?, rolled_back_by = ?, rolled_back_at = CURRENT_TIMESTAMP, rollback_note = ?
       WHERE id = ?`,
      [JSON.stringify({ ...(row.verification || {}), rollback_verification: verification }), actor, cleanNote, applyId]
    );
    await pool.execute(
      "UPDATE release_candidates SET status = 'ready_for_review' WHERE id = ? AND status = 'published_pending_deploy'",
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
