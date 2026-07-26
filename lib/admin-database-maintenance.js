import crypto from 'node:crypto';
import path from 'node:path';
import { getContentSource } from './config.js';
import { describeDbError, getDbPool } from './db.js';
import {
  AUTHORITATIVE_PRUNE_CONFIRMATION,
  createAuthoritativePruneRequestId,
  exportDbContent,
  findAuthoritativePruneCommitEvidence,
  importJsonContent,
  loadJsonContent,
  parityReport,
  verifyAuthoritativeMirrorKeyState,
} from './db-json.js';

export { AUTHORITATIVE_PRUNE_CONFIRMATION as DATABASE_MIRROR_PRUNE_CONFIRMATION };

export const DATABASE_MIRROR_CSRF_ACTION = 'admin.database-mirror-maintenance';
export const DATABASE_MIRROR_TIMEOUT_MS = 45_000;
export const DATABASE_MIRROR_RECONCILIATION_TIMEOUT_MS = 8_000;
export const DATABASE_MIRROR_RESULT_RENDER_TIMEOUT_MS = 3_000;
const DATABASE_MIRROR_QUERY_TIMEOUT_MS = 12_000;
const DATABASE_MIRROR_LOCK_NAME = 'jntustack.database_mirror_maintenance';
const DATABASE_MIRROR_ACTIONS = new Set(['parity', 'sync', 'prune_preview', 'sync_prune']);
const DATABASE_MIRROR_CONFIRMATION_PREFIX_PATTERN = AUTHORITATIVE_PRUNE_CONFIRMATION
  .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DATABASE_MIRROR_PLAN_TOKEN_PATTERN = new RegExp(
  `^${DATABASE_MIRROR_CONFIRMATION_PREFIX_PATTERN}:[a-f0-9]{64}$`
);
const MAX_LOG_LINES = 80;
const MAX_LOG_LINE_LENGTH = 500;

let maintenanceInProgress = false;

const DEFAULT_MAINTENANCE_DEPENDENCIES = {
  createAuthoritativePruneRequestId,
  exportDbContent,
  findAuthoritativePruneCommitEvidence,
  getContentSource,
  getDbPool,
  importJsonContent,
  loadJsonContent,
  parityReport,
  verifyAuthoritativeMirrorKeyState,
};

class DatabaseMirrorMaintenanceError extends Error {
  constructor(code, publicMessage, options = {}) {
    super(publicMessage, options);
    this.name = 'DatabaseMirrorMaintenanceError';
    this.code = code;
    this.publicMessage = publicMessage;
    this.httpStatus = options.httpStatus || 400;
    this.result = options.result || null;
  }
}

function boundedTimeout(value, fallback, { minimum = 1_000, maximum = DATABASE_MIRROR_TIMEOUT_MS } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
}

export function normalizeDatabaseMirrorRequest({
  action,
  confirmationPhrase,
} = {}) {
  const normalizedAction = String(action || 'parity').trim().toLowerCase() || 'parity';
  if (!DATABASE_MIRROR_ACTIONS.has(normalizedAction)) {
    throw new DatabaseMirrorMaintenanceError(
      'INVALID_ACTION',
      'Choose one of the available database mirror maintenance actions.'
    );
  }

  const suppliedConfirmation = confirmationPhrase == null ? '' : String(confirmationPhrase);
  if (normalizedAction === 'sync_prune') {
    if (!DATABASE_MIRROR_PLAN_TOKEN_PATTERN.test(suppliedConfirmation)) {
      throw new DatabaseMirrorMaintenanceError(
        'PRUNE_CONFIRMATION_REQUIRED',
        'Run “Preview obsolete mirror rows” first, then type the exact plan-bound confirmation token shown in that result. The reusable confirmation prefix alone cannot authorize deletion.'
      );
    }
  } else if (suppliedConfirmation) {
    throw new DatabaseMirrorMaintenanceError(
      'UNEXPECTED_CONFIRMATION',
      'The prune confirmation phrase may only be submitted with “Sync and prune obsolete rows”.'
    );
  }

  return {
    action: normalizedAction,
    readOnly: normalizedAction === 'parity' || normalizedAction === 'prune_preview',
    writesMirror: normalizedAction === 'sync' || normalizedAction === 'sync_prune',
    destructive: normalizedAction === 'sync_prune',
    confirmationPhrase: suppliedConfirmation,
  };
}

function isCommitOutcomeUnknown(err) {
  return Boolean(
    err?.reconciliationRequired === true
    || err?.commitOutcome === 'unknown'
    || err?.code === 'AUTHORITATIVE_PRUNE_COMMIT_OUTCOME_UNKNOWN'
  );
}

function errorRequiresConnectionDiscard(err) {
  return Boolean(
    err?.connectionMustBeDiscarded === true
    || err?.reconciliationRequired === true
    || err?.commitOutcome === 'unknown'
    || err?.rollbackOutcome === 'unknown'
  );
}

function safeOperatorInstruction() {
  return 'Do not repeat the destructive action with the old token. Run a read-only parity check, then generate and review a fresh prune preview before deciding whether another apply is needed.';
}

function nonDestructiveOperatorInstruction() {
  return 'Do not assume the write failed and do not retry it blindly. Run a read-only parity check first; only run safe upsert sync again if parity still requires it.';
}

function acknowledgedSyncOperatorInstruction() {
  return 'The safe sync commits were acknowledged. Do not rerun sync blindly. Run a read-only parity check first, and only sync again if parity still requires it.';
}

function terminateConnection(conn) {
  if (!conn) return;
  try {
    conn.destroy();
  } catch {
    // A connection selected for disposal must never be returned to the pool.
  }
}

function safeLogCollector() {
  const lines = [];
  return {
    lines,
    write(value) {
      if (lines.length >= MAX_LOG_LINES) return;
      const line = String(value || '').replaceAll(/[\r\n]+/g, ' ').slice(0, MAX_LOG_LINE_LENGTH);
      if (line) lines.push(line);
    },
  };
}

function safeJson(value) {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? String(item) : item);
}

function compactParity(report) {
  return {
    ok: Boolean(report?.ok),
    counts: report?.counts || null,
    checks: (report?.checks || []).map(check => ({
      name: String(check.name || ''),
      ok: Boolean(check.ok),
      details: String(check.details || ''),
    })),
  };
}

function compactImport(result) {
  if (!result) return null;
  return {
    scope: result.scope,
    universities: result.universities,
    regulations: result.regulations,
    branches: result.branches,
    subjects: result.subjects,
    colleges: result.colleges,
    branchProfiles: result.branchProfiles,
    guides: result.guides,
    sourcesTouched: result.sourcesTouched,
    lastCompletedPhase: result.lastCompletedPhase,
  };
}

function compactAuthoritativeKeyState(result) {
  if (!result) return null;
  return {
    ok: Boolean(result.ok),
    authoritativeContentDigest: result.authoritativeContentDigest || null,
    totals: result.totals || null,
    entities: (result.entities || []).map(entity => ({
      entityType: String(entity.entityType || ''),
      authoritativeCount: Number(entity.authoritativeCount || 0),
      currentCount: Number(entity.currentCount || 0),
      missingCount: Number(entity.missingCount || 0),
      unexpectedCount: Number(entity.unexpectedCount || 0),
      duplicateOrEmptyCount: Number(entity.duplicateOrEmptyCount || 0),
      ok: Boolean(entity.ok),
    })),
  };
}

export function databaseMirrorImportOptions(request, {
  actor = 'admin',
  pruneRequestId = null,
  queryTimeoutMs = DATABASE_MIRROR_QUERY_TIMEOUT_MS,
  logger = () => {},
} = {}) {
  if (!request || request.action === 'parity') return null;
  if (request.action === 'prune_preview') {
    return {
      pruneDryRun: true,
      queryTimeoutMs,
      logger,
    };
  }
  return {
    prune: request.destructive,
    pruneConfirmation: request.destructive ? request.confirmationPhrase : null,
    ...(request.destructive ? { pruneRequestId } : {}),
    pruneActor: actor,
    queryTimeoutMs,
    logger,
  };
}

async function writeMaintenanceAudit(conn, {
  actor,
  action,
  requestId,
  phase,
  details,
  queryTimeoutMs,
}) {
  await conn.execute({
    sql: `INSERT INTO audit_log
      (actor, action, entity_type, entity_id, before_json, after_json)
     VALUES (?, ?, 'database_mirror', ?, NULL, ?)`,
    timeout: queryTimeoutMs,
  }, [
    actor,
    `content_sync.database_mirror_${phase}`,
    requestId,
    safeJson({ action, ...details }),
  ]);
}

async function acquireDatabaseLock(conn, queryTimeoutMs) {
  const [rows] = await conn.query({
    sql: 'SELECT GET_LOCK(?, 0) AS acquired',
    timeout: queryTimeoutMs,
  }, [DATABASE_MIRROR_LOCK_NAME]);
  if (Number(rows?.[0]?.acquired) !== 1) {
    throw new DatabaseMirrorMaintenanceError(
      'MAINTENANCE_BUSY',
      'Another database mirror maintenance action is already running. Wait for it to finish and try again.',
      { httpStatus: 409 }
    );
  }
}

async function releaseDatabaseLock(conn, queryTimeoutMs) {
  const [rows] = await conn.query({
    sql: 'SELECT RELEASE_LOCK(?) AS released',
    timeout: queryTimeoutMs,
  }, [DATABASE_MIRROR_LOCK_NAME]);
  if (Number(rows?.[0]?.released) !== 1) {
    throw new Error('The database maintenance advisory lock was not released cleanly.');
  }
}

async function performMaintenance({
  conn,
  dependencies,
  root,
  actor,
  request,
  requestId,
  pruneRequestId,
  startedAt,
  queryTimeoutMs,
  logger,
  operationState,
}) {
  const dataDir = path.join(root, 'data');
  const sourceBefore = dependencies.getContentSource();
  operationState.publicContentSourceBefore = sourceBefore;
  let startAuditWritten = false;
  let importResult = null;

  await acquireDatabaseLock(conn, queryTimeoutMs);
  try {
    if (sourceBefore !== 'json') {
      throw new DatabaseMirrorMaintenanceError(
        'CONTENT_SOURCE_NOT_JSON',
        'Database mirror maintenance is disabled unless public serving remains configured as CONTENT_SOURCE=json.',
        { httpStatus: 409 }
      );
    }
    if (request.writesMirror) {
      await writeMaintenanceAudit(conn, {
        actor,
        action: request.action,
        requestId,
        phase: 'started',
        queryTimeoutMs,
        details: {
          started_at: startedAt,
          destructive: request.destructive,
          prune_request_id: pruneRequestId,
          public_content_source: sourceBefore,
        },
      });
      startAuditWritten = true;
      operationState.startAuditWritten = true;
    }

    const jsonContent = dependencies.loadJsonContent(dataDir);
    const importOptions = databaseMirrorImportOptions(request, {
      actor,
      pruneRequestId,
      queryTimeoutMs,
      logger: value => logger.write(value),
    });
    if (importOptions) {
      operationState.importStarted = true;
      importResult = await dependencies.importJsonContent(conn, dataDir, importOptions);
      operationState.importResult = importResult;
      if (request.writesMirror && !request.destructive) {
        operationState.safeSyncCommitAcknowledged = true;
      }
      if (request.destructive && importResult?.prune?.commitEvidence) {
        operationState.pruneCommitAcknowledged = true;
        operationState.prunePlanDigest = importResult.prune.planDigest;
        operationState.pruneConfirmationToken = importResult.prune.confirmationToken;
      }
    }

    const dbContent = await dependencies.exportDbContent(conn);
    const parity = compactParity(dependencies.parityReport(jsonContent, dbContent));
    operationState.parity = parity;
    const sourceAfter = dependencies.getContentSource();
    operationState.publicContentSourceAfter = sourceAfter;
    if (sourceAfter !== sourceBefore) {
      throw new DatabaseMirrorMaintenanceError(
        'CONTENT_SOURCE_CHANGED',
        'The public content source changed unexpectedly during maintenance. No further action was taken.',
        { httpStatus: 500 }
      );
    }

    const finishedAt = new Date().toISOString();
    const result = {
      requestId,
      pruneRequestId,
      action: request.action,
      readOnly: request.readOnly,
      destructive: request.destructive,
      ok: parity.ok,
      status: parity.ok ? 'passed' : 'attention',
      actor,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
      publicContentSourceBefore: sourceBefore,
      publicContentSourceAfter: sourceAfter,
      import: compactImport(importResult),
      prune: importResult?.prune || null,
      parity,
      logs: logger.lines,
      audit: request.writesMirror
        ? {
            persistent: true,
            requestId,
            ...(request.destructive ? {
              pruneRequestId,
              commitEvidenceAuditId: importResult?.prune?.commitEvidence?.auditId || null,
            } : {}),
          }
        : { persistent: false, reason: 'Read-only actions do not write audit rows.' },
    };

    if (request.writesMirror) {
      await writeMaintenanceAudit(conn, {
        actor,
        action: request.action,
        requestId,
        phase: 'completed',
        queryTimeoutMs,
        details: {
          finished_at: finishedAt,
          duration_ms: result.durationMs,
          parity_ok: parity.ok,
          counts: parity.counts,
          import: result.import,
          prune_totals: result.prune?.totals || null,
          public_content_source: sourceAfter,
        },
      });
      operationState.completedAuditWritten = true;
    }
    return result;
  } catch (err) {
    if (operationState.safeSyncCommitAcknowledged) {
      operationState.discardConnection = true;
    }
    if (errorRequiresConnectionDiscard(err)) {
      operationState.discardConnection = true;
    }
    const outcomeCouldBeCommitted = (
      operationState.forceOutcomeInconclusive
      || isCommitOutcomeUnknown(err)
      || operationState.pruneCommitAcknowledged
      || operationState.safeSyncCommitAcknowledged
    );
    if (
      request.writesMirror
      && startAuditWritten
      && !outcomeCouldBeCommitted
      && !operationState.discardConnection
    ) {
      try {
        await writeMaintenanceAudit(conn, {
          actor,
          action: request.action,
          requestId,
          phase: 'failed',
          queryTimeoutMs,
          details: {
            failed_at: new Date().toISOString(),
            error_code: err?.code || err?.name || 'ERROR',
            last_completed_phase: err?.lastCompletedPhase || null,
            public_content_source: dependencies.getContentSource(),
          },
        });
        operationState.failedAuditWritten = true;
      } catch {
        operationState.discardConnection = true;
      }
    }
    throw err;
  } finally {
    if (!operationState.discardConnection) {
      try {
        await releaseDatabaseLock(conn, queryTimeoutMs);
      } catch {
        operationState.discardConnection = true;
      }
    }
  }
}

function timeoutError({
  requestId,
  pruneRequestId,
  request,
  actor,
  startedAt,
  logger,
  timeoutMs,
  phase = 'maintenance',
}) {
  const finishedAt = new Date().toISOString();
  const instruction = request.destructive
    ? safeOperatorInstruction()
    : request.writesMirror
      ? nonDestructiveOperatorInstruction()
      : 'Reload System checks and run the read-only check again.';
  return new DatabaseMirrorMaintenanceError(
    'MAINTENANCE_OUTCOME_INCONCLUSIVE',
    `${phase === 'reconciliation' ? 'Database reconciliation' : 'Database mirror maintenance'} exceeded the ${Math.ceil(timeoutMs / 1000)}-second safety limit. The outcome is inconclusive. ${instruction}`,
    {
      httpStatus: 504,
      result: {
        requestId,
        pruneRequestId,
        action: request.action,
        readOnly: request.readOnly,
        destructive: request.destructive,
        ok: false,
        status: 'outcome_inconclusive',
        reasonCode: `${phase}_timeout`,
        actor,
        startedAt,
        finishedAt,
        durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
        logs: logger.lines,
        operatorInstruction: instruction,
        reconciliation: {
          attempted: phase === 'reconciliation',
          status: 'timed_out',
        },
        audit: request.writesMirror
          ? {
              persistent: null,
              requestId,
              note: 'A started audit may exist. No failed audit is written for an ambiguous timeout.',
            }
          : { persistent: false, reason: 'Read-only actions do not write audit rows.' },
      },
    }
  );
}

async function acquireConnectionWithDeadline(pool, remainingMs, timeoutContext) {
  let acquisitionTimedOut = false;
  let timer = null;
  const acquisition = pool.getConnection();
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      acquisitionTimedOut = true;
      reject(timeoutError(timeoutContext));
    }, remainingMs);
  });
  try {
    return await Promise.race([acquisition, timeout]);
  } finally {
    clearTimeout(timer);
    if (acquisitionTimedOut) {
      acquisition.then(conn => conn.release(), () => {});
    }
  }
}

function inconclusiveMaintenanceError({
  requestId,
  pruneRequestId,
  request,
  actor,
  startedAt,
  logger,
  reasonCode,
  reconciliationStatus,
  commitEvidenceFound = null,
  auditNote,
}) {
  const finishedAt = new Date().toISOString();
  return new DatabaseMirrorMaintenanceError(
    'MAINTENANCE_OUTCOME_INCONCLUSIVE',
    `The destructive prune outcome could not be proven safely. ${safeOperatorInstruction()}`,
    {
      httpStatus: 503,
      result: {
        requestId,
        pruneRequestId,
        action: request.action,
        readOnly: request.readOnly,
        destructive: request.destructive,
        ok: false,
        status: 'outcome_inconclusive',
        reasonCode,
        actor,
        startedAt,
        finishedAt,
        durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
        logs: logger.lines,
        operatorInstruction: safeOperatorInstruction(),
        reconciliation: {
          attempted: true,
          status: reconciliationStatus,
          commitEvidenceFound,
        },
        audit: {
          persistent: null,
          requestId,
          pruneRequestId,
          note: auditNote || 'A started audit may exist. No failed audit is written for an ambiguous outcome.',
        },
      },
    }
  );
}

function nonDestructiveInconclusiveError({
  requestId,
  request,
  actor,
  startedAt,
  logger,
  reasonCode,
}) {
  const finishedAt = new Date().toISOString();
  const instruction = request.writesMirror
    ? nonDestructiveOperatorInstruction()
    : 'Reload System checks and run the read-only check again.';
  return new DatabaseMirrorMaintenanceError(
    'MAINTENANCE_OUTCOME_INCONCLUSIVE',
    `The maintenance outcome could not be proven safely. ${instruction}`,
    {
      httpStatus: 503,
      result: {
        requestId,
        action: request.action,
        readOnly: request.readOnly,
        destructive: false,
        ok: false,
        status: 'outcome_inconclusive',
        reasonCode,
        actor,
        startedAt,
        finishedAt,
        durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
        logs: logger.lines,
        operatorInstruction: instruction,
        reconciliation: {
          attempted: false,
          status: 'not_available_for_non_destructive_phase',
        },
        audit: request.writesMirror
          ? {
              persistent: null,
              requestId,
              note: 'A started audit may exist. No failed audit is written for an ambiguous COMMIT acknowledgement.',
            }
          : { persistent: false, reason: 'Read-only actions do not write audit rows.' },
      },
    }
  );
}

function acknowledgedSyncPostcheckAttentionResult({
  requestId,
  request,
  actor,
  startedAt,
  logger,
  operationState,
  error,
}) {
  const finishedAt = new Date().toISOString();
  const summary = describeDbError(error);
  return {
    requestId,
    action: request.action,
    readOnly: false,
    destructive: false,
    ok: false,
    status: 'committed_with_postcheck_attention',
    reasonCode: 'acknowledged_sync_postcheck_failed',
    actor,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
    publicContentSourceBefore: operationState.publicContentSourceBefore,
    publicContentSourceAfter: operationState.publicContentSourceAfter,
    import: compactImport(operationState.importResult),
    parity: operationState.parity,
    logs: logger.lines,
    lastCompletedPhase: error?.lastCompletedPhase
      || operationState.importResult?.lastCompletedPhase
      || null,
    errorCode: summary.code || summary.name,
    operatorInstruction: acknowledgedSyncOperatorInstruction(),
    reconciliation: {
      attempted: false,
      status: 'not_required_commit_acknowledged',
    },
    audit: {
      persistent: operationState.startAuditWritten,
      requestId,
      completed: operationState.completedAuditWritten ? true : null,
      note: operationState.completedAuditWritten
        ? 'The safe sync commits and completion audit were acknowledged.'
        : 'The safe sync commits were acknowledged. The completion audit is absent or its acknowledgement is unknown; no failed audit was written.',
    },
  };
}

async function performDestructiveReconciliation({
  conn,
  dependencies,
  root,
  actor,
  request,
  requestId,
  pruneRequestId,
  prunePlanDigest,
  startedAt,
  queryTimeoutMs,
  logger,
  operationState,
  reconciliationState,
}) {
  await acquireDatabaseLock(conn, queryTimeoutMs);
  try {
    const evidence = await dependencies.findAuthoritativePruneCommitEvidence(conn, {
      requestId: pruneRequestId,
      planDigest: prunePlanDigest,
      confirmationToken: request.confirmationPhrase,
      queryTimeoutMs,
    });
    reconciliationState.evidence = evidence;

    if (!evidence.committed) {
      try {
        await writeMaintenanceAudit(conn, {
          actor,
          action: request.action,
          requestId,
          phase: 'reconciliation_inconclusive',
          queryTimeoutMs,
          details: {
            reconciled_at: new Date().toISOString(),
            prune_request_id: pruneRequestId,
            plan_digest: prunePlanDigest,
            commit_evidence_found: false,
            instruction: safeOperatorInstruction(),
          },
        });
      } catch {
        reconciliationState.discardConnection = true;
      }
      throw inconclusiveMaintenanceError({
        requestId,
        pruneRequestId,
        request,
        actor,
        startedAt,
        logger,
        reasonCode: 'commit_evidence_absent',
        reconciliationStatus: 'commit_evidence_absent',
        commitEvidenceFound: false,
        auditNote: 'The started audit and an inconclusive reconciliation audit may exist. No failed audit was written.',
      });
    }

    let keyState = null;
    let parity = null;
    let postcheckErrorCode = null;
    let sourceAfter = null;
    let contentDigestMatchesMarker = null;
    try {
      const jsonContent = dependencies.loadJsonContent(path.join(root, 'data'));
      keyState = compactAuthoritativeKeyState(
        await dependencies.verifyAuthoritativeMirrorKeyState(conn, jsonContent, {
          queryTimeoutMs,
        })
      );
      contentDigestMatchesMarker = Boolean(
        keyState?.authoritativeContentDigest
        && keyState.authoritativeContentDigest === evidence.evidence?.authoritative_content_digest
      );
      const dbContent = await dependencies.exportDbContent(conn);
      parity = compactParity(dependencies.parityReport(jsonContent, dbContent));
      sourceAfter = dependencies.getContentSource();
      if (sourceAfter !== 'json') {
        postcheckErrorCode = 'CONTENT_SOURCE_NOT_JSON';
      } else if (!contentDigestMatchesMarker) {
        postcheckErrorCode = 'AUTHORITATIVE_CONTENT_CHANGED_SINCE_COMMIT';
      }
    } catch (err) {
      postcheckErrorCode = describeDbError(err).code || err?.code || err?.name || 'POSTCHECK_FAILED';
      reconciliationState.discardConnection = true;
    }

    reconciliationState.keyState = keyState;
    reconciliationState.parity = parity;
    const postcheckVerified = Boolean(keyState?.ok) && Boolean(parity?.ok) && !postcheckErrorCode;
    const finishedAt = new Date().toISOString();
    const status = postcheckVerified
      ? 'committed_reconciled'
      : 'committed_with_postcheck_attention';
    const operatorInstruction = postcheckVerified
      ? 'The durable transaction marker, exact authoritative key state, and fresh parity check prove the destructive prune committed successfully. Do not repeat it.'
      : 'The durable transaction marker proves the prune committed. Do not reapply it. Run a fresh read-only parity check and investigate the exact-key or parity post-check result.';
    let reconciliationAuditWritten = false;
    if (!reconciliationState.discardConnection) {
      try {
        await writeMaintenanceAudit(conn, {
          actor,
          action: request.action,
          requestId,
          phase: postcheckVerified ? 'reconciled' : 'reconciled_attention',
          queryTimeoutMs,
          details: {
            reconciled_at: finishedAt,
            prune_request_id: pruneRequestId,
            plan_digest: prunePlanDigest,
            commit_evidence_audit_id: evidence.auditId,
            exact_key_state_ok: keyState?.ok ?? null,
            exact_key_state_totals: keyState?.totals || null,
            authoritative_content_digest_matches_marker: contentDigestMatchesMarker,
            parity_ok: parity?.ok ?? null,
            parity_counts: parity?.counts || null,
            postcheck_error_code: postcheckErrorCode,
            status,
          },
        });
        reconciliationAuditWritten = true;
      } catch {
        reconciliationState.discardConnection = true;
      }
    }

    return {
      requestId,
      pruneRequestId,
      action: request.action,
      readOnly: false,
      destructive: true,
      ok: postcheckVerified,
      status,
      actor,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
      publicContentSourceBefore: 'json',
      publicContentSourceAfter: sourceAfter,
      import: compactImport(operationState.importResult),
      prune: operationState.importResult?.prune || {
        requestId: pruneRequestId,
        planDigest: prunePlanDigest,
        confirmationToken: request.confirmationPhrase,
        totals: evidence.totals,
      },
      keyState,
      parity,
      logs: logger.lines,
      operatorInstruction,
      reconciliation: {
        attempted: true,
        status,
        commitEvidenceFound: true,
        commitEvidenceAuditId: evidence.auditId,
        planDigest: evidence.planDigest,
        exactKeyStateVerified: keyState?.ok ?? null,
        authoritativeContentDigestMatchesMarker: contentDigestMatchesMarker,
        postcheckErrorCode,
        auditWritten: reconciliationAuditWritten,
      },
      audit: {
        persistent: true,
        requestId,
        pruneRequestId,
        commitEvidenceAuditId: evidence.auditId,
        reconciliationAuditWritten,
        note: reconciliationAuditWritten
          ? 'Durable prune commit evidence and reconciliation audit are present.'
          : 'Durable prune commit evidence is present; the optional reconciliation audit could not be written.',
      },
    };
  } catch (err) {
    if (errorRequiresConnectionDiscard(err)) {
      reconciliationState.discardConnection = true;
    }
    throw err;
  } finally {
    if (!reconciliationState.discardConnection) {
      try {
        await releaseDatabaseLock(conn, queryTimeoutMs);
      } catch {
        reconciliationState.discardConnection = true;
      }
    }
  }
}

async function reconcileAmbiguousDestructivePrune({
  pool,
  dependencies,
  root,
  actor,
  request,
  requestId,
  pruneRequestId,
  prunePlanDigest,
  startedAt,
  logger,
  operationState,
  timeoutMs,
  minimumTimeoutMs,
}) {
  const effectiveTimeoutMs = boundedTimeout(timeoutMs, DATABASE_MIRROR_RECONCILIATION_TIMEOUT_MS, {
    minimum: minimumTimeoutMs,
    maximum: DATABASE_MIRROR_RECONCILIATION_TIMEOUT_MS,
  });
  const deadline = Date.now() + effectiveTimeoutMs;
  const queryTimeoutMs = Math.min(effectiveTimeoutMs, DATABASE_MIRROR_QUERY_TIMEOUT_MS);
  const timeoutContext = {
    requestId,
    pruneRequestId,
    request,
    actor,
    startedAt,
    logger,
    timeoutMs: effectiveTimeoutMs,
    phase: 'reconciliation',
  };
  const reconciliationState = {
    discardConnection: false,
    evidence: null,
  };
  let conn = null;
  let connectionTerminated = false;

  try {
    conn = await acquireConnectionWithDeadline(
      pool,
      Math.max(1, deadline - Date.now()),
      timeoutContext
    );
    let timer = null;
    const operation = performDestructiveReconciliation({
      conn,
      dependencies,
      root,
      actor,
      request,
      requestId,
      pruneRequestId,
      prunePlanDigest,
      startedAt,
      queryTimeoutMs,
      logger,
      operationState,
      reconciliationState,
    });
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reconciliationState.discardConnection = true;
        connectionTerminated = true;
        terminateConnection(conn);
        reject(timeoutError(timeoutContext));
      }, Math.max(1, deadline - Date.now()));
    });
    try {
      const result = await Promise.race([operation, timeout]);
      if (reconciliationState.discardConnection) {
        connectionTerminated = true;
        terminateConnection(conn);
      }
      return result;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    if (reconciliationState.discardConnection && !connectionTerminated) {
      connectionTerminated = true;
      terminateConnection(conn);
    }
    if (
      err instanceof DatabaseMirrorMaintenanceError
      && err.code === 'MAINTENANCE_OUTCOME_INCONCLUSIVE'
    ) {
      throw err;
    }
    if (err instanceof DatabaseMirrorMaintenanceError && err.code === 'MAINTENANCE_BUSY') {
      throw inconclusiveMaintenanceError({
        requestId,
        pruneRequestId,
        request,
        actor,
        startedAt,
        logger,
        reasonCode: 'reconciliation_lock_unavailable',
        reconciliationStatus: 'lock_unavailable',
        auditNote: 'A started audit may exist. The fresh reconciliation lock was unavailable, and no failed audit was written.',
      });
    }
    connectionTerminated = true;
    terminateConnection(conn);
    throw inconclusiveMaintenanceError({
      requestId,
      pruneRequestId,
      request,
      actor,
      startedAt,
      logger,
      reasonCode: 'reconciliation_unavailable',
      reconciliationStatus: 'unavailable',
      auditNote: 'A started audit may exist. Reconciliation was unavailable, and no failed audit was written.',
    });
  } finally {
    if (conn && !connectionTerminated) conn.release();
  }
}

export async function runDatabaseMirrorMaintenance({
  root,
  actor,
  action,
  confirmationPhrase,
  timeoutMs = DATABASE_MIRROR_TIMEOUT_MS,
  reconciliationTimeoutMs = DATABASE_MIRROR_RECONCILIATION_TIMEOUT_MS,
  _dependencies = {},
} = {}) {
  if (!root) {
    throw new DatabaseMirrorMaintenanceError('INVALID_ROOT', 'The application root is required.');
  }
  const request = normalizeDatabaseMirrorRequest({ action, confirmationPhrase });
  if (maintenanceInProgress) {
    throw new DatabaseMirrorMaintenanceError(
      'MAINTENANCE_BUSY',
      'Another database mirror maintenance action is already running. Wait for it to finish and try again.',
      { httpStatus: 409 }
    );
  }

  const dependencies = { ...DEFAULT_MAINTENANCE_DEPENDENCIES, ..._dependencies };
  const minimumTimeoutMs = Number.isFinite(Number(_dependencies.minimumTimeoutMs))
    ? Math.max(1, Number(_dependencies.minimumTimeoutMs))
    : 1_000;
  const effectiveTimeoutMs = boundedTimeout(timeoutMs, DATABASE_MIRROR_TIMEOUT_MS, {
    minimum: minimumTimeoutMs,
    maximum: DATABASE_MIRROR_TIMEOUT_MS,
  });
  const queryTimeoutMs = Math.min(DATABASE_MIRROR_QUERY_TIMEOUT_MS, effectiveTimeoutMs);
  const requestId = crypto.randomUUID();
  const pruneRequestId = request.destructive
    ? dependencies.createAuthoritativePruneRequestId()
    : null;
  const prunePlanDigest = request.destructive
    ? request.confirmationPhrase.split(':')[1]
    : null;
  const normalizedActor = String(actor || 'admin');
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + effectiveTimeoutMs;
  const logger = safeLogCollector();
  const timeoutContext = {
    requestId,
    pruneRequestId,
    request,
    actor: normalizedActor,
    startedAt,
    logger,
    timeoutMs: effectiveTimeoutMs,
  };
  const operationState = {
    forceOutcomeInconclusive: false,
    startAuditWritten: false,
    importStarted: false,
    importResult: null,
    safeSyncCommitAcknowledged: false,
    pruneCommitAcknowledged: false,
    prunePlanDigest,
    pruneConfirmationToken: request.confirmationPhrase || null,
    parity: null,
    publicContentSourceBefore: null,
    publicContentSourceAfter: null,
    completedAuditWritten: false,
    discardConnection: false,
    failedAuditWritten: false,
  };
  let conn = null;
  let connectionTerminated = false;
  maintenanceInProgress = true;

  try {
    const pool = await dependencies.getDbPool({ requireConfigured: true });
    conn = await acquireConnectionWithDeadline(
      pool,
      Math.max(1, deadline - Date.now()),
      timeoutContext
    );

    let timer = null;
    const operation = performMaintenance({
      conn,
      dependencies,
      root,
      actor: normalizedActor,
      request,
      requestId,
      pruneRequestId,
      startedAt,
      queryTimeoutMs,
      logger,
      operationState,
    });
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        operationState.forceOutcomeInconclusive = true;
        operationState.discardConnection = true;
        connectionTerminated = true;
        terminateConnection(conn);
        reject(timeoutError(timeoutContext));
      }, Math.max(1, deadline - Date.now()));
    });
    let primaryResult = null;
    let primaryError = null;
    try {
      primaryResult = await Promise.race([operation, timeout]);
    } catch (err) {
      primaryError = err;
    } finally {
      clearTimeout(timer);
    }

    if (operationState.discardConnection && !connectionTerminated) {
      connectionTerminated = true;
      terminateConnection(conn);
    }
    if (!primaryError) return primaryResult;

    const destructiveOutcomeNeedsReconciliation = request.destructive && (
      operationState.forceOutcomeInconclusive
      || isCommitOutcomeUnknown(primaryError)
      || operationState.pruneCommitAcknowledged
    );
    if (destructiveOutcomeNeedsReconciliation) {
      if (!connectionTerminated) {
        connectionTerminated = true;
        terminateConnection(conn);
      }
      return await reconcileAmbiguousDestructivePrune({
        pool,
        dependencies,
        root,
        actor: normalizedActor,
        request,
        requestId,
        pruneRequestId,
        prunePlanDigest: primaryError?.prunePlanDigest || operationState.prunePlanDigest,
        startedAt,
        logger,
        operationState,
        timeoutMs: reconciliationTimeoutMs,
        minimumTimeoutMs,
      });
    }

    if (!request.destructive && operationState.safeSyncCommitAcknowledged) {
      if (!connectionTerminated) {
        connectionTerminated = true;
        terminateConnection(conn);
      }
      return acknowledgedSyncPostcheckAttentionResult({
        requestId,
        request,
        actor: normalizedActor,
        startedAt,
        logger,
        operationState,
        error: primaryError,
      });
    }

    if (isCommitOutcomeUnknown(primaryError)) {
      if (!connectionTerminated) {
        connectionTerminated = true;
        terminateConnection(conn);
      }
      throw nonDestructiveInconclusiveError({
        requestId,
        request,
        actor: normalizedActor,
        startedAt,
        logger,
        reasonCode: 'commit_acknowledgement_unknown',
      });
    }

    if (primaryError instanceof DatabaseMirrorMaintenanceError) {
      throw primaryError;
    }
    connectionTerminated = true;
    terminateConnection(conn);
    const summary = describeDbError(primaryError);
    const finishedAt = new Date().toISOString();
    const result = {
      requestId,
      pruneRequestId,
      action: request.action,
      readOnly: request.readOnly,
      destructive: request.destructive,
      ok: false,
      status: 'failed',
      actor: normalizedActor,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
      logs: logger.lines,
      lastCompletedPhase: primaryError?.lastCompletedPhase || null,
      errorCode: summary.code || summary.name,
      audit: request.writesMirror
        ? {
            persistent: operationState.startAuditWritten,
            requestId,
            note: operationState.failedAuditWritten
              ? 'The operation failed before any ambiguous COMMIT; started and failed audits are present.'
              : operationState.startAuditWritten
                ? 'The operation failed before any ambiguous COMMIT. A started audit is present, but the unsafe connection was discarded before a failed audit could be written.'
                : 'The operation failed before its started audit was written.',
          }
        : { persistent: false, reason: 'Read-only actions do not write audit rows.' },
    };
    throw new DatabaseMirrorMaintenanceError(
      'MAINTENANCE_FAILED',
      'Database mirror maintenance failed. Review the safe result details and server logs before retrying.',
      { httpStatus: 503, cause: primaryError, result }
    );
  } catch (err) {
    if (err instanceof DatabaseMirrorMaintenanceError) throw err;
    connectionTerminated = true;
    terminateConnection(conn);
    const summary = describeDbError(err);
    throw new DatabaseMirrorMaintenanceError(
      'MAINTENANCE_FAILED',
      'Database mirror maintenance could not start safely. Review server logs before retrying.',
      {
        httpStatus: 503,
        cause: err,
        result: {
          requestId,
          pruneRequestId,
          action: request.action,
          readOnly: request.readOnly,
          destructive: request.destructive,
          ok: false,
          status: 'failed',
          actor: normalizedActor,
          startedAt,
          finishedAt: new Date().toISOString(),
          logs: logger.lines,
          errorCode: summary.code || summary.name,
        },
      }
    );
  } finally {
    if (conn && !connectionTerminated) conn.release();
    maintenanceInProgress = false;
  }
}

export function databaseMirrorMaintenanceErrorSummary(err) {
  if (err instanceof DatabaseMirrorMaintenanceError) return err.publicMessage;
  const summary = describeDbError(err);
  const known = {
    ER_ACCESS_DENIED_ERROR: 'The server database credentials were rejected.',
    ECONNREFUSED: 'The database server refused the connection.',
    ENOTFOUND: 'The configured database host could not be resolved.',
    ETIMEDOUT: 'The database connection timed out.',
  };
  return known[summary.code]
    || 'Database mirror maintenance failed. Review server logs before retrying.';
}
