import assert from 'node:assert/strict';
import { buildContentFreshness } from '../lib/content-freshness.js';
import { createStructuredDiff } from '../lib/diff-engine.js';
import { validateProposalPayload } from '../lib/proposal-validation.js';
import { proposalActionAllowed } from '../lib/proposals.js';
import { releaseArtifactsMutable } from '../lib/release-candidates.js';
import express from 'express';
import {
  adminCookieName,
  createAdminCookie,
  createAdminCsrfToken,
  verifyAdminCsrfToken,
} from '../lib/admin-auth.js';
import {
  DATABASE_MIRROR_CSRF_ACTION,
  DATABASE_MIRROR_PRUNE_CONFIRMATION,
  databaseMirrorImportOptions,
  normalizeDatabaseMirrorRequest,
  runDatabaseMirrorMaintenance,
} from '../lib/admin-database-maintenance.js';
import {
  adminMutationIsSameOrigin,
  boundedAdminChecksForResult,
  createAdminRouter,
} from '../routes/admin.js';
import {
  renderAdminChecksPage,
  renderAssetDetailPage,
  renderContentIntakePage,
  renderDashboard,
  renderFreshnessPage,
  renderGuidedProcessingPage,
  renderParseResultDetailPage,
  renderProposalCreatePage,
  renderProposalDetailPage,
  renderReviewQueuePage,
  renderReleaseApplyPlanDetailPage,
  renderReleaseCandidateDetailPage,
} from '../templates/admin.js';

const subjects = [
  {
    id: 'current-subject',
    name: 'Current Subject',
    branch: 'CSE',
    year_sem_label: '3-1',
    source: {
      status: 'verified',
      origin_url: 'https://jntuk.edu.in/current.pdf',
      retrieved_date: '2026-07-01',
    },
  },
  {
    id: 'due-subject',
    name: 'Due Subject',
    branch: 'ECE',
    year_sem_label: '2-2',
    source: {
      status: 'verified',
      origin_url: 'https://jntuk.edu.in/older.pdf',
      retrieved_date: '2025-01-01',
    },
  },
  {
    id: 'missing-source',
    name: 'Missing Source',
    branch: 'CSE',
    year_sem_label: '3-2',
    source: { status: 'needs_verification' },
  },
];

const freshness = buildContentFreshness(subjects, {
  now: new Date('2026-07-12T00:00:00Z'),
  reviewDays: 180,
});
assert.equal(freshness.totalSources, 3);
assert.equal(freshness.current, 1);
assert.equal(freshness.due, 1);
assert.equal(freshness.missing, 1);
assert.equal(proposalActionAllowed('needs_review', 'approve_for_draft'), true);
assert.equal(proposalActionAllowed('approved_for_draft', 'approve_for_draft'), false);
assert.equal(proposalActionAllowed('applied', 'reject'), false);
assert.equal(releaseArtifactsMutable('draft'), true);
assert.equal(releaseArtifactsMutable('ready_for_review'), false);

function adminRequest({ method = 'POST', protocol = 'https', headers = {} } = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
  return {
    method,
    protocol,
    get(name) {
      return normalizedHeaders[String(name).toLowerCase()];
    },
  };
}

assert.equal(adminMutationIsSameOrigin(adminRequest({ method: 'GET' }), { nodeEnv: 'production' }), true);
assert.equal(adminMutationIsSameOrigin(adminRequest({
  headers: { host: 'admin.example.com', origin: 'https://admin.example.com' },
}), { nodeEnv: 'production' }), true);
assert.equal(adminMutationIsSameOrigin(adminRequest({
  headers: { host: 'admin.example.com', origin: 'https://attacker.example' },
}), { nodeEnv: 'production' }), false);
assert.equal(adminMutationIsSameOrigin(adminRequest({
  headers: { host: 'admin.example.com', origin: 'https://admin.example.com/untrusted-path' },
}), { nodeEnv: 'production' }), false);
assert.equal(adminMutationIsSameOrigin(adminRequest({
  headers: { host: 'admin.example.com', origin: 'not a URL' },
}), { nodeEnv: 'production' }), false);
assert.equal(adminMutationIsSameOrigin(adminRequest({
  headers: { host: 'admin.example.com', 'sec-fetch-site': 'same-origin' },
}), { nodeEnv: 'production' }), true);
assert.equal(adminMutationIsSameOrigin(adminRequest({
  headers: { host: 'admin.example.com', 'sec-fetch-site': 'cross-site' },
}), { nodeEnv: 'production' }), false);
assert.equal(adminMutationIsSameOrigin(adminRequest()), false);

const adminAuthConfig = {
  enabled: true,
  email: 'admin@example.com',
  passwordHash: `sha256:${'0'.repeat(64)}`,
  password: '',
  sessionSecret: 'test-only-admin-session-secret-with-enough-entropy',
};
const adminCookie = createAdminCookie(adminAuthConfig.email, adminAuthConfig);
const maintenanceCsrf = createAdminCsrfToken(
  adminCookie,
  DATABASE_MIRROR_CSRF_ACTION,
  adminAuthConfig
);
assert.ok(maintenanceCsrf);
assert.equal(verifyAdminCsrfToken(
  maintenanceCsrf,
  adminCookie,
  DATABASE_MIRROR_CSRF_ACTION,
  adminAuthConfig
), true);
assert.equal(verifyAdminCsrfToken(
  maintenanceCsrf,
  adminCookie,
  'different.action',
  adminAuthConfig
), false);
assert.equal(verifyAdminCsrfToken(
  'invalid-token',
  adminCookie,
  DATABASE_MIRROR_CSRF_ACTION,
  adminAuthConfig
), false);

assert.deepEqual(normalizeDatabaseMirrorRequest(), {
  action: 'parity',
  readOnly: true,
  writesMirror: false,
  destructive: false,
  confirmationPhrase: '',
});
assert.equal(normalizeDatabaseMirrorRequest({ action: 'sync' }).destructive, false);
assert.equal(normalizeDatabaseMirrorRequest({ action: 'prune_preview' }).readOnly, true);
assert.throws(
  () => normalizeDatabaseMirrorRequest({ action: 'sync_prune' }),
  /exact plan-bound confirmation token/
);
assert.throws(
  () => normalizeDatabaseMirrorRequest({ action: 'parity', confirmationPhrase: DATABASE_MIRROR_PRUNE_CONFIRMATION }),
  /only be submitted/
);
assert.throws(
  () => normalizeDatabaseMirrorRequest({
    action: 'sync_prune',
    confirmationPhrase: DATABASE_MIRROR_PRUNE_CONFIRMATION,
  }),
  /prefix alone cannot authorize deletion/
);
const planBoundPruneConfirmation = `${DATABASE_MIRROR_PRUNE_CONFIRMATION}:${'a'.repeat(64)}`;
assert.equal(normalizeDatabaseMirrorRequest({
  action: 'sync_prune',
  confirmationPhrase: planBoundPruneConfirmation,
}).destructive, true);
assert.equal(databaseMirrorImportOptions(normalizeDatabaseMirrorRequest()), null);
assert.deepEqual(
  databaseMirrorImportOptions(normalizeDatabaseMirrorRequest({ action: 'prune_preview' }), {
    queryTimeoutMs: 1234,
    logger: 'test-logger',
  }),
  {
    pruneDryRun: true,
    queryTimeoutMs: 1234,
    logger: 'test-logger',
  }
);
assert.deepEqual(
  databaseMirrorImportOptions(normalizeDatabaseMirrorRequest({ action: 'sync' }), {
    actor: 'admin@example.com',
    queryTimeoutMs: 1234,
    logger: 'test-logger',
  }),
  {
    prune: false,
    pruneConfirmation: null,
    pruneActor: 'admin@example.com',
    queryTimeoutMs: 1234,
    logger: 'test-logger',
  }
);
const destructiveImportOptions = databaseMirrorImportOptions(normalizeDatabaseMirrorRequest({
  action: 'sync_prune',
  confirmationPhrase: planBoundPruneConfirmation,
}), { pruneRequestId: '11111111-1111-4111-8111-111111111111' });
assert.equal(destructiveImportOptions.pruneConfirmation, planBoundPruneConfirmation);
assert.equal(destructiveImportOptions.pruneRequestId, '11111111-1111-4111-8111-111111111111');

const boundedChecksStarted = Date.now();
const boundedChecks = await boundedAdminChecksForResult({
  loadChecks: () => new Promise(() => {}),
  fallback: reason => ({ fallback: true, reason }),
  timeoutMs: 5,
});
assert.deepEqual(boundedChecks.checks, { fallback: true, reason: 'timeout' });
assert.match(boundedChecks.notice, /maintenance result below is preserved/);
assert.ok(Date.now() - boundedChecksStarted < 250);

class FakeMaintenanceConnection {
  constructor(name) {
    this.name = name;
    this.auditActions = [];
    this.destroyed = false;
    this.released = false;
  }

  async query(statement) {
    const sql = typeof statement === 'string' ? statement : statement?.sql || '';
    if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
    if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
    throw new Error(`Unexpected fake query on ${this.name}: ${sql}`);
  }

  async execute(_statement, values) {
    this.auditActions.push(String(values?.[1] || ''));
    return [{ affectedRows: 1 }];
  }

  destroy() {
    this.destroyed = true;
  }

  release() {
    this.released = true;
  }
}

const reconciliationPruneRequestId = '22222222-2222-4222-8222-222222222222';
const reconciliationPlanDigest = 'a'.repeat(64);
const reconciliationConfirmation =
  `${DATABASE_MIRROR_PRUNE_CONFIRMATION}:${reconciliationPlanDigest}`;
const exactKeyState = {
  ok: true,
  authoritativeContentDigest: 'b'.repeat(64),
  entities: [{
    entityType: 'subject',
    authoritativeCount: 436,
    currentCount: 436,
    missingCount: 0,
    unexpectedCount: 0,
    duplicateOrEmptyCount: 0,
    ok: true,
  }],
  totals: {
    authoritative: 819,
    current: 819,
    missing: 0,
    unexpected: 0,
    duplicateOrEmpty: 0,
  },
};
const reconciledParity = {
  ok: true,
  counts: { subjects: 436, colleges: 376, branchProfiles: 6, guides: 1 },
  checks: [],
};

function ambiguousPruneCommitError() {
  const err = new Error('COMMIT acknowledgement lost');
  err.code = 'AUTHORITATIVE_PRUNE_COMMIT_OUTCOME_UNKNOWN';
  err.reconciliationRequired = true;
  err.commitOutcome = 'unknown';
  err.pruneRequestId = reconciliationPruneRequestId;
  err.prunePlanDigest = reconciliationPlanDigest;
  err.pruneConfirmationToken = reconciliationConfirmation;
  return err;
}

function committedPruneEvidence() {
  return {
    committed: true,
    requestId: reconciliationPruneRequestId,
    auditId: 77,
    actor: 'admin@example.com',
    createdAt: '2026-07-26T00:00:00Z',
    planDigest: reconciliationPlanDigest,
    confirmationToken: reconciliationConfirmation,
    totals: { deleted: 2 },
    evidence: {
      request_id: reconciliationPruneRequestId,
      plan_digest: reconciliationPlanDigest,
      authoritative_content_digest: exactKeyState.authoritativeContentDigest,
    },
  };
}

function fakeMaintenanceDependencies({
  importJsonContent,
  findEvidence = async () => committedPruneEvidence(),
  verifyKeyState = async () => exactKeyState,
  exportDbContent = async () => ({ mirror: true }),
  parityReport = () => reconciledParity,
} = {}) {
  const primary = new FakeMaintenanceConnection('primary');
  const reconciliation = new FakeMaintenanceConnection('reconciliation');
  const connections = [primary, reconciliation];
  const importedOptions = [];
  return {
    primary,
    reconciliation,
    importedOptions,
    dependencies: {
      minimumTimeoutMs: 1,
      createAuthoritativePruneRequestId: () => reconciliationPruneRequestId,
      getContentSource: () => 'json',
      getDbPool: async () => ({
        async getConnection() {
          const conn = connections.shift();
          if (!conn) throw new Error('No fake maintenance connection remains');
          return conn;
        },
      }),
      loadJsonContent: () => ({ authoritative: true }),
      importJsonContent: async (_conn, _dataDir, options) => {
        importedOptions.push(options);
        return importJsonContent(_conn, _dataDir, options);
      },
      findAuthoritativePruneCommitEvidence: findEvidence,
      verifyAuthoritativeMirrorKeyState: verifyKeyState,
      exportDbContent,
      parityReport,
    },
  };
}

function failedMaintenanceAuditWritten(...connections) {
  return connections
    .flatMap(conn => conn.auditActions)
    .some(action => action.endsWith('_failed'));
}

{
  const fixture = fakeMaintenanceDependencies({
    importJsonContent: async () => {
      throw ambiguousPruneCommitError();
    },
  });
  const result = await runDatabaseMirrorMaintenance({
    root: process.cwd(),
    actor: 'admin@example.com',
    action: 'sync_prune',
    confirmationPhrase: reconciliationConfirmation,
    timeoutMs: 100,
    reconciliationTimeoutMs: 100,
    _dependencies: fixture.dependencies,
  });
  assert.equal(result.status, 'committed_reconciled');
  assert.equal(result.reconciliation.commitEvidenceFound, true);
  assert.equal(result.reconciliation.exactKeyStateVerified, true);
  assert.equal(result.reconciliation.authoritativeContentDigestMatchesMarker, true);
  assert.equal(fixture.importedOptions[0].pruneRequestId, reconciliationPruneRequestId);
  assert.equal(fixture.primary.destroyed, true);
  assert.equal(fixture.primary.released, false);
  assert.equal(fixture.reconciliation.released, true);
  assert.equal(failedMaintenanceAuditWritten(fixture.primary, fixture.reconciliation), false);
  assert.ok(fixture.primary.auditActions.includes('content_sync.database_mirror_started'));
  assert.ok(fixture.reconciliation.auditActions.includes('content_sync.database_mirror_reconciled'));
}

{
  const fixture = fakeMaintenanceDependencies({
    importJsonContent: async () => {
      throw ambiguousPruneCommitError();
    },
    findEvidence: async () => ({
      committed: false,
      requestId: reconciliationPruneRequestId,
    }),
  });
  let outcome;
  try {
    await runDatabaseMirrorMaintenance({
      root: process.cwd(),
      actor: 'admin@example.com',
      action: 'sync_prune',
      confirmationPhrase: reconciliationConfirmation,
      timeoutMs: 100,
      reconciliationTimeoutMs: 100,
      _dependencies: fixture.dependencies,
    });
    assert.fail('Expected missing commit evidence to remain inconclusive');
  } catch (err) {
    outcome = err.result;
  }
  assert.equal(outcome.status, 'outcome_inconclusive');
  assert.equal(outcome.reconciliation.commitEvidenceFound, false);
  assert.match(outcome.operatorInstruction, /old token/);
  assert.equal(failedMaintenanceAuditWritten(fixture.primary, fixture.reconciliation), false);
  assert.ok(
    fixture.reconciliation.auditActions
      .includes('content_sync.database_mirror_reconciliation_inconclusive')
  );
}

{
  const fixture = fakeMaintenanceDependencies({
    importJsonContent: async () => {
      throw ambiguousPruneCommitError();
    },
  });
  fixture.reconciliation.query = async statement => {
    const sql = typeof statement === 'string' ? statement : statement?.sql || '';
    if (sql.includes('GET_LOCK')) return [[{ acquired: 0 }]];
    throw new Error(`Unexpected reconciliation-lock query: ${sql}`);
  };
  let outcome;
  try {
    await runDatabaseMirrorMaintenance({
      root: process.cwd(),
      actor: 'admin@example.com',
      action: 'sync_prune',
      confirmationPhrase: reconciliationConfirmation,
      timeoutMs: 100,
      reconciliationTimeoutMs: 100,
      _dependencies: fixture.dependencies,
    });
    assert.fail('Expected an unavailable reconciliation lock to remain inconclusive');
  } catch (err) {
    outcome = err.result;
  }
  assert.equal(outcome.status, 'outcome_inconclusive');
  assert.equal(outcome.reconciliation.status, 'lock_unavailable');
  assert.match(outcome.operatorInstruction, /old token/);
  assert.equal(fixture.reconciliation.released, true);
  assert.equal(failedMaintenanceAuditWritten(fixture.primary, fixture.reconciliation), false);
}

{
  let exportAttempts = 0;
  const fixture = fakeMaintenanceDependencies({
    importJsonContent: async () => ({
      scope: 'full',
      prune: {
        requestId: reconciliationPruneRequestId,
        planDigest: reconciliationPlanDigest,
        confirmationToken: reconciliationConfirmation,
        totals: { deleted: 2 },
        commitEvidence: { request_id: reconciliationPruneRequestId },
      },
    }),
    exportDbContent: async () => {
      exportAttempts += 1;
      if (exportAttempts === 1) {
        const err = new Error('Connection lost after acknowledged prune COMMIT');
        err.code = 'ECONNRESET';
        throw err;
      }
      return { mirror: true };
    },
  });
  const result = await runDatabaseMirrorMaintenance({
    root: process.cwd(),
    actor: 'admin@example.com',
    action: 'sync_prune',
    confirmationPhrase: reconciliationConfirmation,
    timeoutMs: 100,
    reconciliationTimeoutMs: 100,
    _dependencies: fixture.dependencies,
  });
  assert.equal(result.status, 'committed_reconciled');
  assert.equal(exportAttempts, 2);
  assert.equal(fixture.primary.destroyed, true);
  assert.equal(failedMaintenanceAuditWritten(fixture.primary, fixture.reconciliation), false);
}

{
  const fixture = fakeMaintenanceDependencies({
    importJsonContent: async () => {
      throw ambiguousPruneCommitError();
    },
    findEvidence: async () => {
      const evidence = committedPruneEvidence();
      evidence.evidence.authoritative_content_digest = 'c'.repeat(64);
      return evidence;
    },
  });
  const result = await runDatabaseMirrorMaintenance({
    root: process.cwd(),
    actor: 'admin@example.com',
    action: 'sync_prune',
    confirmationPhrase: reconciliationConfirmation,
    timeoutMs: 100,
    reconciliationTimeoutMs: 100,
    _dependencies: fixture.dependencies,
  });
  assert.equal(result.status, 'committed_with_postcheck_attention');
  assert.equal(result.reconciliation.authoritativeContentDigestMatchesMarker, false);
  assert.equal(
    result.reconciliation.postcheckErrorCode,
    'AUTHORITATIVE_CONTENT_CHANGED_SINCE_COMMIT'
  );
  assert.equal(failedMaintenanceAuditWritten(fixture.primary, fixture.reconciliation), false);
}

{
  const fixture = fakeMaintenanceDependencies({
    importJsonContent: async () => ({
      scope: 'full',
      prune: {
        requestId: reconciliationPruneRequestId,
        planDigest: reconciliationPlanDigest,
        confirmationToken: reconciliationConfirmation,
        totals: { deleted: 2 },
        commitEvidence: { request_id: reconciliationPruneRequestId },
      },
    }),
  });
  fixture.primary.execute = async (_statement, values) => {
    const action = String(values?.[1] || '');
    fixture.primary.auditActions.push(action);
    if (action.endsWith('_completed')) {
      const err = new Error('Completed audit acknowledgement lost');
      err.code = 'ECONNRESET';
      throw err;
    }
    return [{ affectedRows: 1 }];
  };
  const result = await runDatabaseMirrorMaintenance({
    root: process.cwd(),
    actor: 'admin@example.com',
    action: 'sync_prune',
    confirmationPhrase: reconciliationConfirmation,
    timeoutMs: 100,
    reconciliationTimeoutMs: 100,
    _dependencies: fixture.dependencies,
  });
  assert.equal(result.status, 'committed_reconciled');
  assert.equal(fixture.primary.destroyed, true);
  assert.equal(failedMaintenanceAuditWritten(fixture.primary, fixture.reconciliation), false);
}

{
  const fixture = fakeMaintenanceDependencies({
    importJsonContent: () => new Promise(() => {}),
  });
  const result = await runDatabaseMirrorMaintenance({
    root: process.cwd(),
    actor: 'admin@example.com',
    action: 'sync_prune',
    confirmationPhrase: reconciliationConfirmation,
    timeoutMs: 8,
    reconciliationTimeoutMs: 100,
    _dependencies: fixture.dependencies,
  });
  assert.equal(result.status, 'committed_reconciled');
  assert.equal(fixture.primary.destroyed, true);
  assert.equal(failedMaintenanceAuditWritten(fixture.primary, fixture.reconciliation), false);
}

{
  const fixture = fakeMaintenanceDependencies({
    importJsonContent: async () => {
      throw ambiguousPruneCommitError();
    },
    verifyKeyState: async () => ({
      ...exactKeyState,
      ok: false,
      totals: { ...exactKeyState.totals, missing: 1 },
      entities: [{ ...exactKeyState.entities[0], ok: false, missingCount: 1 }],
    }),
  });
  const result = await runDatabaseMirrorMaintenance({
    root: process.cwd(),
    actor: 'admin@example.com',
    action: 'sync_prune',
    confirmationPhrase: reconciliationConfirmation,
    timeoutMs: 100,
    reconciliationTimeoutMs: 100,
    _dependencies: fixture.dependencies,
  });
  assert.equal(result.status, 'committed_with_postcheck_attention');
  assert.equal(result.reconciliation.exactKeyStateVerified, false);
  assert.match(result.operatorInstruction, /Do not reapply/);
  assert.equal(failedMaintenanceAuditWritten(fixture.primary, fixture.reconciliation), false);
}

{
  const fixture = fakeMaintenanceDependencies({
    importJsonContent: async () => {
      const err = new Error('START TRANSACTION acknowledgement lost');
      err.code = 'TRANSACTION_START_OUTCOME_UNKNOWN';
      err.connectionMustBeDiscarded = true;
      err.operationStarted = false;
      throw err;
    },
  });
  let outcome;
  try {
    await runDatabaseMirrorMaintenance({
      root: process.cwd(),
      actor: 'admin@example.com',
      action: 'sync',
      timeoutMs: 100,
      _dependencies: fixture.dependencies,
    });
    assert.fail('Expected an unacknowledged transaction start to fail safely');
  } catch (err) {
    outcome = err.result;
  }
  assert.equal(outcome.status, 'failed');
  assert.equal(fixture.primary.destroyed, true);
  assert.equal(fixture.primary.released, false);
  assert.equal(failedMaintenanceAuditWritten(fixture.primary), false);
  assert.match(outcome.audit.note, /unsafe connection was discarded/);
}

{
  const fixture = fakeMaintenanceDependencies({
    importJsonContent: async () => ({
      scope: 'full',
      subjects: 436,
      colleges: 376,
      branchProfiles: 6,
      guides: 1,
      lastCompletedPhase: 'guides',
    }),
  });
  fixture.primary.execute = async (_statement, values) => {
    const action = String(values?.[1] || '');
    fixture.primary.auditActions.push(action);
    if (action.endsWith('_completed')) {
      const err = new Error('Safe-sync completion audit failed after acknowledged imports');
      err.code = 'ECONNRESET';
      throw err;
    }
    return [{ affectedRows: 1 }];
  };
  const result = await runDatabaseMirrorMaintenance({
    root: process.cwd(),
    actor: 'admin@example.com',
    action: 'sync',
    timeoutMs: 100,
    _dependencies: fixture.dependencies,
  });
  assert.equal(result.status, 'committed_with_postcheck_attention');
  assert.equal(result.reasonCode, 'acknowledged_sync_postcheck_failed');
  assert.equal(result.reconciliation.status, 'not_required_commit_acknowledged');
  assert.match(result.operatorInstruction, /commits were acknowledged/);
  assert.match(result.audit.note, /no failed audit was written/);
  assert.equal(fixture.primary.destroyed, true);
  assert.equal(fixture.primary.released, false);
  assert.equal(fixture.reconciliation.released, false);
  assert.equal(failedMaintenanceAuditWritten(fixture.primary), false);
}

const dashboard = renderDashboard({
  contentSource: 'json',
  counts: {
    subjectsTotal: 436,
    subjectsVerified: 436,
    subjectsNeedsVerification: 0,
    subjectsPlaceholder: 0,
    collegesTotal: 376,
    branchProfilesTotal: 6,
  },
  freshness,
  workflow: {
    available: true,
    proposalsNeedingReview: 2,
    approvedProposals: 1,
    pipelineFailures: 1,
    activeReleases: 1,
    pendingPush: 0,
    commitFailed: 0,
  },
});
assert.match(dashboard, /Keep every page grounded in a source/);
assert.match(dashboard, /class="proof-rail"/);
assert.match(dashboard, /Start an update/);
assert.match(dashboard, /<summary>Advanced<\/summary>/);
assert.doesNotMatch(dashboard, /--muted:var\(--muted\)/);

const sources = [{
  id: 7,
  enabled: true,
  name: 'Official JNTUK',
  sourceKey: 'jntuk',
  baseUrl: 'https://jntuk.edu.in/',
}];
const intake = renderContentIntakePage({ sources });
assert.match(intake, /action="\/admin\/content\/new\/fetch"/);
assert.match(intake, /action="\/admin\/assets\/new\?guided=1"/);
assert.match(intake, /Nothing publishes automatically/);

const guided = renderGuidedProcessingPage({
  asset: {
    id: 11,
    originalFilename: 'r23.pdf',
    discoverySourceName: 'Official JNTUK',
    sourceUrl: 'https://jntuk.edu.in/r23.pdf',
    fileSize: 1024,
    sha256Checksum: '1234567890abcdef1234567890abcdef',
  },
  fileStatus: { status: 'present' },
  parsers: [{ key: 'pdf-text-basic', label: 'PDF reader', suggested: true, available: true }],
});
assert.match(guided, /Run safe automation/);
assert.match(guided, /name="create_proposal" value="1" checked/);
assert.match(guided, /never approves, verifies or publishes/);

const review = renderReviewQueuePage({
  drafts: subjects.filter(subject => subject.source.status === 'needs_verification'),
  totalDrafts: 1,
  proposals: [{ id: 3, entityType: 'subject', entityKey: 'new-subject', status: 'needs_review', validationStatus: 'passed' }],
});
assert.match(review, /Decisions, not pipeline artifacts/);
assert.match(review, /\/admin\/verification-reviews\/missing-source/);
assert.match(review, /\/admin\/proposals\/3/);

const freshnessPage = renderFreshnessPage({ freshness });
assert.match(freshnessPage, /review reminder, not a claim/);
assert.match(freshnessPage, /Review source/);

const checks = renderAdminChecksPage({
  checks: {
    generatedAt: '2026-07-12T00:00:00Z',
    runtime: { nodeVersion: 'v24', contentSource: 'json', contentPublicationMode: 'github_pr', adminEnabled: true, adminConfigured: true, askEnabled: false },
    db: { configured: true, skipped: false, connected: true, ok: true, expectedMigrations: 26, appliedMigrations: 26, pendingMigrations: [], message: 'ok' },
    storage: {
      ok: true,
      configured: true,
      provider: 'r2',
      publicationReady: true,
      persistenceStatus: 'configured',
      persistenceVerified: true,
      message: 'private R2 adapter configured',
    },
    content: { source: 'json', subjectsTotal: 436, subjectsVerified: 436, subjectPages: 403, subjectListings: 33, subjectsNeedsVerification: 0, subjectsPlaceholder: 0, collegesTotal: 376, branchProfilesTotal: 6, guidesTotal: 1 },
    searchIndex: { ok: true, total: 786, byType: { subject: 403, college: 376, branch_profile: 6, guide: 1 }, path: '/dist/search-index.json' },
  },
});
assert.doesNotMatch(checks, /needs attention/);
assert.doesNotMatch(checks, /619/);
assert.match(checks, /github_pr/);
assert.match(checks, /private R2 adapter configured/);
assert.match(checks, /Publication ready/);
assert.match(checks, /Survived a commit-changing deploy/);

const maintenanceChecks = renderAdminChecksPage({
  checks: {
    generatedAt: '2026-07-26T00:00:00Z',
    runtime: { nodeVersion: 'v24', contentSource: 'json', contentPublicationMode: 'github_pr', adminEnabled: true, adminConfigured: true, askEnabled: false },
    db: { configured: true, skipped: false, connected: true, ok: true, expectedMigrations: 26, appliedMigrations: 26, pendingMigrations: [], message: 'ok' },
    storage: {
      ok: true,
      configured: true,
      provider: 'local',
      publicationReady: true,
      persistenceStatus: 'verified',
      persistenceVerified: true,
      message: 'ok',
    },
    content: { source: 'json', subjectsTotal: 436, subjectsVerified: 436, subjectPages: 403, subjectListings: 33, subjectsNeedsVerification: 0, subjectsPlaceholder: 0, collegesTotal: 376, branchProfilesTotal: 6, guidesTotal: 1 },
    searchIndex: { ok: true, total: 786, byType: { subject: 403, college: 376, branch_profile: 6, guide: 1 }, path: '/dist/search-index.json' },
  },
  csrfToken: 'csrf<&token',
  pruneConfirmationPhrase: DATABASE_MIRROR_PRUNE_CONFIRMATION,
  maintenance: {
    requestId: 'request-123',
    action: 'prune_preview',
    readOnly: true,
    destructive: false,
    ok: true,
    status: 'passed',
    startedAt: '2026-07-26T00:00:00Z',
    finishedAt: '2026-07-26T00:00:01Z',
    publicContentSourceBefore: 'json',
    publicContentSourceAfter: 'json',
    prune: {
      confirmationToken: planBoundPruneConfirmation,
      entities: [{
        entityType: 'subject',
        authoritativeCount: 436,
        currentCount: 438,
        obsoleteCount: 52,
        missingCount: 52,
        deletedCount: 0,
        obsoleteKeys: Array.from({ length: 52 }, (_, index) => `obsolete-${index + 1}`),
        missingKeys: Array.from({ length: 52 }, (_, index) => `missing-${index + 1}`),
        referenceBlockers: [{
          referencingTable: '<proposal_rows>',
          referencingColumn: '<subject_id>',
          count: 52,
          referencingIds: Array.from({ length: 52 }, (_, index) => `blocked-${index + 1}`),
        }],
      }],
    },
    parity: { checks: [{ name: '<subject count>', ok: true, details: '436' }] },
    logs: ['safe <log>'],
    audit: { persistent: false, reason: 'Read-only actions do not write audit rows.' },
  },
});
assert.match(maintenanceChecks, /action="\/admin\/checks\/database-mirror"/);
assert.match(maintenanceChecks, /name="csrf_token" value="csrf&lt;&amp;token"/);
assert.match(maintenanceChecks, /value="parity" selected/);
assert.match(maintenanceChecks, /DELETE_OBSOLETE_MIRROR_RECORDS/);
assert.match(maintenanceChecks, new RegExp(planBoundPruneConfirmation));
assert.match(maintenanceChecks, /Confirmation token for this exact deletion plan/);
assert.match(maintenanceChecks, /Any authoritative JSON change, obsolete-row before-image change, or key\/reference-plan change invalidates it/);
assert.match(maintenanceChecks, /Authoritative JSON, obsolete-row before-images, keys, and reference blockers are all bound to the token/);
assert.match(maintenanceChecks, /Serving remains JSON/);
assert.match(maintenanceChecks, /json \/ json/);
assert.match(maintenanceChecks, /&lt;subject count&gt;/);
assert.match(maintenanceChecks, /safe &lt;log&gt;/);
assert.match(maintenanceChecks, /missing-50 … and 2 more/);
assert.doesNotMatch(maintenanceChecks, /missing-51/);
assert.match(maintenanceChecks, /obsolete-50 … and 2 more/);
assert.doesNotMatch(maintenanceChecks, /obsolete-51/);
assert.match(maintenanceChecks, /&lt;proposal_rows&gt;\.&lt;subject_id&gt;/);
assert.match(maintenanceChecks, /blocked-50 … and 2 more/);
assert.doesNotMatch(maintenanceChecks, /blocked-51/);

const savedAdminEnv = Object.fromEntries([
  'ADMIN_ENABLED',
  'ADMIN_EMAIL',
  'ADMIN_PASSWORD_HASH',
  'ADMIN_PASSWORD',
  'ADMIN_SESSION_SECRET',
  'DB_HOST',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'CONTENT_SOURCE',
].map(key => [key, process.env[key]]));
let adminTestServer;
try {
  process.env.ADMIN_ENABLED = 'true';
  process.env.ADMIN_EMAIL = adminAuthConfig.email;
  process.env.ADMIN_PASSWORD_HASH = adminAuthConfig.passwordHash;
  delete process.env.ADMIN_PASSWORD;
  process.env.ADMIN_SESSION_SECRET = adminAuthConfig.sessionSecret;
  process.env.CONTENT_SOURCE = 'json';
  delete process.env.DB_HOST;
  delete process.env.DB_USER;
  delete process.env.DB_PASSWORD;
  delete process.env.DB_NAME;

  const app = express();
  app.use('/admin', createAdminRouter({ root: process.cwd() }));
  adminTestServer = await new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  const address = adminTestServer.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const checksResponse = await fetch(`${origin}/admin/checks`, {
    headers: {
      cookie: `${adminCookieName()}=${encodeURIComponent(adminCookie)}`,
    },
  });
  assert.equal(checksResponse.status, 200);
  assert.equal(checksResponse.headers.get('cache-control'), 'no-store');
  assert.match(await checksResponse.text(), /Runtime checks/);

  const response = await fetch(`${origin}/admin/checks/database-mirror`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: `${adminCookieName()}=${encodeURIComponent(adminCookie)}`,
      origin,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ action: 'parity', csrf_token: 'invalid-token' }),
  });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(await response.text(), /request token was missing or invalid/);

  const unauthenticatedResponse = await fetch(`${origin}/admin/checks/database-mirror`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      origin,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ action: 'parity', csrf_token: maintenanceCsrf }),
  });
  assert.equal(unauthenticatedResponse.status, 302);
  assert.equal(unauthenticatedResponse.headers.get('location'), '/admin/login');

  const pruneWithoutConfirmationResponse = await fetch(`${origin}/admin/checks/database-mirror`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: `${adminCookieName()}=${encodeURIComponent(adminCookie)}`,
      origin,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ action: 'sync_prune', csrf_token: maintenanceCsrf }),
  });
  assert.equal(pruneWithoutConfirmationResponse.status, 400);
  assert.match(await pruneWithoutConfirmationResponse.text(), /exact plan-bound confirmation token/);

  const defaultActionResponse = await fetch(`${origin}/admin/checks/database-mirror`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: `${adminCookieName()}=${encodeURIComponent(adminCookie)}`,
      origin,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ csrf_token: maintenanceCsrf }),
  });
  assert.equal(defaultActionResponse.status, 503);
  const defaultActionBody = await defaultActionResponse.text();
  assert.match(defaultActionBody, /Database mirror maintenance could not start safely/);
  assert.doesNotMatch(defaultActionBody, /Access denied for user/);
} finally {
  if (adminTestServer) {
    await new Promise((resolve, reject) => adminTestServer.close(err => err ? reject(err) : resolve()));
  }
  for (const [key, value] of Object.entries(savedAdminEnv)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
}

const approvedProposal = renderProposalDetailPage({
  proposal: {
    id: 4,
    entityType: 'subject',
    entityKey: 'approved-subject',
    status: 'approved_for_draft',
    validationStatus: 'passed',
    validationErrors: [],
    proposedPayload: {},
    normalizedPayload: {},
    diff: { operation: 'add', safety: { warnings: [] } },
    events: [],
  },
  exports: [],
});
assert.match(approvedProposal, /Continue to publishing/);
assert.doesNotMatch(approvedProposal, /name="action" value="approve_for_draft"/);

const guidePayload = {
  id: 'R23 Internships and Projects',
  regulation: 'r23',
  name: 'R23 Internships and Projects',
  intro: 'Official milestone guidance.',
  seo: {
    slug: 'R23 Internships and Projects',
    title: 'R23 Internships and Projects Guide',
    meta_description: 'Official R23 internship and final project guidance for JNTUK students.',
  },
  sections: [{ id: 'Community Project', title: 'Community Project', body: 'Complete the official milestone.' }],
  source: {
    status: 'needs_verification',
    origin_url: 'https://jntuk.edu.in/r23-regulations.pdf',
    retrieved_date: '2026-07-18',
  },
};
const guideValidation = validateProposalPayload({
  root: process.cwd(),
  entityType: 'guide',
  payload: guidePayload,
});
assert.equal(guideValidation.status, 'passed');
assert.equal(guideValidation.normalizedPayload.id, 'r23-internships-and-projects');
assert.equal(guideValidation.normalizedPayload.regulation, 'R23');
assert.equal(guideValidation.normalizedPayload.seo.slug, 'r23-internships-and-projects');
assert.equal(guideValidation.normalizedPayload.sections[0].id, 'community-project');

const guideDiff = createStructuredDiff({
  content: {
    data: { subjects: [], guides: [{ ...guideValidation.normalizedPayload, intro: 'Before' }] },
    guides: [{ ...guideValidation.normalizedPayload, intro: 'Before' }],
    colleges: [],
    branchProfiles: [],
  },
  entityType: 'guide',
  entityKey: 'R23 Internships and Projects',
  proposedPayload: { ...guideValidation.normalizedPayload, intro: 'After' },
});
assert.equal(guideDiff.diff.operation, 'merge_update');
assert.equal(guideDiff.diff.match.found_existing, true);
assert.equal(guideDiff.proposedPayload.intro, 'After');

const proposalCreate = renderProposalCreatePage({ values: { entity_type: 'guide' } });
assert.match(proposalCreate, /value="guide" selected>guide \(manual only\)<\/option>/);
assert.match(proposalCreate, /Guide proposals are manual-only/);
assert.match(proposalCreate, /Source asset ID/);
assert.match(proposalCreate, /Existing content-source row ID/);
assert.match(proposalCreate, /AMEND VERIFIED SOURCE/);

const parseDetail = renderParseResultDetailPage({
  result: {
    id: 9,
    status: 'success',
    parserKey: 'pdf-text-basic',
    assetId: 4,
    assetFilename: 'guide.pdf',
    parsedPayload: {},
    confidence: {},
  },
});
assert.match(parseDetail, /value="guide">guide \(manual payload only\)<\/option>/);
assert.match(parseDetail, /Automatic guide extraction is not available/);

const invalidR2Asset = renderAssetDetailPage({
  asset: {
    id: 8,
    originalFilename: 'official.pdf',
    storageProvider: 'r2',
    storageKey: 'source-assets/sha256/ab/abcdef',
    sha256Checksum: 'a'.repeat(64),
    discoverySourceId: 2,
    discoverySourceName: 'Official source',
    sourceUrl: 'https://jntuk.edu.in/official.pdf',
  },
  fileStatus: {
    status: 'invalid',
    exists: false,
    repairAvailable: true,
    integrityError: 'Asset checksum mismatch.',
  },
  parsers: [{ key: 'pdf-text-basic', label: 'PDF reader', version: '1', available: true }],
});
assert.match(invalidR2Asset, /Stored evidence failed its integrity check/);
assert.match(invalidR2Asset, /source-assets\/sha256\/ab\/abcdef/);
assert.match(invalidR2Asset, /Repair evidence/);
assert.doesNotMatch(invalidR2Asset, />Run parser<\/button>/);

const releaseCandidate = renderReleaseCandidateDetailPage({
  release: {
    id: 12,
    title: 'Reviewed guide release',
    status: 'ready_for_review',
    publicationMode: 'github_pr',
    itemCount: 1,
    exportedCount: 1,
    draftAppliedCount: 1,
    revisionCount: 1,
    items: [],
  },
  reviewSummary: { has_blocking_warnings: false, warnings: [], items: [] },
  githubPublication: {
    id: 3,
    status: 'pr_open',
    pullRequestNumber: 44,
    pullRequestUrl: 'https://github.com/example/site/pull/44',
  },
});
assert.match(releaseCandidate, /Review PR open/);
assert.match(releaseCandidate, /Open sealed apply plan and publication/);
assert.match(releaseCandidate, /Open review PR #44/);
assert.doesNotMatch(releaseCandidate, /action="\/admin\/release-candidates\/12\/apply-plan"/);
assert.doesNotMatch(releaseCandidate, /NOT PUBLISHED/);
assert.doesNotMatch(releaseCandidate, /Recover timeout\/partial live apply/);

for (const [status, label] of [
  ['deployed', 'Deployed and verified'],
  ['superseded', 'Superseded by a newer release'],
  ['tampered', 'Blocked · integrity failure'],
]) {
  const lifecyclePage = renderReleaseCandidateDetailPage({
    release: {
      id: 12,
      title: 'Reviewed guide release',
      status: 'ready_for_review',
      publicationMode: 'github_pr',
      itemCount: 1,
      exportedCount: 1,
      draftAppliedCount: 1,
      revisionCount: 1,
      items: [],
    },
    reviewSummary: { has_blocking_warnings: false, warnings: [], items: [] },
    githubPublication: { id: 3, status },
  });
  assert.match(lifecyclePage, new RegExp(label));
  assert.doesNotMatch(lifecyclePage, /action="\/admin\/release-candidates\/12\/apply-plan"/);
}

const releasePlan = renderReleaseApplyPlanDetailPage({
  plan: {
    release_candidate_id: 12,
    status: 'ready_for_review',
    generated_at: '2026-07-18T00:00:00.000Z',
    final_warnings: [],
    informational_warnings: [],
    changes: [{
      order: 1,
      file: 'data/guides.json',
      operation: 'replace',
      entity_type: 'guide',
      entity_key: 'r23-internships-and-projects',
      proposal_id: 7,
      after_json: guideValidation.normalizedPayload,
    }],
    ordered_file_changes: [],
    combined_patch: [],
    storage: { tmp_artifact_status: 'available' },
  },
  publicationMode: 'github_pr',
  githubTrustReady: true,
  githubPublication: {
    id: 3,
    status: 'pr_open',
    pullRequestNumber: 44,
    pullRequestUrl: 'https://github.com/example/site/pull/44',
    branchName: 'jntustack/rc-12-0123456789ab',
    baseSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    artifactHash: 'c'.repeat(64),
    attemptCount: 1,
  },
});
assert.match(releasePlan, /Human-gated publication workflow/);
assert.match(releasePlan, /Review PR #44/);
assert.match(releasePlan, /Review PR open/);
assert.match(releasePlan, /Refresh status/);
assert.doesNotMatch(releasePlan, /NOT PUBLISHED/);
assert.doesNotMatch(releasePlan, /Apply to live JSON/);
assert.doesNotMatch(releasePlan, /merge[^<]*button/i);

const trustBlockedPlan = renderReleaseApplyPlanDetailPage({
  plan: {
    release_candidate_id: 13,
    status: 'ready_for_review',
    generated_at: '2026-07-18T00:00:00.000Z',
    final_warnings: [],
    informational_warnings: [],
    changes: [{
      order: 1,
      file: 'data/guides.json',
      operation: 'replace',
      entity_type: 'guide',
      entity_key: 'r23-internships-and-projects',
      proposal_id: 8,
      after_json: guideValidation.normalizedPayload,
    }],
    ordered_file_changes: [],
    combined_patch: [],
    storage: { tmp_artifact_status: 'available' },
  },
  publicationMode: 'github_pr',
  githubTrustReady: false,
});
assert.match(trustBlockedPlan, /Publication trust gate is closed/);
assert.doesNotMatch(trustBlockedPlan, /action="\/admin\/release-apply-plans\/13\/publish-github"/);

console.log('Admin UI and freshness checks passed.');
