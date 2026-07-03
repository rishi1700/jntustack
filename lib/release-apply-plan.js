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
  if (!Number.isInteger(pathIndex) || pathIndex < 0 || pathIndex >= target.length) {
    throw new Error(`Replacement patch path is out of range: ${patch.path}`);
  }
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

    const planDir = path.join(root, 'tmp', 'release-apply-plans', String(releaseCandidateId));
    const filesDir = path.join(planDir, 'files');
    await fs.rm(planDir, { recursive: true, force: true });
    await fs.mkdir(filesDir, { recursive: true });

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

    for (const [file, afterDocument] of documentCache) {
      const beforeDocument = await readJson(path.join(root, file));
      const safeName = safePlanFileName(file);
      await writeJson(path.join(filesDir, `${safeName}.before.json`), beforeDocument);
      await writeJson(path.join(filesDir, `${safeName}.after.json`), afterDocument);
    }

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
      validation_summary: reviewSummary.validation_status_per_item,
      final_warnings: reviewSummary.warnings,
      rollback_notes_file: 'rollback-notes.md',
      not_applied: true,
      not_published: true,
    };

    await writeJson(path.join(planDir, 'plan.json'), plan);
    await writeJson(path.join(planDir, 'combined-patch.json'), combinedPatch);
    await fs.writeFile(path.join(planDir, 'rollback-notes.md'), rollbackNotes(changes));

    await audit(pool, {
      actor,
      action: 'release_apply_plan.generate',
      entityType: 'release_candidate',
      entityId: releaseCandidateId,
      after: {
        plan_path: plan.plan_path,
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

export async function getReleaseApplyPlan({ root = process.cwd(), releaseCandidateId } = {}) {
  const planPath = path.join(root, 'tmp', 'release-apply-plans', String(releaseCandidateId), 'plan.json');
  try {
    return parseJson(await fs.readFile(planPath, 'utf-8'), null);
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
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
