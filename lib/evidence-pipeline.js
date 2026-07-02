import { getAsset } from './assets.js';
import { describeDbError, getDbPool } from './db.js';
import { createDiffFromExtractionResult } from './diff-results.js';
import { getExtractionResult, runEntityExtraction } from './extraction-results.js';
import { runParser } from './parse-results.js';
import { createContentProposalFromDiffResult } from './proposals.js';

const ENTITY_TYPES = new Set(['subject', 'college', 'branch_profile']);

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function bool(value) {
  return value === true || value === 'true' || value === '1' || value === 'on' || value === 1;
}

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  return JSON.parse(value);
}

function normalizePositiveInt(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

function nullableCandidateIndex(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error('Candidate index must be a non-negative integer.');
  return parsed;
}

function pipelineRunFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    assetId: row.asset_id,
    parserKey: row.parser_key,
    entityType: row.entity_type,
    entityKey: row.entity_key,
    status: row.status,
    steps: parseJson(row.steps_json, []),
    errorMessage: row.error_message,
    createdBy: row.created_by,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    assetFilename: row.original_filename,
  };
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

async function createPipelineRun({ assetId, parserKey, entityType, entityKey, createdBy }) {
  const pool = await getDbPool({ requireConfigured: true });
  const [result] = await pool.execute(
    `INSERT INTO pipeline_runs
      (asset_id, parser_key, entity_type, entity_key, status, steps_json, created_by)
     VALUES (?, ?, ?, ?, 'running', JSON_ARRAY(), ?)`,
    [assetId, parserKey, entityType, entityKey || null, createdBy]
  );
  return result.insertId;
}

async function updatePipelineRun(id, { status = null, steps, errorMessage = null, finish = false }) {
  const pool = await getDbPool({ requireConfigured: true });
  await pool.execute(
    `UPDATE pipeline_runs
     SET status = COALESCE(?, status),
         steps_json = ?,
         error_message = ?,
         finished_at = ${finish ? 'CURRENT_TIMESTAMP' : 'finished_at'}
     WHERE id = ?`,
    [status, JSON.stringify(steps), errorMessage, id]
  );
}

async function updatePipelineEntityKey(id, entityKey) {
  const pool = await getDbPool({ requireConfigured: true });
  await pool.execute('UPDATE pipeline_runs SET entity_key = ? WHERE id = ?', [entityKey || null, id]);
}

function addStep(steps, step, status, data = {}) {
  steps.push({
    step,
    status,
    ...data,
    at: new Date().toISOString(),
  });
}

async function markStepSuccess({ actor, pipelineRunId, steps, step, data }) {
  addStep(steps, step, 'success', data);
  await updatePipelineRun(pipelineRunId, { steps });
  await audit({
    actor,
    action: 'pipeline.step_success',
    entityType: 'pipeline_run',
    entityId: pipelineRunId,
    after: { step, ...data },
  });
}

async function markStepError({ actor, pipelineRunId, steps, step, err }) {
  const message = err?.message || String(err);
  addStep(steps, step, 'error', { error: message });
  await updatePipelineRun(pipelineRunId, { status: 'error', steps, errorMessage: message, finish: true });
  await audit({
    actor,
    action: 'pipeline.step_error',
    entityType: 'pipeline_run',
    entityId: pipelineRunId,
    after: { step, error: message },
  });
}

function candidateEntityKey(parseResult, entityType, candidateIndex) {
  if (candidateIndex == null) return '';
  const candidates = Array.isArray(parseResult.parsedPayload?.candidates) ? parseResult.parsedPayload.candidates : [];
  const candidate = candidates[candidateIndex];
  if (!candidate) return '';
  if (entityType === 'subject') return clean(candidate.entity_key || candidate.seo?.slug || candidate.id || candidate.name);
  if (entityType === 'college') return clean(candidate.entity_key || candidate.name || candidate.official_website);
  if (entityType === 'branch_profile') return clean(candidate.entity_key || candidate.branch);
  return '';
}

export async function runManualEvidencePipeline({
  root,
  assetId,
  parserKey,
  entityType,
  entityKey = '',
  candidateIndex = null,
  hints = {},
  createProposal = false,
  actor = null,
}) {
  const normalizedAssetId = normalizePositiveInt(assetId, 'Asset ID');
  const normalizedParserKey = clean(parserKey);
  const normalizedEntityType = clean(entityType);
  const normalizedCandidateIndex = nullableCandidateIndex(candidateIndex);
  let normalizedEntityKey = clean(entityKey);

  if (!normalizedParserKey) throw new Error('Parser key is required.');
  if (!ENTITY_TYPES.has(normalizedEntityType)) throw new Error(`Unsupported entity type: ${normalizedEntityType}`);

  const asset = await getAsset(normalizedAssetId);
  if (!asset) throw new Error(`Source asset not found: ${normalizedAssetId}`);

  const pipelineRunId = await createPipelineRun({
    assetId: normalizedAssetId,
    parserKey: normalizedParserKey,
    entityType: normalizedEntityType,
    entityKey: normalizedEntityKey,
    createdBy: actor,
  });
  const steps = [];

  await audit({
    actor,
    action: 'pipeline.run',
    entityType: 'pipeline_run',
    entityId: pipelineRunId,
    after: {
      asset_id: normalizedAssetId,
      parser_key: normalizedParserKey,
      entity_type: normalizedEntityType,
      entity_key: normalizedEntityKey || null,
      candidate_index: normalizedCandidateIndex,
      create_proposal: bool(createProposal),
    },
  });

  try {
    const parseResult = await runParser({
      root,
      assetId: normalizedAssetId,
      parserKey: normalizedParserKey,
      actor,
    });
    if (parseResult.status !== 'success') throw new Error(parseResult.errorMessage || 'Parser did not complete successfully.');
    await markStepSuccess({
      actor,
      pipelineRunId,
      steps,
      step: 'parse',
      data: { parse_result_id: parseResult.id, parser_key: parseResult.parserKey },
    });

    if (!normalizedEntityKey) {
      normalizedEntityKey = candidateEntityKey(parseResult, normalizedEntityType, normalizedCandidateIndex);
      if (normalizedEntityKey) await updatePipelineEntityKey(pipelineRunId, normalizedEntityKey);
    }

    const extractionResult = await runEntityExtraction({
      root,
      parseResultId: parseResult.id,
      entityType: normalizedEntityType,
      entityKey: normalizedEntityKey,
      candidateIndex: normalizedCandidateIndex,
      hints,
      actor,
    });
    if (extractionResult.status !== 'success') throw new Error(extractionResult.errorMessage || 'Extraction did not complete successfully.');
    await markStepSuccess({
      actor,
      pipelineRunId,
      steps,
      step: 'extract',
      data: {
        extraction_result_id: extractionResult.id,
        validation_status: extractionResult.validationStatus,
        validation_error_count: extractionResult.validationErrors?.length || 0,
      },
    });

    let diffResult = null;
    if (extractionResult.entityKey) {
      diffResult = await createDiffFromExtractionResult({
        root,
        extractionResultId: extractionResult.id,
        actor,
      });
      if (diffResult.status !== 'success') throw new Error(diffResult.errorMessage || 'Diff did not complete successfully.');
      await markStepSuccess({
        actor,
        pipelineRunId,
        steps,
        step: 'diff',
        data: { diff_result_id: diffResult.id },
      });
    } else {
      addStep(steps, 'diff', 'skipped', { reason: 'missing_entity_key' });
      await updatePipelineRun(pipelineRunId, { steps });
    }

    let proposalOutcome = null;
    if (bool(createProposal)) {
      if (!diffResult?.id) {
        throw new Error('Cannot create proposal because no successful diff was created.');
      }
      if (extractionResult.validationStatus !== 'passed') {
        addStep(steps, 'proposal', 'skipped', { reason: 'validation_failed' });
        await updatePipelineRun(pipelineRunId, {
          status: 'validation_failed',
          steps,
          errorMessage: 'Proposal was not created because extraction validation failed.',
          finish: true,
        });
        return getPipelineRun(pipelineRunId);
      }
      proposalOutcome = await createContentProposalFromDiffResult({
        root,
        diffResultId: diffResult.id,
        actor,
        note: `Created by manual evidence pipeline run ${pipelineRunId}.`,
      });
      await markStepSuccess({
        actor,
        pipelineRunId,
        steps,
        step: 'proposal',
        data: { proposal_id: proposalOutcome.id, created: proposalOutcome.created },
      });
      if (proposalOutcome.created) {
        await audit({
          actor,
          action: 'pipeline.proposal_created',
          entityType: 'pipeline_run',
          entityId: pipelineRunId,
          after: { proposal_id: proposalOutcome.id, diff_result_id: diffResult.id },
        });
      }
    } else {
      addStep(steps, 'proposal', 'skipped', { reason: 'create_proposal_not_checked' });
      await updatePipelineRun(pipelineRunId, { steps });
    }

    await updatePipelineRun(pipelineRunId, { status: 'success', steps, finish: true });
    return getPipelineRun(pipelineRunId);
  } catch (err) {
    await markStepError({
      actor,
      pipelineRunId,
      steps,
      step: steps.length ? 'pipeline' : 'parse',
      err,
    });
    return getPipelineRun(pipelineRunId);
  }
}

export async function getPipelineRun(id) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute(
    `SELECT pr.*, sa.original_filename
     FROM pipeline_runs pr
     LEFT JOIN source_assets sa ON sa.id = pr.asset_id
     WHERE pr.id = ?`,
    [id]
  );
  return pipelineRunFromRow(rows[0]);
}

export async function listPipelineRunsForAsset(assetId, { limit = 25 } = {}) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute(
    `SELECT pr.*, sa.original_filename
     FROM pipeline_runs pr
     LEFT JOIN source_assets sa ON sa.id = pr.asset_id
     WHERE pr.asset_id = ?
     ORDER BY pr.created_at DESC, pr.id DESC
     LIMIT ?`,
    [assetId, limit]
  );
  return rows.map(pipelineRunFromRow);
}

export function pipelineErrorSummary(err) {
  const safe = describeDbError(err);
  if (err?.name === 'DatabaseConfigError') {
    return 'Manual evidence pipeline requires MySQL configuration. Set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, and run migrations.';
  }
  if (safe.code === 'ER_NO_SUCH_TABLE' || safe.code === 'ER_BAD_FIELD_ERROR') {
    return 'Pipeline tables are missing or out of date. Run npm run db:migrate.';
  }
  return `${safe.code ? `${safe.code}: ` : ''}${safe.message}`;
}
