import fs from 'node:fs/promises';
import path from 'node:path';
import { describeDbError, getDbPool } from './db.js';
import { generateReleaseReviewSummary } from './release-review.js';

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  return JSON.parse(value);
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

function collectionArrayName(collection) {
  if (collection === 'subjects') return 'subjects';
  if (collection === 'colleges') return 'colleges';
  if (collection === 'branch_profiles') return 'branch_profiles';
  throw new Error(`Unsupported release apply collection: ${collection}`);
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
  return Boolean(left?.branch && right?.branch && normalize(left.branch) === normalize(right.branch));
}

function entityMatches(collection, left, right) {
  if (collection === 'subjects') return subjectMatches(left, right);
  if (collection === 'colleges') return collegeMatches(left, right);
  if (collection === 'branch_profiles') return branchProfileMatches(left, right);
  return false;
}

function applyPatchPreview(document, exportPayload) {
  const patch = exportPayload?.patch?.[0];
  if (!patch || !['add', 'replace'].includes(patch.op)) {
    throw new Error('Apply plan requires one add or replace patch operation per export.');
  }
  const collection = exportPayload?.target?.collection;
  const arrayName = collectionArrayName(collection);
  if (!Array.isArray(document[arrayName])) {
    throw new Error(`Target file does not contain ${arrayName} array.`);
  }
  const next = clone(document);
  const target = next[arrayName];
  if (patch.op === 'add') {
    target.push(patch.value);
    return {
      before: null,
      after: patch.value,
      operation: 'add',
      index: target.length - 1,
      document: next,
    };
  }

  const pathIndex = Number(String(patch.path || '').split('/').pop());
  if (
    Number.isInteger(pathIndex) &&
    pathIndex >= 0 &&
    pathIndex < target.length &&
    entityMatches(collection, target[pathIndex], patch.value)
  ) {
    const before = clone(target[pathIndex]);
    target[pathIndex] = patch.value;
    return {
      before,
      after: patch.value,
      operation: 'replace',
      index: pathIndex,
      document: next,
    };
  }

  const identityIndex = target.findIndex(entry => entityMatches(collection, entry, patch.value));
  if (identityIndex < 0) {
    throw new Error(`Replacement target was not found in ${collection} for patch path ${patch.path}.`);
  }
  const before = clone(target[identityIndex]);
  target[identityIndex] = patch.value;
  return {
    before,
    after: patch.value,
    operation: 'replace',
    index: identityIndex,
    document: next,
  };
}

function rollbackNotes(changes) {
  return [
    '# Release Apply Plan Rollback Notes',
    '',
    'This is a review artifact only. Nothing has been applied or published.',
    '',
    'If a human later applies these changes manually and needs to roll back:',
    '',
    '1. Revert the affected files listed below from git.',
    '2. Re-run the normal build and audit checks before deploying.',
    '3. Do not mark any proposal as published without a separate approval step.',
    '',
    'Affected files:',
    ...changes.map(change => `- ${change.file}`),
    '',
  ].join('\n');
}

function rollbackNotesJson(changes, markdown) {
  return {
    markdown,
    affected_files: [...new Set((changes || []).map(change => change.file).filter(Boolean))],
  };
}

function releasePlanStorage({
  dbPlanId = null,
  createdAt = null,
  updatedAt = null,
  source = 'generated',
  tmpArtifactStatus = 'unknown',
  tmpArtifactChecks = {},
  tmpArtifactMessage = null,
} = {}) {
  return {
    canonical: 'db',
    db_plan_id: dbPlanId,
    source,
    created_at: createdAt,
    updated_at: updatedAt,
    tmp_artifact_status: tmpArtifactStatus,
    tmp_artifact_checks: tmpArtifactChecks,
    tmp_artifact_message: tmpArtifactMessage,
  };
}

async function tmpArtifactStatus({ root, plan }) {
  const checks = {};
  const planPath = plan?.plan_path ? path.join(root, plan.plan_path) : null;
  if (!planPath) {
    return {
      status: 'missing',
      checks: { plan_path: false },
      message: 'No tmp plan path is recorded.',
    };
  }
  const files = [
    ['plan_json', path.join(planPath, 'plan.json')],
    ['combined_patch_json', path.join(planPath, 'combined-patch.json')],
    ['rollback_notes', path.join(planPath, 'rollback-notes.md')],
    ['files_dir', path.join(planPath, 'files')],
  ];
  for (const [key, filePath] of files) {
    try {
      await fs.access(filePath);
      checks[key] = true;
    } catch {
      checks[key] = false;
    }
  }
  const status = Object.values(checks).every(Boolean) ? 'available' : 'missing';
  return {
    status,
    checks,
    message: status === 'available'
      ? 'Tmp apply-plan artifacts are available.'
      : 'Tmp apply-plan artifacts are missing or incomplete; DB plan remains canonical.',
  };
}

async function writeTmpPlanArtifacts({ root, releaseCandidateId, plan, documentCache, combinedPatch, rollbackMarkdown }) {
  const planDir = path.join(root, 'tmp', 'release-apply-plans', String(releaseCandidateId));
  const filesDir = path.join(planDir, 'files');
  await fs.rm(planDir, { recursive: true, force: true });
  await fs.mkdir(filesDir, { recursive: true });

  for (const [file, afterDocument] of documentCache) {
    const beforeDocument = await readJson(path.join(root, file));
    const safeName = safePlanFileName(file);
    await writeJson(path.join(filesDir, `${safeName}.before.json`), beforeDocument);
    await writeJson(path.join(filesDir, `${safeName}.after.json`), afterDocument);
  }

  await writeJson(path.join(planDir, 'plan.json'), plan);
  await writeJson(path.join(planDir, 'combined-patch.json'), combinedPatch);
  await fs.writeFile(path.join(planDir, 'rollback-notes.md'), rollbackMarkdown);
}

async function storeReleaseApplyPlan(pool, {
  releaseCandidateId,
  plan,
  changedFiles,
  warnings,
  validationSummary,
  rollbackNotesValue,
  actor,
}) {
  const payload = JSON.stringify(plan);
  const [existing] = await pool.execute(
    'SELECT id FROM release_apply_plans WHERE release_candidate_id = ?',
    [releaseCandidateId]
  );
  if (existing[0]) {
    await pool.execute(
      `UPDATE release_apply_plans
       SET plan_payload_json = ?,
           changed_files_json = ?,
           warnings_json = ?,
           validation_summary_json = ?,
           rollback_notes_json = ?,
           created_by = COALESCE(created_by, ?)
       WHERE release_candidate_id = ?`,
      [
        payload,
        JSON.stringify(changedFiles),
        JSON.stringify(warnings || []),
        JSON.stringify(validationSummary || []),
        JSON.stringify(rollbackNotesValue || null),
        actor,
        releaseCandidateId,
      ]
    );
  } else {
    await pool.execute(
      `INSERT INTO release_apply_plans
        (release_candidate_id, plan_payload_json, changed_files_json, warnings_json,
         validation_summary_json, rollback_notes_json, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        releaseCandidateId,
        payload,
        JSON.stringify(changedFiles),
        JSON.stringify(warnings || []),
        JSON.stringify(validationSummary || []),
        JSON.stringify(rollbackNotesValue || null),
        actor,
      ]
    );
  }
  const [rows] = await pool.execute(
    'SELECT * FROM release_apply_plans WHERE release_candidate_id = ?',
    [releaseCandidateId]
  );
  return rows[0];
}

async function loadStoredReleaseApplyPlan(pool, { root, releaseCandidateId }) {
  const [rows] = await pool.execute(
    'SELECT * FROM release_apply_plans WHERE release_candidate_id = ?',
    [releaseCandidateId]
  );
  const row = rows[0];
  if (!row) return null;
  const plan = parseJson(row.plan_payload_json, null);
  if (!plan) return null;
  const artifact = await tmpArtifactStatus({ root, plan });
  return {
    ...plan,
    storage: releasePlanStorage({
      dbPlanId: row.id,
      source: plan?.storage?.source || 'db',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      tmpArtifactStatus: artifact.status,
      tmpArtifactChecks: artifact.checks,
      tmpArtifactMessage: artifact.message,
    }),
  };
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
      cp.entity_type, cp.entity_key,
      pe.validation_status AS export_validation_status,
      pe.export_payload_json,
      pda.validation_status AS draft_validation_status,
      pda.summary_json AS draft_summary_json
     FROM release_candidate_items rci
     INNER JOIN content_proposals cp ON cp.id = rci.proposal_id
     LEFT JOIN proposal_exports pe ON pe.id = rci.proposal_export_id
     LEFT JOIN proposal_draft_applies pda ON pda.id = rci.draft_apply_id
     WHERE rci.release_candidate_id = ?
     ORDER BY pe.export_path ASC, rci.id ASC`,
    [releaseCandidateId]
  );
  return { release, itemRows };
}

function blockReason(release, reviewSummary) {
  if (release.status !== 'ready_for_review') {
    return `Release candidate must be ready_for_review before generating an apply plan. Current status: ${release.status}.`;
  }
  if (reviewSummary.has_blocking_warnings) {
    return `Release candidate review summary has ${reviewSummary.blocking_warning_count} blocking warning(s).`;
  }
  return null;
}

export async function generateReleaseApplyPlan({ root = process.cwd(), releaseCandidateId, actor = null } = {}) {
  const pool = await getDbPool({ requireConfigured: true });
  try {
    const { release, itemRows } = await releaseRows(pool, releaseCandidateId);
    const reviewSummary = await generateReleaseReviewSummary({ releaseCandidateId });
    const blocked = blockReason(release, reviewSummary);
    if (blocked) {
      await audit(pool, {
        actor,
        action: 'release_apply_plan.blocked',
        entityType: 'release_candidate',
        entityId: releaseCandidateId,
        after: {
          reason: blocked,
          status: release.status,
          blocking_warning_count: reviewSummary.blocking_warning_count,
        },
      });
      throw new Error(blocked);
    }

    const documentCache = new Map();
    const changes = [];
    const combinedPatch = [];

    for (const row of itemRows) {
      const exportPayload = parseJson(row.export_payload_json, null);
      if (!exportPayload) throw new Error(`Release item ${row.id} is missing export payload.`);
      const targetFile = exportPayload?.target?.data_file_hint;
      if (!targetFile || !String(targetFile).startsWith('data/')) {
        throw new Error(`Release item ${row.id} export does not include a safe data_file_hint.`);
      }

      const absoluteTarget = path.join(root, targetFile);
      const currentDocument = documentCache.has(targetFile)
        ? documentCache.get(targetFile)
        : await readJson(absoluteTarget);
      const preview = applyPatchPreview(currentDocument, exportPayload);
      documentCache.set(targetFile, preview.document);

      const change = {
        order: changes.length + 1,
        release_candidate_item_id: row.id,
        proposal_id: row.proposal_id,
        proposal_export_id: row.proposal_export_id,
        draft_apply_id: row.draft_apply_id,
        revision_id: row.revision_id,
        entity_type: row.entity_type,
        entity_key: row.entity_key,
        file: targetFile,
        operation: preview.operation,
        index: preview.index,
        before_json: preview.before,
        after_json: preview.after,
        validation: {
          export: row.export_validation_status,
          draft: row.draft_validation_status,
        },
      };
      changes.push(change);
      combinedPatch.push({
        file: targetFile,
        op: preview.operation,
        collection: exportPayload.target.collection,
        index: preview.index,
        proposal_id: row.proposal_id,
        entity_type: row.entity_type,
        entity_key: row.entity_key,
        value: preview.after,
      });
    }

    const planDir = path.join(root, 'tmp', 'release-apply-plans', String(releaseCandidateId));
    const rollbackMarkdown = rollbackNotes(changes);
    const validationSummary = reviewSummary.validation_status_per_item;

    const plan = {
      release_candidate_id: Number(releaseCandidateId),
      title: release.title,
      status: release.status,
      generated_at: new Date().toISOString(),
      plan_path: path.relative(root, planDir),
      ordered_file_changes: changes.map(change => ({
        order: change.order,
        file: change.file,
        operation: change.operation,
        entity_type: change.entity_type,
        entity_key: change.entity_key,
        proposal_id: change.proposal_id,
        proposal_export_id: change.proposal_export_id,
        draft_apply_id: change.draft_apply_id,
        revision_id: change.revision_id,
      })),
      changes,
      combined_patch: combinedPatch,
      validation_summary: validationSummary,
      final_warnings: reviewSummary.warnings,
      rollback_notes_file: 'rollback-notes.md',
      rollback_notes: rollbackNotesJson(changes, rollbackMarkdown),
      storage: releasePlanStorage({
        source: 'generated',
        tmpArtifactStatus: 'pending',
        tmpArtifactMessage: 'Tmp apply-plan artifacts are convenience files; DB payload is canonical.',
      }),
      not_applied: true,
      not_published: true,
    };

    let tmpArtifact = { status: 'not_written', checks: {}, message: null };
    try {
      await writeTmpPlanArtifacts({
        root,
        releaseCandidateId,
        plan,
        documentCache,
        combinedPatch,
        rollbackMarkdown,
      });
      tmpArtifact = await tmpArtifactStatus({ root, plan });
    } catch (err) {
      tmpArtifact = {
        status: 'missing',
        checks: {},
        message: `Tmp artifact write failed: ${err.message || String(err)}. DB plan remains canonical.`,
      };
    }

    const stored = await storeReleaseApplyPlan(pool, {
      releaseCandidateId,
      plan,
      changedFiles: [...documentCache.keys()],
      warnings: reviewSummary.warnings,
      validationSummary,
      rollbackNotesValue: plan.rollback_notes,
      actor,
    });
    plan.storage = releasePlanStorage({
      dbPlanId: stored.id,
      source: 'generated',
      createdAt: stored.created_at,
      updatedAt: stored.updated_at,
      tmpArtifactStatus: tmpArtifact.status,
      tmpArtifactChecks: tmpArtifact.checks,
      tmpArtifactMessage: tmpArtifact.message,
    });
    await storeReleaseApplyPlan(pool, {
      releaseCandidateId,
      plan,
      changedFiles: [...documentCache.keys()],
      warnings: reviewSummary.warnings,
      validationSummary,
      rollbackNotesValue: plan.rollback_notes,
      actor,
    });

    await audit(pool, {
      actor,
      action: 'release_apply_plan.generate',
      entityType: 'release_candidate',
      entityId: releaseCandidateId,
      after: {
        plan_path: plan.plan_path,
        db_plan_id: stored.id,
        canonical_storage: 'db',
        tmp_artifact_status: tmpArtifact.status,
        change_count: changes.length,
        files: [...documentCache.keys()],
      },
    });

    return plan;
  } catch (err) {
    if (!String(err?.message || '').includes('must be ready_for_review') && !String(err?.message || '').includes('blocking warning')) {
      await audit(pool, {
        actor,
        action: 'release_apply_plan.error',
        entityType: 'release_candidate',
        entityId: releaseCandidateId,
        after: { error: err.message || String(err) },
      });
    }
    throw err;
  }
}

async function loadTmpReleaseApplyPlan({ root, releaseCandidateId }) {
  const planPath = path.join(root, 'tmp', 'release-apply-plans', String(releaseCandidateId), 'plan.json');
  try {
    return parseJson(await fs.readFile(planPath, 'utf-8'), null);
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

async function releaseRowsForReconstruction(pool, releaseCandidateId) {
  const [releaseRowsResult] = await pool.execute(
    'SELECT * FROM release_candidates WHERE id = ?',
    [releaseCandidateId]
  );
  const release = releaseRowsResult[0];
  if (!release) return null;

  const [itemRows] = await pool.execute(
    `SELECT rci.*,
      cp.entity_type, cp.entity_key, cp.normalized_payload_json, cp.proposed_payload_json,
      pe.validation_status AS export_validation_status,
      pe.export_payload_json,
      pda.validation_status AS draft_validation_status
     FROM release_candidate_items rci
     INNER JOIN content_proposals cp ON cp.id = rci.proposal_id
     LEFT JOIN proposal_exports pe ON pe.id = rci.proposal_export_id
     LEFT JOIN proposal_draft_applies pda ON pda.id = rci.draft_apply_id
     WHERE rci.release_candidate_id = ?
     ORDER BY rci.id ASC`,
    [releaseCandidateId]
  );

  const [liveApplyRows] = await pool.execute(
    `SELECT * FROM release_live_applies
     WHERE release_candidate_id = ?
     ORDER BY applied_at DESC, id DESC
     LIMIT 1`,
    [releaseCandidateId]
  );

  return { release, itemRows, latestApply: liveApplyRows[0] || null };
}

async function reconstructReleaseApplyPlanFromMetadata(pool, { root, releaseCandidateId, actor = null } = {}) {
  const rows = await releaseRowsForReconstruction(pool, releaseCandidateId);
  if (!rows?.release || !rows.latestApply) return null;

  const reconstructableStatuses = new Set([
    'partial_applied_needs_review',
    'published_pending_deploy_recovered',
    'published_pending_deploy',
    'applied_to_live',
  ]);
  if (!reconstructableStatuses.has(rows.release.status)) return null;

  const changes = [];
  const combinedPatch = [];
  const changedFiles = [];

  for (const row of rows.itemRows) {
    const exportPayload = parseJson(row.export_payload_json, null);
    const patch = exportPayload?.patch?.[0];
    const target = exportPayload?.target || {};
    const file = target.data_file_hint;
    if (!file || !String(file).startsWith('data/') || !patch) continue;

    const proposedPayload = parseJson(row.normalized_payload_json || row.proposed_payload_json, null);
    const after = patch.value || exportPayload.replacement || proposedPayload;
    const operation = patch.op === 'replace' ? 'replace' : 'add';
    const indexValue = String(patch.path || '').split('/').pop();
    const index = Number.isInteger(Number(indexValue)) && indexValue !== '-' ? Number(indexValue) : null;
    if (!changedFiles.includes(file)) changedFiles.push(file);

    const change = {
      order: changes.length + 1,
      release_candidate_item_id: row.id,
      proposal_id: row.proposal_id,
      proposal_export_id: row.proposal_export_id,
      draft_apply_id: row.draft_apply_id,
      revision_id: row.revision_id,
      entity_type: row.entity_type,
      entity_key: row.entity_key,
      file,
      operation,
      index,
      before_json: operation === 'add' ? null : null,
      after_json: after,
      validation: {
        export: row.export_validation_status,
        draft: row.draft_validation_status,
      },
      reconstructed_from_metadata: true,
    };
    changes.push(change);
    combinedPatch.push({
      file,
      op: operation,
      collection: target.collection,
      index,
      proposal_id: row.proposal_id,
      entity_type: row.entity_type,
      entity_key: row.entity_key,
      value: after,
      reconstructed_from_metadata: true,
    });
  }

  if (!changes.length) return null;

  let reviewSummary = null;
  try {
    reviewSummary = await generateReleaseReviewSummary({ releaseCandidateId });
  } catch {
    reviewSummary = null;
  }
  const rollbackMarkdown = rollbackNotes(changes);
  const plan = {
    release_candidate_id: Number(releaseCandidateId),
    title: rows.release.title,
    status: rows.release.status,
    generated_at: rows.latestApply.created_at || rows.latestApply.applied_at || new Date().toISOString(),
    plan_path: rows.latestApply.apply_plan_path || path.join('tmp', 'release-apply-plans', String(releaseCandidateId)),
    ordered_file_changes: changes.map(change => ({
      order: change.order,
      file: change.file,
      operation: change.operation,
      entity_type: change.entity_type,
      entity_key: change.entity_key,
      proposal_id: change.proposal_id,
      proposal_export_id: change.proposal_export_id,
      draft_apply_id: change.draft_apply_id,
      revision_id: change.revision_id,
    })),
    changes,
    combined_patch: combinedPatch,
    validation_summary: reviewSummary?.validation_status_per_item || [],
    final_warnings: reviewSummary?.warnings || [],
    rollback_notes_file: 'rollback-notes.md',
    rollback_notes: rollbackNotesJson(changes, rollbackMarkdown),
    recovered_context: {
      live_apply_id: rows.latestApply.id,
      live_apply_status: rows.latestApply.status,
      live_apply_phase: rows.latestApply.phase,
      backup_exists: Boolean(rows.latestApply.backup_exists),
      backup_path: rows.latestApply.backup_path || null,
      recovery: parseJson(rows.latestApply.recovery_json, null),
    },
    reconstructed_from_metadata: true,
    not_applied: false,
    not_published: true,
    storage: releasePlanStorage({
      source: 'recovered_metadata',
      tmpArtifactStatus: 'missing',
      tmpArtifactMessage: 'Tmp apply-plan artifacts were unavailable; this plan was reconstructed from durable release, proposal, export, and live-apply metadata.',
    }),
  };

  const stored = await storeReleaseApplyPlan(pool, {
    releaseCandidateId,
    plan,
    changedFiles,
    warnings: plan.final_warnings,
    validationSummary: plan.validation_summary,
    rollbackNotesValue: plan.rollback_notes,
    actor,
  });
  const artifact = await tmpArtifactStatus({ root, plan });
  return {
    ...plan,
    storage: releasePlanStorage({
      dbPlanId: stored.id,
      source: 'recovered_metadata',
      createdAt: stored.created_at,
      updatedAt: stored.updated_at,
      tmpArtifactStatus: artifact.status,
      tmpArtifactChecks: artifact.checks,
      tmpArtifactMessage: 'Tmp apply-plan artifacts were unavailable at recovery time; DB plan is reconstructed and canonical.',
    }),
  };
}

export async function getReleaseApplyPlan({ root = process.cwd(), releaseCandidateId } = {}) {
  const pool = await getDbPool({ requireConfigured: true });
  const stored = await loadStoredReleaseApplyPlan(pool, { root, releaseCandidateId });
  if (stored) return stored;

  const tmpPlan = await loadTmpReleaseApplyPlan({ root, releaseCandidateId });
  if (tmpPlan) {
    const changedFiles = [...new Set((tmpPlan.changes || []).map(change => change.file).filter(Boolean))];
    const rollbackMarkdown = tmpPlan.rollback_notes?.markdown || rollbackNotes(tmpPlan.changes || []);
    tmpPlan.rollback_notes = tmpPlan.rollback_notes || rollbackNotesJson(tmpPlan.changes || [], rollbackMarkdown);
    const storedTmp = await storeReleaseApplyPlan(pool, {
      releaseCandidateId,
      plan: {
        ...tmpPlan,
        storage: releasePlanStorage({
          source: 'tmp_import',
          tmpArtifactStatus: 'available',
          tmpArtifactMessage: 'Imported into DB from existing tmp apply-plan artifact.',
        }),
      },
      changedFiles,
      warnings: tmpPlan.final_warnings || [],
      validationSummary: tmpPlan.validation_summary || [],
      rollbackNotesValue: tmpPlan.rollback_notes,
      actor: null,
    });
    const artifact = await tmpArtifactStatus({ root, plan: tmpPlan });
    return {
      ...tmpPlan,
      storage: releasePlanStorage({
        dbPlanId: storedTmp.id,
        source: 'tmp_import',
        createdAt: storedTmp.created_at,
        updatedAt: storedTmp.updated_at,
        tmpArtifactStatus: artifact.status,
        tmpArtifactChecks: artifact.checks,
        tmpArtifactMessage: artifact.message,
      }),
    };
  }

  return reconstructReleaseApplyPlanFromMetadata(pool, { root, releaseCandidateId });
}

export function releaseApplyPlanErrorSummary(err) {
  const safe = describeDbError(err);
  if (err?.name === 'DatabaseConfigError') {
    return 'Release apply plans require MySQL configuration. Set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, and run migrations.';
  }
  if (safe.code === 'ER_NO_SUCH_TABLE' || safe.code === 'ER_BAD_FIELD_ERROR') {
    return 'Release apply plan tables are missing or out of date. Run npm run db:migrate.';
  }
  return `${safe.code ? `${safe.code}: ` : ''}${safe.message}`;
}
