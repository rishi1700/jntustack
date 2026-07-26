import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildSearchIndex } from './retrieve.js';
import { loadDataset, loadMergedColleges } from './dataset.js';

export const EXPECTED_PARITY_COUNTS = {
  subjects: 436,
  verifiedSubjects: 436,
  subjectPages: 403,
  listingSubjects: 33,
  colleges: 376,
  branchProfiles: 6,
  guides: 1,
  searchDocs: 786,
};

export const AUTHORITATIVE_PRUNE_CONFIRMATION = 'DELETE_OBSOLETE_MIRROR_RECORDS';
export const AUTHORITATIVE_PRUNE_COMMIT_ACTION = 'content_sync.authoritative_prune_committed';
export const AUTHORITATIVE_PRUNE_COMMIT_ENTITY_TYPE = 'database_mirror_prune';
const AUTHORITATIVE_PRUNE_CONFIRMATION_PATTERN = new RegExp(
  `^${AUTHORITATIVE_PRUNE_CONFIRMATION}:[a-f0-9]{64}$`
);
const AUTHORITATIVE_PRUNE_REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class AuthoritativePruneCommitOutcomeUnknownError extends Error {
  constructor(cause, {
    requestId,
    planDigest,
    confirmationToken,
    phase,
    lastCompletedPhase,
  }) {
    super(
      `Authoritative prune COMMIT acknowledgement was not received for request ${requestId}; ` +
      'the outcome is unknown and must be reconciled from durable audit evidence.',
      { cause }
    );
    this.name = 'AuthoritativePruneCommitOutcomeUnknownError';
    this.code = 'AUTHORITATIVE_PRUNE_COMMIT_OUTCOME_UNKNOWN';
    this.commitOutcome = 'unknown';
    this.commitAttempted = true;
    this.reconciliationRequired = true;
    this.pruneRequestId = requestId;
    this.prunePlanDigest = planDigest;
    this.pruneConfirmationToken = confirmationToken;
    this.currentPhase = phase;
    this.importPhase = phase;
    this.lastCompletedPhase = lastCompletedPhase || null;
    this.originalCode = cause?.code || null;
  }
}

export class ImportPhaseCommitOutcomeUnknownError extends Error {
  constructor(cause, { phase, lastCompletedPhase }) {
    super(
      `Database import phase ${phase} COMMIT acknowledgement was not received; ` +
      'the outcome is unknown and must be reconciled before retrying.',
      { cause }
    );
    this.name = 'ImportPhaseCommitOutcomeUnknownError';
    this.code = 'IMPORT_PHASE_COMMIT_OUTCOME_UNKNOWN';
    this.commitOutcome = 'unknown';
    this.commitAttempted = true;
    this.reconciliationRequired = true;
    this.currentPhase = phase;
    this.importPhase = phase;
    this.lastCompletedPhase = lastCompletedPhase || null;
    this.originalCode = cause?.code || null;
  }
}

export class TransactionRollbackOutcomeUnknownError extends Error {
  constructor(operationError, rollbackError, {
    phase,
    lastCompletedPhase,
    pruneRequestId = null,
    prunePlanDigest = null,
    pruneConfirmationToken = null,
  }) {
    super(
      `Database transaction rollback acknowledgement was not received for phase ${phase}; ` +
      'the outcome is inconclusive and must be reconciled before retrying.',
      { cause: rollbackError }
    );
    this.name = 'TransactionRollbackOutcomeUnknownError';
    this.code = 'TRANSACTION_ROLLBACK_OUTCOME_UNKNOWN';
    this.commitOutcome = 'not_attempted';
    this.commitAttempted = false;
    this.rollbackOutcome = 'unknown';
    this.rollbackAttempted = true;
    this.transactionOutcome = 'unknown';
    this.reconciliationRequired = true;
    this.currentPhase = phase;
    this.importPhase = phase;
    this.lastCompletedPhase = lastCompletedPhase || null;
    this.pruneRequestId = pruneRequestId;
    this.prunePlanDigest = prunePlanDigest;
    this.pruneConfirmationToken = pruneConfirmationToken;
    this.operationCode = operationError?.code || operationError?.name || null;
    this.rollbackCode = rollbackError?.code || rollbackError?.name || null;
  }
}

export class TransactionStartOutcomeUnknownError extends Error {
  constructor(cause, { phase, lastCompletedPhase }) {
    super(
      `Database transaction start acknowledgement was not received for phase ${phase}; ` +
      'the connection was discarded before any phase work ran.',
      { cause }
    );
    this.name = 'TransactionStartOutcomeUnknownError';
    this.code = 'TRANSACTION_START_OUTCOME_UNKNOWN';
    this.transactionStartOutcome = 'unknown';
    this.operationStarted = false;
    this.connectionMustBeDiscarded = true;
    this.currentPhase = phase;
    this.importPhase = phase;
    this.lastCompletedPhase = lastCompletedPhase || null;
    this.originalCode = cause?.code || null;
  }
}

export function createAuthoritativePruneRequestId() {
  return crypto.randomUUID();
}

function normalizeAuthoritativePruneRequestId(value, { generate = false } = {}) {
  const requestId = value == null || value === ''
    ? (generate ? createAuthoritativePruneRequestId() : null)
    : String(value).trim();
  if (requestId != null && !AUTHORITATIVE_PRUNE_REQUEST_ID_PATTERN.test(requestId)) {
    throw new Error('Authoritative prune request ID must be a canonical UUID.');
  }
  return requestId == null ? null : requestId.toLowerCase();
}

const REPRESENTATIVE_SUBJECT_SLUGS = [
  'data-warehousing-and-data-mining-jntuk-r23-cse-3-1',
  'computer-networks-jntuk-r23-cse-3-1',
  'environmental-science-jntuk-r23-ce-2-1',
];

const REPRESENTATIVE_BRANCHES = ['CSE', 'ECE', 'MECH'];
const REPRESENTATIVE_COLLEGE_CODES = ['JNTUK', 'JNTUH', 'JNTUA', 'JNTUGV'];

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function checksum(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function json(value) {
  return value == null ? null : JSON.stringify(value);
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  return JSON.parse(value);
}

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function stripNullish(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
}

function sourcePayload(source, sourceType = 'content') {
  if (!source) return null;
  const payload = {
    origin_url: source.origin_url ?? source.source_url ?? null,
    retrieved_date: source.retrieved_date ?? source.last_verified ?? null,
    status: source.status ?? 'verified',
    college_source_note: source.college_source_note ?? null,
    source_type: sourceType,
  };
  if (!payload.origin_url && !payload.retrieved_date && !payload.college_source_note && !payload.status) {
    return null;
  }
  return payload;
}

function sourceFromRow(row, fallbackStatus) {
  return {
    origin_url: row.origin_url ?? null,
    retrieved_date: dateOnly(row.retrieved_at),
    status: fallbackStatus ?? row.source_status ?? 'needs_verification',
    ...(row.caveat_text ? { college_source_note: row.caveat_text } : {}),
  };
}

function collegeStableKey(college) {
  return [
    college.affiliated_to || '',
    college.short_code || '',
    college.name || '',
    college.location?.district || '',
  ].join(':');
}

const AUTHORITATIVE_MIRRORS = [
  {
    entityType: 'subject',
    table: 'subjects',
    keyColumn: 'stable_id',
    expectedCount: EXPECTED_PARITY_COUNTS.subjects,
    sourceKeys: content => content.subjects.map(subject => subject.id),
  },
  {
    entityType: 'college',
    table: 'colleges',
    keyColumn: 'stable_key',
    expectedCount: EXPECTED_PARITY_COUNTS.colleges,
    sourceKeys: content => content.colleges.map(collegeStableKey),
  },
  {
    entityType: 'branch_profile',
    table: 'branch_profiles',
    keyColumn: 'branch_code',
    expectedCount: EXPECTED_PARITY_COUNTS.branchProfiles,
    sourceKeys: content => content.branchProfiles.map(profile => profile.branch),
  },
  {
    entityType: 'guide',
    table: 'guides',
    keyColumn: 'stable_id',
    expectedCount: EXPECTED_PARITY_COUNTS.guides,
    sourceKeys: content => (content.guides || []).map(guide => guide.id),
  },
];

function campusFileName(code) {
  return `colleges-${String(code).toLowerCase()}.json`;
}

function groupBy(items, keyFn) {
  const grouped = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }
  return grouped;
}

export function loadJsonContent(dataDir) {
  const { data } = loadDataset(dataDir);
  const { colleges, coverageNotes } = loadMergedColleges(dataDir);
  const { branch_profiles: branchProfiles } = JSON.parse(fs.readFileSync(path.join(dataDir, 'branch-guide-data.json'), 'utf-8'));
  return {
    shared: {
      regulations: data.regulations,
      branches: data.branches,
    },
    subjects: data.subjects,
    guides: data.guides || [],
    colleges,
    coverageNotes,
    branchProfiles,
  };
}

function cleanRelativeDataFile(file) {
  if (!file) return null;
  const normalized = String(file).replaceAll('\\', '/').replace(/^\.?\//, '');
  if (!normalized.startsWith('data/')) {
    throw new Error('--file must point to a data/ JSON file.');
  }
  if (normalized.includes('..')) {
    throw new Error('--file must not contain parent directory segments.');
  }
  return normalized;
}

function loadScopedContent(dataDir, { file = null } = {}) {
  const content = loadJsonContent(dataDir);
  const relativeFile = cleanRelativeDataFile(file);
  if (!relativeFile) return content;

  const absolute = path.join(path.dirname(dataDir), relativeFile);
  const basename = path.basename(relativeFile);
  const document = JSON.parse(fs.readFileSync(absolute, 'utf-8'));

  if (/^subjects-.*\.json$/.test(basename)) {
    return { ...content, subjects: document.subjects || [] };
  }
  if (/^colleges-.*\.json$/.test(basename)) {
    return { ...content, colleges: document.colleges || [] };
  }
  if (basename === 'branch-guide-data.json') {
    return { ...content, branchProfiles: document.branch_profiles || [] };
  }
  if (basename === 'guides.json') {
    return { ...content, guides: document.guides || [] };
  }
  throw new Error(`Unsupported scoped import file: ${relativeFile}`);
}

export function normalizeImportOptions(options = {}) {
  const file = cleanRelativeDataFile(options.file || null);
  const explicitScopes = {
    subjects: Boolean(options.subjects),
    colleges: Boolean(options.colleges),
    branchProfiles: Boolean(options.branchProfiles),
    guides: Boolean(options.guides),
  };
  if (file) {
    const basename = path.basename(file);
    if (/^subjects-.*\.json$/.test(basename)) explicitScopes.subjects = true;
    else if (/^colleges-.*\.json$/.test(basename)) explicitScopes.colleges = true;
    else if (basename === 'branch-guide-data.json') explicitScopes.branchProfiles = true;
    else if (basename === 'guides.json') explicitScopes.guides = true;
  }
  if (file && [explicitScopes.subjects, explicitScopes.colleges, explicitScopes.branchProfiles, explicitScopes.guides].filter(Boolean).length > 1) {
    throw new Error('--file can only be combined with the matching scoped import flag.');
  }
  const hasScope = explicitScopes.subjects || explicitScopes.colleges || explicitScopes.branchProfiles || explicitScopes.guides;
  const full = !hasScope;
  const pruneDryRun = Boolean(options.pruneDryRun);
  const prune = Boolean(options.prune);
  const pruneConfirmation = options.pruneConfirmation == null ? null : String(options.pruneConfirmation);
  const pruneRequestId = normalizeAuthoritativePruneRequestId(options.pruneRequestId, { generate: prune });
  if (pruneDryRun && prune) {
    throw new Error('--prune-dry-run and --prune are mutually exclusive.');
  }
  if ((pruneDryRun || prune) && !full) {
    throw new Error('Authoritative pruning requires a full import; --file and partial scope selectors are not allowed.');
  }
  if (prune && !AUTHORITATIVE_PRUNE_CONFIRMATION_PATTERN.test(pruneConfirmation || '')) {
    throw new Error(
      `--prune requires the exact --confirm-prune=${AUTHORITATIVE_PRUNE_CONFIRMATION}:<sha256> token from --prune-dry-run.`
    );
  }
  if (!prune && pruneConfirmation != null) {
    throw new Error('--confirm-prune is only valid with --prune.');
  }
  if (!prune && pruneRequestId != null) {
    throw new Error('pruneRequestId is only valid with --prune.');
  }
  return {
    file,
    full,
    subjects: full || explicitScopes.subjects,
    colleges: full || explicitScopes.colleges,
    branchProfiles: full || explicitScopes.branchProfiles,
    guides: full || explicitScopes.guides,
    pruneMode: pruneDryRun ? 'dry-run' : (prune ? 'apply' : 'disabled'),
    pruneConfirmation,
    pruneRequestId,
    pruneActor: String(options.pruneActor || 'system:json-authoritative-prune'),
    logger: typeof options.logger === 'function' ? options.logger : () => {},
    queryTimeoutMs: Number.isFinite(Number(options.queryTimeoutMs)) ? Number(options.queryTimeoutMs) : 30000,
  };
}

function importSummary(content, scopes) {
  const universityCodes = [...new Set(content.colleges.map(c => c.affiliated_to).filter(Boolean))].sort();
  return {
    universities: scopes.colleges || scopes.full ? universityCodes.length : 0,
    regulations: scopes.subjects || scopes.branchProfiles || scopes.guides || scopes.full ? content.shared.regulations.length : 0,
    branches: scopes.subjects || scopes.branchProfiles || scopes.guides || scopes.full ? content.shared.branches.length : 0,
    subjects: scopes.subjects ? content.subjects.length : 0,
    colleges: scopes.colleges ? content.colleges.length : 0,
    branchProfiles: scopes.branchProfiles ? content.branchProfiles.length : 0,
    guides: scopes.guides ? content.guides.length : 0,
    sourcesTouched: 0,
    file: scopes.file,
    scope: scopes.full ? 'full' : [
      scopes.subjects ? 'subjects' : null,
      scopes.colleges ? 'colleges' : null,
      scopes.branchProfiles ? 'branch_profiles' : null,
      scopes.guides ? 'guides' : null,
    ].filter(Boolean).join(','),
  };
}

function chunks(items, size = 100) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function queryWithTimeout(ctx, sql, values = []) {
  return ctx.conn.query({ sql, timeout: ctx.queryTimeoutMs }, values);
}

async function rollbackTransactionOrThrowUnknown(ctx, operationError, phase, metadata = {}) {
  try {
    await queryWithTimeout(ctx, 'ROLLBACK');
  } catch (rollbackError) {
    try {
      await ctx.conn.destroy?.();
    } catch {
      // A connection with an unacknowledged rollback must never be reused.
    }
    throw new TransactionRollbackOutcomeUnknownError(operationError, rollbackError, {
      phase,
      lastCompletedPhase: ctx.lastCompletedPhase,
      ...metadata,
    });
  }
}

async function startTransactionOrDiscard(ctx, sql, phase, { preludeSql = null } = {}) {
  try {
    if (preludeSql) await queryWithTimeout(ctx, preludeSql);
    await queryWithTimeout(ctx, sql);
  } catch (cause) {
    try {
      await ctx.conn.destroy?.();
    } catch {
      // An unacknowledged transaction start makes this connection unusable.
    }
    throw new TransactionStartOutcomeUnknownError(cause, {
      phase,
      lastCompletedPhase: ctx.lastCompletedPhase,
    });
  }
}

function isTransactionOutcomeUnknown(error) {
  return Boolean(
    error?.reconciliationRequired === true &&
    (
      error?.commitOutcome === 'unknown' ||
      error?.rollbackOutcome === 'unknown' ||
      error?.transactionOutcome === 'unknown'
    )
  );
}

async function runImportPhase(ctx, name, expectedCount, callback) {
  const started = Date.now();
  ctx.currentPhase = name;
  ctx.logger(`start ${name}${expectedCount == null ? '' : ` (${expectedCount})`}`);
  await startTransactionOrDiscard(ctx, 'START TRANSACTION', name);
  try {
    const result = await callback();
    try {
      await queryWithTimeout(ctx, 'COMMIT');
    } catch (cause) {
      const ambiguity = new ImportPhaseCommitOutcomeUnknownError(cause, {
        phase: name,
        lastCompletedPhase: ctx.lastCompletedPhase,
      });
      try {
        await ctx.conn.destroy?.();
      } catch {
        // The outcome remains unknown either way; never reuse this connection.
      }
      throw ambiguity;
    }
    ctx.lastCompletedPhase = name;
    try {
      ctx.logger(`done ${name} in ${Date.now() - started}ms`);
    } catch {
      // The transaction is already committed; logging must not change its outcome.
    }
    return result;
  } catch (err) {
    if (isTransactionOutcomeUnknown(err)) {
      throw err;
    }
    await rollbackTransactionOrThrowUnknown(ctx, err, name);
    err.importPhase = name;
    err.lastCompletedPhase = ctx.lastCompletedPhase;
    throw err;
  }
}

async function upsertSourceWithContext(ctx, source, sourceType) {
  const payload = sourcePayload(source, sourceType);
  if (!payload) return null;
  const hash = checksum(payload);
  const cacheKey = `${sourceType}:${hash}`;
  if (ctx.sourceCache.has(cacheKey)) return ctx.sourceCache.get(cacheKey);
  const retrievedAt = payload.retrieved_date || null;
  const status = payload.status || 'needs_verification';

  const [result] = await queryWithTimeout(ctx,
    `INSERT INTO sources
      (origin_url, source_type, source_name, retrieved_at, checksum, status, caveat_text)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      id = LAST_INSERT_ID(id),
      origin_url = VALUES(origin_url),
      source_type = VALUES(source_type),
      source_name = VALUES(source_name),
      retrieved_at = VALUES(retrieved_at),
      status = VALUES(status),
      caveat_text = VALUES(caveat_text)`,
    [
      payload.origin_url,
      sourceType,
      sourceType,
      retrievedAt,
      hash,
      status,
      payload.college_source_note,
    ]
  );
  ctx.sourceCache.set(cacheKey, result.insertId);
  ctx.summary.sourcesTouched += 1;
  return result.insertId;
}

async function loadReferenceMaps(ctx) {
  const [regRows] = await queryWithTimeout(ctx, 'SELECT id, code FROM regulations');
  const [branchRows] = await queryWithTimeout(ctx, 'SELECT id, code FROM branches');
  const [universityRows] = await queryWithTimeout(ctx, 'SELECT id, code FROM universities');
  return {
    regulationIdByCode: new Map(regRows.map(row => [row.code, row.id])),
    branchIdByCode: new Map(branchRows.map(row => [row.code, row.id])),
    universityIdByCode: new Map(universityRows.map(row => [row.code, row.id])),
  };
}

function sqlIdentifier(value) {
  const identifier = String(value || '');
  if (!/^[A-Za-z0-9_]+$/.test(identifier)) {
    throw new Error(`Unsafe database identifier returned by schema metadata: ${identifier}`);
  }
  return `\`${identifier}\``;
}

function auditJson(value) {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? String(item) : item);
}

function parseAuditJson(value) {
  if (value == null) return null;
  if (typeof value === 'string') return JSON.parse(value);
  return value;
}

export async function findAuthoritativePruneCommitEvidence(conn, {
  requestId,
  planDigest = null,
  confirmationToken = null,
  queryTimeoutMs = 30000,
} = {}) {
  const normalizedRequestId = normalizeAuthoritativePruneRequestId(requestId);
  if (!normalizedRequestId) {
    throw new Error('Authoritative prune request ID is required for reconciliation.');
  }
  if (planDigest != null && !/^[a-f0-9]{64}$/.test(String(planDigest))) {
    throw new Error('Authoritative prune plan digest must be 64 lowercase hexadecimal characters.');
  }
  if (
    confirmationToken != null &&
    !AUTHORITATIVE_PRUNE_CONFIRMATION_PATTERN.test(String(confirmationToken))
  ) {
    throw new Error('Authoritative prune confirmation token is invalid.');
  }

  const [rows] = await conn.query({
    sql: `SELECT id, actor, action, entity_type, entity_id, after_json, created_at
          FROM audit_log
          WHERE action = ? AND entity_type = ? AND entity_id = ?
          ORDER BY id
          LIMIT 2`,
    timeout: Number.isFinite(Number(queryTimeoutMs)) ? Number(queryTimeoutMs) : 30000,
  }, [
    AUTHORITATIVE_PRUNE_COMMIT_ACTION,
    AUTHORITATIVE_PRUNE_COMMIT_ENTITY_TYPE,
    normalizedRequestId,
  ]);
  if (!rows.length) {
    return {
      committed: false,
      requestId: normalizedRequestId,
    };
  }
  if (rows.length !== 1) {
    throw new Error(`Duplicate authoritative prune commit evidence exists for request ${normalizedRequestId}.`);
  }

  const row = rows[0];
  const evidence = parseAuditJson(row.after_json);
  const totalKeys = ['authoritative', 'current', 'obsolete', 'missing', 'deleted', 'blockedReferences'];
  const structurallyValid = (
    row.action === AUTHORITATIVE_PRUNE_COMMIT_ACTION &&
    row.entity_type === AUTHORITATIVE_PRUNE_COMMIT_ENTITY_TYPE &&
    row.entity_id === normalizedRequestId &&
    evidence &&
    evidence.schema_version === 1 &&
    evidence.evidence_type === 'authoritative_prune_transaction_commit' &&
    evidence.request_id === normalizedRequestId &&
    /^[a-f0-9]{64}$/.test(String(evidence.plan_digest || '')) &&
    evidence.confirmation_token === `${AUTHORITATIVE_PRUNE_CONFIRMATION}:${evidence.plan_digest}` &&
    /^[a-f0-9]{64}$/.test(String(evidence.authoritative_content_digest || '')) &&
    evidence.actor === (row.actor ?? null) &&
    evidence.totals &&
    typeof evidence.totals === 'object' &&
    !Array.isArray(evidence.totals) &&
    totalKeys.every(key => Number.isInteger(evidence.totals[key]) && evidence.totals[key] >= 0)
  );
  if (!structurallyValid) {
    throw new Error(`Authoritative prune commit evidence is malformed for request ${normalizedRequestId}.`);
  }
  if (planDigest != null && evidence.plan_digest !== String(planDigest)) {
    throw new Error(`Authoritative prune commit evidence plan digest mismatch for request ${normalizedRequestId}.`);
  }
  if (confirmationToken != null && evidence.confirmation_token !== String(confirmationToken)) {
    throw new Error(`Authoritative prune commit evidence confirmation mismatch for request ${normalizedRequestId}.`);
  }
  return {
    committed: true,
    requestId: normalizedRequestId,
    auditId: String(row.id),
    actor: row.actor ?? null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    planDigest: evidence.plan_digest,
    confirmationToken: evidence.confirmation_token,
    totals: evidence.totals,
    evidence,
  };
}

function auditEntityId(value) {
  const identifier = String(value);
  if (identifier.length <= 255) return identifier;
  return `sha256:${crypto.createHash('sha256').update(identifier).digest('hex')}`;
}

function checkedKeySet(entityType, keys) {
  const normalized = keys.map(value => {
    if (value == null || !String(value).trim()) {
      throw new Error(`Authoritative ${entityType} content contains an empty stable identifier.`);
    }
    return String(value);
  });
  const unique = new Set(normalized);
  if (unique.size !== normalized.length) {
    const seen = new Set();
    const duplicate = normalized.find(value => {
      if (seen.has(value)) return true;
      seen.add(value);
      return false;
    });
    throw new Error(`Authoritative ${entityType} content contains duplicate stable identifier: ${duplicate}`);
  }
  return unique;
}

function assertCompleteAuthoritativePruneDataset(content) {
  for (const mirror of AUTHORITATIVE_MIRRORS) {
    const keys = checkedKeySet(mirror.entityType, mirror.sourceKeys(content));
    if (keys.size !== mirror.expectedCount) {
      throw new Error(
        `Authoritative ${mirror.entityType} count is ${keys.size}; expected the approved count ${mirror.expectedCount}. ` +
        'Refusing to inspect or apply pruning until the dataset and EXPECTED_PARITY_COUNTS are reviewed together.'
      );
    }
  }
}

export async function verifyAuthoritativeMirrorKeyState(conn, content, {
  queryTimeoutMs = 30000,
} = {}) {
  assertCompleteAuthoritativePruneDataset(content);
  const ctx = {
    conn,
    queryTimeoutMs: Number.isFinite(Number(queryTimeoutMs)) ? Number(queryTimeoutMs) : 30000,
  };
  await startTransactionOrDiscard(
    ctx,
    'START TRANSACTION READ ONLY',
    'authoritative_mirror_key_verification',
    { preludeSql: 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ' }
  );
  let commitAttempted = false;
  try {
    const entities = [];
    for (const mirror of AUTHORITATIVE_MIRRORS) {
      const expectedKeys = checkedKeySet(mirror.entityType, mirror.sourceKeys(content));
      const [rows] = await queryWithTimeout(ctx,
        `SELECT id, ${sqlIdentifier(mirror.keyColumn)}
         FROM ${sqlIdentifier(mirror.table)}
         ORDER BY id`
      );
      const currentKeys = rows.map(row => String(row[mirror.keyColumn] ?? ''));
      const currentKeySet = new Set(currentKeys);
      const duplicateOrEmptyKeys = currentKeys
        .filter((key, index) => !key || currentKeys.indexOf(key) !== index)
        .sort();
      const missingKeys = [...expectedKeys].filter(key => !currentKeySet.has(key)).sort();
      const unexpectedKeys = [...currentKeySet].filter(key => !expectedKeys.has(key)).sort();
      entities.push({
        entityType: mirror.entityType,
        table: mirror.table,
        keyColumn: mirror.keyColumn,
        authoritativeCount: expectedKeys.size,
        currentCount: rows.length,
        missingCount: missingKeys.length,
        unexpectedCount: unexpectedKeys.length,
        duplicateOrEmptyCount: duplicateOrEmptyKeys.length,
        missingKeys,
        unexpectedKeys,
        duplicateOrEmptyKeys,
        ok: (
          rows.length === expectedKeys.size &&
          missingKeys.length === 0 &&
          unexpectedKeys.length === 0 &&
          duplicateOrEmptyKeys.length === 0
        ),
      });
    }
    commitAttempted = true;
    await queryWithTimeout(ctx, 'COMMIT');
    return {
      ok: entities.every(entity => entity.ok),
      authoritativeContentDigest: authoritativeContentDigest(content),
      entities,
      totals: {
        authoritative: entities.reduce((total, entity) => total + entity.authoritativeCount, 0),
        current: entities.reduce((total, entity) => total + entity.currentCount, 0),
        missing: entities.reduce((total, entity) => total + entity.missingCount, 0),
        unexpected: entities.reduce((total, entity) => total + entity.unexpectedCount, 0),
        duplicateOrEmpty: entities.reduce(
          (total, entity) => total + entity.duplicateOrEmptyCount,
          0
        ),
      },
    };
  } catch (err) {
    if (commitAttempted) {
      try {
        await conn.destroy?.();
      } catch {
        // A read-only snapshot must not leave a connection in unknown state.
      }
    } else {
      await rollbackTransactionOrThrowUnknown(ctx, err, 'authoritative_mirror_key_verification');
    }
    throw err;
  }
}

async function loadReferencingForeignKeys(ctx) {
  const [rows] = await queryWithTimeout(ctx,
    `SELECT
       TABLE_NAME AS referencing_table,
       COLUMN_NAME AS referencing_column,
       REFERENCED_TABLE_NAME AS referenced_table,
       REFERENCED_COLUMN_NAME AS referenced_column
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE REFERENCED_TABLE_SCHEMA = DATABASE()
       AND REFERENCED_TABLE_NAME IN (?)
     ORDER BY REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, TABLE_NAME, COLUMN_NAME`,
    [AUTHORITATIVE_MIRRORS.map(mirror => mirror.table)]
  );
  return rows.map(row => ({
    referencingTable: String(row.referencing_table),
    referencingColumn: String(row.referencing_column),
    referencedTable: String(row.referenced_table),
    referencedColumn: String(row.referenced_column),
  }));
}

async function findReferenceBlockers(ctx, mirror, obsoleteRows, foreignKeys, { lock }) {
  if (!obsoleteRows.length) return [];
  const obsoleteIdSet = new Set(obsoleteRows.map(row => String(row.id)));
  const blockers = [];
  for (const foreignKey of foreignKeys.filter(item => item.referencedTable === mirror.table)) {
    const referencingTable = sqlIdentifier(foreignKey.referencingTable);
    const referencingColumn = sqlIdentifier(foreignKey.referencingColumn);
    const referencedValues = obsoleteRows
      .map(row => row[foreignKey.referencedColumn])
      .filter(value => value != null);
    if (!referencedValues.length) continue;
    const [rows] = await queryWithTimeout(ctx,
      `SELECT id, ${referencingColumn} AS referenced_id
       FROM ${referencingTable}
       WHERE ${referencingColumn} IN (?)
       ORDER BY id${lock ? ' FOR UPDATE' : ''}`,
      [referencedValues]
    );
    const externalRows = foreignKey.referencingTable === mirror.table
      ? rows.filter(row => !obsoleteIdSet.has(String(row.id)))
      : rows;
    if (!externalRows.length) continue;
    blockers.push({
      referencingTable: foreignKey.referencingTable,
      referencingColumn: foreignKey.referencingColumn,
      referencedColumn: foreignKey.referencedColumn,
      count: externalRows.length,
      referencingIds: externalRows.map(row => String(row.id)),
    });
  }
  return blockers;
}

async function collectAuthoritativePrunePlan(ctx, content, { lock }) {
  const mirrors = [];
  for (const mirror of AUTHORITATIVE_MIRRORS) {
    const expectedKeys = checkedKeySet(mirror.entityType, mirror.sourceKeys(content));
    const [rows] = await queryWithTimeout(ctx,
      `SELECT * FROM ${sqlIdentifier(mirror.table)} ORDER BY id${lock ? ' FOR UPDATE' : ''}`
    );
    const currentKeys = rows.map(row => String(row[mirror.keyColumn] ?? ''));
    const currentKeySet = new Set(currentKeys);
    if (currentKeySet.size !== currentKeys.length || currentKeys.some(key => !key)) {
      throw new Error(`Database ${mirror.table} rows do not have unique, non-empty ${mirror.keyColumn} values.`);
    }
    const obsoleteRows = rows.filter(row => !expectedKeys.has(String(row[mirror.keyColumn])));
    const missingKeys = [...expectedKeys].filter(key => !currentKeySet.has(key)).sort();
    mirrors.push({
      ...mirror,
      expectedKeys,
      currentRows: rows,
      obsoleteRows,
      missingKeys,
      referenceBlockers: [],
    });
  }

  const candidates = mirrors.reduce((total, mirror) => total + mirror.obsoleteRows.length, 0);
  const foreignKeys = candidates ? await loadReferencingForeignKeys(ctx) : [];
  for (const mirror of mirrors) {
    mirror.referenceBlockers = await findReferenceBlockers(
      ctx,
      mirror,
      mirror.obsoleteRows,
      foreignKeys,
      { lock }
    );
  }
  return mirrors;
}

function authoritativeContentDigest(content) {
  return checksum(content);
}

function authoritativePrunePlanDigest(mirrors, content) {
  return checksum({
    schemaVersion: 1,
    authoritativeContentDigest: authoritativeContentDigest(content),
    entities: mirrors.map(mirror => ({
      entityType: mirror.entityType,
      keyColumn: mirror.keyColumn,
      authoritativeKeys: [...mirror.expectedKeys].sort(),
      currentKeys: mirror.currentRows.map(row => String(row[mirror.keyColumn])).sort(),
      obsoleteKeys: mirror.obsoleteRows.map(row => String(row[mirror.keyColumn])).sort(),
      obsoleteBeforeImages: mirror.obsoleteRows
        .map(row => ({
          stableKey: String(row[mirror.keyColumn]),
          checksum: checksum(JSON.parse(auditJson(row))),
        }))
        .sort((left, right) => left.stableKey.localeCompare(right.stableKey)),
      missingKeys: [...mirror.missingKeys].sort(),
      referenceBlockers: mirror.referenceBlockers.map(blocker => ({
        referencingTable: blocker.referencingTable,
        referencingColumn: blocker.referencingColumn,
        referencedColumn: blocker.referencedColumn,
        referencingIds: [...blocker.referencingIds].sort(),
      })),
    })),
  });
}

function authoritativePruneConfirmationToken(mirrors, content) {
  return `${AUTHORITATIVE_PRUNE_CONFIRMATION}:${authoritativePrunePlanDigest(mirrors, content)}`;
}

function publicPruneReport(mode, mirrors, content, deletedByEntity = new Map()) {
  const entities = mirrors.map(mirror => ({
    entityType: mirror.entityType,
    table: mirror.table,
    keyColumn: mirror.keyColumn,
    authoritativeCount: mirror.expectedKeys.size,
    currentCount: mirror.currentRows.length,
    obsoleteCount: mirror.obsoleteRows.length,
    missingCount: mirror.missingKeys.length,
    deletedCount: deletedByEntity.get(mirror.entityType) || 0,
    obsoleteKeys: mirror.obsoleteRows.map(row => String(row[mirror.keyColumn])).sort(),
    missingKeys: mirror.missingKeys,
    referenceBlockers: mirror.referenceBlockers,
  }));
  return {
    mode,
    authoritativeContentDigest: authoritativeContentDigest(content),
    planDigest: authoritativePrunePlanDigest(mirrors, content),
    confirmationToken: authoritativePruneConfirmationToken(mirrors, content),
    entities,
    totals: {
      authoritative: entities.reduce((total, entity) => total + entity.authoritativeCount, 0),
      current: entities.reduce((total, entity) => total + entity.currentCount, 0),
      obsolete: entities.reduce((total, entity) => total + entity.obsoleteCount, 0),
      missing: entities.reduce((total, entity) => total + entity.missingCount, 0),
      deleted: entities.reduce((total, entity) => total + entity.deletedCount, 0),
      blockedReferences: entities.reduce(
        (total, entity) => total + entity.referenceBlockers.reduce((count, blocker) => count + blocker.count, 0),
        0
      ),
    },
  };
}

async function assertAuthoritativeMirrorState(ctx, mirror) {
  const [rows] = await queryWithTimeout(ctx,
    `SELECT id, ${sqlIdentifier(mirror.keyColumn)}
     FROM ${sqlIdentifier(mirror.table)}
     ORDER BY id FOR UPDATE`
  );
  const actualKeys = rows.map(row => String(row[mirror.keyColumn]));
  const actualKeySet = new Set(actualKeys);
  const exact = (
    rows.length === mirror.expectedKeys.size &&
    actualKeySet.size === mirror.expectedKeys.size &&
    [...mirror.expectedKeys].every(key => actualKeySet.has(key))
  );
  if (!exact) {
    throw new Error(
      `Post-prune assertion failed for ${mirror.table}: expected exactly ${mirror.expectedKeys.size} authoritative rows, found ${rows.length}.`
    );
  }
}

async function assertAuthoritativePruneRequestUnused(ctx) {
  const [rows] = await queryWithTimeout(ctx,
    `SELECT id
     FROM audit_log
     WHERE action = ? AND entity_type = ? AND entity_id = ?
     ORDER BY id
     FOR UPDATE`,
    [
      AUTHORITATIVE_PRUNE_COMMIT_ACTION,
      AUTHORITATIVE_PRUNE_COMMIT_ENTITY_TYPE,
      ctx.pruneRequestId,
    ]
  );
  if (rows.length) {
    throw new Error(
      `Authoritative prune request ${ctx.pruneRequestId} already has durable commit evidence; reconcile it instead of reusing the request ID.`
    );
  }
}

async function applyAuthoritativePrune(ctx, mirrors, content) {
  const expectedConfirmation = authoritativePruneConfirmationToken(mirrors, content);
  if (ctx.pruneConfirmation !== expectedConfirmation) {
    throw new Error(
      `Authoritative prune plan changed or was not previewed. Run --prune-dry-run again and use its exact ${AUTHORITATIVE_PRUNE_CONFIRMATION}:<sha256> token.`
    );
  }
  await assertAuthoritativePruneRequestUnused(ctx);
  const missing = mirrors.filter(mirror => mirror.missingKeys.length);
  if (missing.length) {
    throw new Error(
      `Authoritative prune refused because imported mirror rows are missing: ${missing
        .map(mirror => `${mirror.entityType}=${mirror.missingKeys.length}`)
        .join(', ')}.`
    );
  }
  const blocked = mirrors.filter(mirror => mirror.referenceBlockers.length);
  if (blocked.length) {
    throw new Error(
      `Authoritative prune refused because obsolete rows are still referenced: ${blocked
        .map(mirror => `${mirror.entityType}=${mirror.referenceBlockers.reduce((sum, item) => sum + item.count, 0)}`)
        .join(', ')}.`
    );
  }

  const deletedByEntity = new Map();
  for (const mirror of mirrors) {
    let deleted = 0;
    for (const row of mirror.obsoleteRows) {
      const stableKey = String(row[mirror.keyColumn]);
      await queryWithTimeout(ctx,
        `INSERT INTO audit_log
          (actor, action, entity_type, entity_id, before_json, after_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          ctx.pruneActor,
          `content_sync.${mirror.entityType}_pruned`,
          mirror.entityType,
          auditEntityId(stableKey),
          auditJson(row),
          auditJson({
            deleted: true,
            reason: 'absent_from_authoritative_json',
            stable_key: stableKey,
          }),
        ]
      );
    }
    for (const batch of chunks(mirror.obsoleteRows.map(row => row.id))) {
      const [result] = await queryWithTimeout(ctx,
        `DELETE FROM ${sqlIdentifier(mirror.table)} WHERE id IN (?)`,
        [batch]
      );
      if (Number(result.affectedRows) !== batch.length) {
        throw new Error(
          `Prune delete count mismatch for ${mirror.table}: expected ${batch.length}, deleted ${Number(result.affectedRows)}.`
        );
      }
      deleted += Number(result.affectedRows);
    }
    deletedByEntity.set(mirror.entityType, deleted);
  }
  for (const mirror of mirrors) {
    await assertAuthoritativeMirrorState(ctx, mirror);
  }
  return deletedByEntity;
}

function authoritativePruneCommitEvidence(ctx, report) {
  return {
    schema_version: 1,
    evidence_type: 'authoritative_prune_transaction_commit',
    request_id: ctx.pruneRequestId,
    plan_digest: report.planDigest,
    confirmation_token: report.confirmationToken,
    authoritative_content_digest: report.authoritativeContentDigest,
    actor: ctx.pruneActor,
    totals: report.totals,
  };
}

async function insertAuthoritativePruneCommitEvidence(ctx, report) {
  const evidence = authoritativePruneCommitEvidence(ctx, report);
  const [result] = await queryWithTimeout(ctx,
    `INSERT INTO audit_log
      (actor, action, entity_type, entity_id, before_json, after_json)
     VALUES (?, ?, ?, ?, NULL, ?)`,
    [
      ctx.pruneActor,
      AUTHORITATIVE_PRUNE_COMMIT_ACTION,
      AUTHORITATIVE_PRUNE_COMMIT_ENTITY_TYPE,
      ctx.pruneRequestId,
      auditJson(evidence),
    ]
  );
  if (Number(result.affectedRows) !== 1) {
    throw new Error(
      `Authoritative prune commit evidence insert affected ${Number(result.affectedRows)} rows; expected exactly 1.`
    );
  }
  return evidence;
}

async function runAuthoritativePruneApplyPhase(ctx, content, phase) {
  const started = Date.now();
  ctx.currentPhase = phase;
  ctx.logger(`start ${phase}`);
  await startTransactionOrDiscard(ctx, 'START TRANSACTION', phase, {
    preludeSql: 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE',
  });
  try {
    const mirrors = await collectAuthoritativePrunePlan(ctx, content, { lock: true });
    const deletedByEntity = await applyAuthoritativePrune(ctx, mirrors, content);
    const report = publicPruneReport('apply', mirrors, content, deletedByEntity);
    const commitEvidence = await insertAuthoritativePruneCommitEvidence(ctx, report);
    const result = {
      ...report,
      requestId: ctx.pruneRequestId,
      commitEvidence: {
        action: AUTHORITATIVE_PRUNE_COMMIT_ACTION,
        entityType: AUTHORITATIVE_PRUNE_COMMIT_ENTITY_TYPE,
        ...commitEvidence,
      },
    };

    try {
      await queryWithTimeout(ctx, 'COMMIT');
    } catch (cause) {
      const ambiguity = new AuthoritativePruneCommitOutcomeUnknownError(cause, {
        requestId: ctx.pruneRequestId,
        planDigest: report.planDigest,
        confirmationToken: report.confirmationToken,
        phase,
        lastCompletedPhase: ctx.lastCompletedPhase,
      });
      try {
        await ctx.conn.destroy?.();
      } catch {
        // The outcome remains unknown either way; never reuse this connection.
      }
      throw ambiguity;
    }

    ctx.lastCompletedPhase = phase;
    try {
      ctx.logger(`done ${phase} in ${Date.now() - started}ms`);
    } catch {
      // Durable evidence and data are already committed; logging is best-effort.
    }
    return result;
  } catch (err) {
    if (isTransactionOutcomeUnknown(err)) {
      throw err;
    }
    await rollbackTransactionOrThrowUnknown(ctx, err, phase, {
      pruneRequestId: ctx.pruneRequestId,
      prunePlanDigest: ctx.pruneConfirmation?.split(':')[1] || null,
      pruneConfirmationToken: ctx.pruneConfirmation,
    });
    err.importPhase = phase;
    err.lastCompletedPhase = ctx.lastCompletedPhase;
    throw err;
  }
}

async function runAuthoritativePrunePhase(ctx, content, mode) {
  const phase = mode === 'dry-run' ? 'authoritative_prune_dry_run' : 'authoritative_prune';
  if (mode === 'apply') {
    return runAuthoritativePruneApplyPhase(ctx, content, phase);
  }
  return runImportPhase(ctx, phase, null, async () => {
    const mirrors = await collectAuthoritativePrunePlan(ctx, content, { lock: mode === 'apply' });
    return publicPruneReport(mode, mirrors, content);
  });
}

export async function pruneAuthoritativeMirrorContent(conn, content, options = {}) {
  const mode = options.mode || 'dry-run';
  if (options.authoritativeScope !== 'full') {
    throw new Error('Authoritative mirror pruning requires authoritativeScope="full".');
  }
  if (mode !== 'dry-run' && mode !== 'apply') {
    throw new Error(`Unsupported authoritative prune mode: ${mode}`);
  }
  if (mode === 'apply' && !AUTHORITATIVE_PRUNE_CONFIRMATION_PATTERN.test(options.confirmation || '')) {
    throw new Error(
      `Applying authoritative prune requires the exact ${AUTHORITATIVE_PRUNE_CONFIRMATION}:<sha256> token from a dry-run.`
    );
  }
  const pruneRequestId = normalizeAuthoritativePruneRequestId(options.pruneRequestId, {
    generate: mode === 'apply',
  });
  if (mode !== 'apply' && pruneRequestId != null) {
    throw new Error('pruneRequestId is only valid when applying an authoritative prune.');
  }
  assertCompleteAuthoritativePruneDataset(content);
  const ctx = {
    conn,
    logger: typeof options.logger === 'function' ? options.logger : () => {},
    queryTimeoutMs: Number.isFinite(Number(options.queryTimeoutMs)) ? Number(options.queryTimeoutMs) : 30000,
    pruneActor: String(options.actor || 'system:json-authoritative-prune'),
    pruneConfirmation: options.confirmation || null,
    pruneRequestId,
    currentPhase: 'not_started',
    lastCompletedPhase: null,
  };
  await queryWithTimeout(ctx, 'SET SESSION innodb_lock_wait_timeout = 20').catch(() => {});
  return runAuthoritativePrunePhase(ctx, content, mode);
}

export async function importJsonContent(conn, dataDir, options = {}) {
  const scopes = normalizeImportOptions(options);
  const content = loadScopedContent(dataDir, scopes);
  if (scopes.pruneMode !== 'disabled') {
    assertCompleteAuthoritativePruneDataset(content);
  }
  const summary = importSummary(content, scopes);
  const ctx = {
    conn,
    logger: scopes.logger,
    queryTimeoutMs: scopes.queryTimeoutMs,
    sourceCache: new Map(),
    summary,
    pruneActor: scopes.pruneActor,
    pruneConfirmation: scopes.pruneConfirmation,
    pruneRequestId: scopes.pruneRequestId,
    currentPhase: 'not_started',
    lastCompletedPhase: null,
  };

  ctx.logger(`scope ${summary.scope}${summary.file ? ` (${summary.file})` : ''}`);
  await queryWithTimeout(ctx, 'SET SESSION innodb_lock_wait_timeout = 20').catch(() => {});

  try {
    if (scopes.pruneMode === 'dry-run') {
      const prune = await runAuthoritativePrunePhase(ctx, content, 'dry-run');
      ctx.logger('authoritative prune dry-run complete; no content rows were written');
      return {
        ...summary,
        sourcesTouched: 0,
        prune,
        lastCompletedPhase: ctx.lastCompletedPhase,
      };
    }

    const universityCodes = [...new Set(content.colleges.map(c => c.affiliated_to).filter(Boolean))].sort();
    const universityState = new Map();

    if (scopes.colleges) {
      await runImportPhase(ctx, 'universities', universityCodes.length, async () => {
        const statesByCode = new Map();
        for (const college of content.colleges) {
          if (!college.affiliated_to || !college.location?.state) continue;
          if (!statesByCode.has(college.affiliated_to)) statesByCode.set(college.affiliated_to, new Set());
          statesByCode.get(college.affiliated_to).add(college.location.state);
        }
        for (const code of universityCodes) {
          const states = [...(statesByCode.get(code) || [])];
          universityState.set(code, states.length === 1 ? states[0] : null);
          await queryWithTimeout(ctx,
            `INSERT INTO universities (code, name, state, status)
             VALUES (?, ?, ?, 'active')
             ON DUPLICATE KEY UPDATE name = VALUES(name), state = VALUES(state), status = VALUES(status)`,
            [code, code, universityState.get(code)]
          );
        }
      });
    }

    if (scopes.subjects || scopes.branchProfiles || scopes.guides) {
      await runImportPhase(ctx, 'regulations', content.shared.regulations.length, async () => {
        for (const regulation of content.shared.regulations) {
          const sourceId = await upsertSourceWithContext(ctx, {
            origin_url: regulation.source_url ?? null,
            retrieved_date: regulation.last_verified ?? null,
            status: regulation.status === 'unconfirmed' ? 'needs_verification' : 'verified',
          }, 'regulation');
          await queryWithTimeout(ctx,
            `INSERT INTO regulations
              (code, full_name, status, effective_from, branch_groups_json, evaluation_scheme, honors_minor_rules, source_id, last_verified_at, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
              full_name = VALUES(full_name),
              status = VALUES(status),
              effective_from = VALUES(effective_from),
              branch_groups_json = VALUES(branch_groups_json),
              evaluation_scheme = VALUES(evaluation_scheme),
              honors_minor_rules = VALUES(honors_minor_rules),
              source_id = VALUES(source_id),
              last_verified_at = VALUES(last_verified_at),
              notes = VALUES(notes)`,
            [
              regulation.code,
              regulation.full_name,
              regulation.status,
              regulation.effective_from ?? null,
              json(regulation.branch_groups ?? null),
              regulation.evaluation_scheme ?? null,
              regulation.honors_minor_rules ?? null,
              sourceId,
              regulation.last_verified ?? null,
              regulation.notes ?? null,
            ]
          );
        }

        const [regRows] = await queryWithTimeout(ctx, 'SELECT id, code FROM regulations');
        const regulationIdByCode = new Map(regRows.map(row => [row.code, row.id]));
        for (const regulation of content.shared.regulations) {
          await queryWithTimeout(ctx,
            'UPDATE regulations SET supersedes_id = ? WHERE code = ?',
            [regulation.supersedes ? regulationIdByCode.get(regulation.supersedes) ?? null : null, regulation.code]
          );
        }
      });

      await runImportPhase(ctx, 'branches', content.shared.branches.length, async () => {
        for (const branch of content.shared.branches) {
          const sourceId = await upsertSourceWithContext(ctx, branch.source, 'branch');
          await queryWithTimeout(ctx,
            `INSERT INTO branches (code, name, branch_group, specializations_json, status, source_id)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
              name = VALUES(name),
              branch_group = VALUES(branch_group),
              specializations_json = VALUES(specializations_json),
              status = VALUES(status),
              source_id = VALUES(source_id)`,
            [
              branch.code,
              branch.name,
              branch.group ?? null,
              json(branch.specializations ?? []),
              branch.source?.status ?? 'verified',
              sourceId,
            ]
          );
        }
      });
    }

    const refs = await loadReferenceMaps(ctx);

    if (scopes.subjects) {
      await runImportPhase(ctx, 'subjects', content.subjects.length, async () => {
        const phaseStarted = Date.now();
        const subjectRows = [];
        for (const subject of content.subjects) {
          const sourceId = await upsertSourceWithContext(ctx, subject.source, 'subject');
          subjectRows.push([
            subject.id,
            refs.regulationIdByCode.get(subject.regulation) ?? null,
            refs.branchIdByCode.get(subject.branch) ?? null,
            json(subject.branchCodes ?? null),
            subject.specialization ?? null,
            subject.year ?? null,
            subject.semester ?? null,
            subject.year_sem_label ?? null,
            json(subject.offerings ?? null),
            subject.subject_code ?? null,
            subject.name,
            subject.category,
            json(subject.offering_categories ?? null),
            subject.type,
            json(subject.credits ?? null),
            json(subject.units ?? []),
            json(subject.course_outcomes ?? []),
            json(subject.resources ?? {}),
            subject.publication?.mode || 'page',
            subject.publication?.listing_url ?? null,
            subject.seo?.slug ?? subject.id,
            subject.seo?.title ?? null,
            subject.seo?.meta_description ?? null,
            sourceId,
            subject.source?.status ?? 'needs_verification',
            subject.notes ?? null,
          ]);
        }

        let written = 0;
        for (const batch of chunks(subjectRows)) {
          await queryWithTimeout(ctx,
            `INSERT INTO subjects
              (stable_id, regulation_id, branch_id, branch_codes_json, specialization_code, year, semester, year_sem_label,
               offerings_json, subject_code, name, category, offering_categories_json, subject_type, credits_json,
               units_json, course_outcomes_json, resources_json, publication_mode, listing_url,
               seo_slug, seo_title, meta_description, source_id, status, notes)
             VALUES ?
             ON DUPLICATE KEY UPDATE
              regulation_id = VALUES(regulation_id),
              branch_id = VALUES(branch_id),
              branch_codes_json = VALUES(branch_codes_json),
              specialization_code = VALUES(specialization_code),
              year = VALUES(year),
              semester = VALUES(semester),
              year_sem_label = VALUES(year_sem_label),
              offerings_json = VALUES(offerings_json),
              subject_code = VALUES(subject_code),
              name = VALUES(name),
              category = VALUES(category),
              offering_categories_json = VALUES(offering_categories_json),
              subject_type = VALUES(subject_type),
              credits_json = VALUES(credits_json),
              units_json = VALUES(units_json),
              course_outcomes_json = VALUES(course_outcomes_json),
              resources_json = VALUES(resources_json),
              publication_mode = VALUES(publication_mode),
              listing_url = VALUES(listing_url),
              seo_slug = VALUES(seo_slug),
              seo_title = VALUES(seo_title),
              meta_description = VALUES(meta_description),
              source_id = VALUES(source_id),
              status = VALUES(status),
              notes = VALUES(notes)`,
            [batch]
          );
          written += batch.length;
          ctx.logger(`progress subjects ${written}/${subjectRows.length} in ${Date.now() - phaseStarted}ms`);
        }

        const [existingSubjectRows] = await queryWithTimeout(ctx, 'SELECT id, stable_id FROM subjects');
        const subjectIdByStableId = new Map(existingSubjectRows.map(row => [row.stable_id, row.id]));
        const legacyUpdates = content.subjects.map(subject => [
          subject.id,
          subject.legacy_equivalent_id ? subjectIdByStableId.get(subject.legacy_equivalent_id) ?? null : null,
        ]);
        for (const batch of chunks(legacyUpdates)) {
          const caseSql = batch.map(() => 'WHEN ? THEN ?').join(' ');
          const caseValues = batch.flatMap(([stableId, legacyId]) => [stableId, legacyId]);
          const stableIds = batch.map(([stableId]) => stableId);
          await queryWithTimeout(ctx,
            `UPDATE subjects
             SET legacy_subject_id = CASE stable_id ${caseSql} ELSE legacy_subject_id END
             WHERE stable_id IN (?)`,
            [...caseValues, stableIds]
          );
        }
      });
    }

    if (scopes.colleges) {
      await runImportPhase(ctx, 'colleges', content.colleges.length, async () => {
        const phaseStarted = Date.now();
        const refreshedRefs = await loadReferenceMaps(ctx);
        const collegeRows = [];
        for (const college of content.colleges) {
          const sourceId = await upsertSourceWithContext(ctx, college.source, 'college');
          collegeRows.push([
            collegeStableKey(college),
            college.name,
            college.short_code ?? null,
            refreshedRefs.universityIdByCode.get(college.affiliated_to) ?? null,
            college.location?.city ?? null,
            college.location?.district ?? null,
            college.location?.state ?? null,
            college.type ?? null,
            json(college.branches_offered ?? []),
            college.official_website ?? null,
            college.nirf_rank ?? null,
            sourceId,
            college.source?.status ?? 'needs_verification',
          ]);
        }

        let written = 0;
        for (const batch of chunks(collegeRows)) {
          await queryWithTimeout(ctx,
            `INSERT INTO colleges
              (stable_key, name, short_code, university_id, city, district, state, college_type,
               branches_offered_json, official_website, nirf_rank, source_id, status)
             VALUES ?
             ON DUPLICATE KEY UPDATE
              name = VALUES(name),
              short_code = VALUES(short_code),
              university_id = VALUES(university_id),
              city = VALUES(city),
              district = VALUES(district),
              state = VALUES(state),
              college_type = VALUES(college_type),
              branches_offered_json = VALUES(branches_offered_json),
              official_website = VALUES(official_website),
              nirf_rank = VALUES(nirf_rank),
              source_id = VALUES(source_id),
              status = VALUES(status)`,
            [batch]
          );
          written += batch.length;
          ctx.logger(`progress colleges ${written}/${collegeRows.length} in ${Date.now() - phaseStarted}ms`);
        }
      });
    }

    if (scopes.branchProfiles) {
      await runImportPhase(ctx, 'branch_profiles', content.branchProfiles.length, async () => {
        const refreshedRefs = await loadReferenceMaps(ctx);
        for (const profile of content.branchProfiles) {
          const sourceId = await upsertSourceWithContext(ctx, profile.source, 'branch_profile');
          await queryWithTimeout(ctx,
            `INSERT INTO branch_profiles
              (branch_id, branch_code, tagline, core_focus_json, suits_students_who_json,
               less_good_fit_if_json, career_paths_json, further_study_paths_json,
               related_branches_json, data_disclaimer, source_id, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
              branch_id = VALUES(branch_id),
              tagline = VALUES(tagline),
              core_focus_json = VALUES(core_focus_json),
              suits_students_who_json = VALUES(suits_students_who_json),
              less_good_fit_if_json = VALUES(less_good_fit_if_json),
              career_paths_json = VALUES(career_paths_json),
              further_study_paths_json = VALUES(further_study_paths_json),
              related_branches_json = VALUES(related_branches_json),
              data_disclaimer = VALUES(data_disclaimer),
              source_id = VALUES(source_id),
              status = VALUES(status)`,
            [
              refreshedRefs.branchIdByCode.get(profile.branch) ?? null,
              profile.branch,
              profile.tagline,
              json(profile.core_focus ?? []),
              json(profile.suits_students_who ?? []),
              json(profile.less_good_fit_if ?? []),
              json(profile.career_paths ?? []),
              json(profile.further_study_paths ?? []),
              json(profile.related_branches ?? []),
              profile.data_disclaimer ?? null,
              sourceId,
              profile.source?.status ?? 'needs_verification',
            ]
          );
        }
      });
    }

    if (scopes.guides) {
      await runImportPhase(ctx, 'guides', content.guides.length, async () => {
        const refreshedRefs = await loadReferenceMaps(ctx);
        for (const guide of content.guides) {
          const sourceId = await upsertSourceWithContext(ctx, guide.source, 'guide');
          await queryWithTimeout(ctx,
            `INSERT INTO guides
              (stable_id, regulation_id, name, intro, aliases_json, sections_json,
               seo_slug, seo_title, meta_description, source_id, status, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
              regulation_id = VALUES(regulation_id),
              name = VALUES(name),
              intro = VALUES(intro),
              aliases_json = VALUES(aliases_json),
              sections_json = VALUES(sections_json),
              seo_slug = VALUES(seo_slug),
              seo_title = VALUES(seo_title),
              meta_description = VALUES(meta_description),
              source_id = VALUES(source_id),
              status = VALUES(status),
              notes = VALUES(notes)`,
            [
              guide.id,
              refreshedRefs.regulationIdByCode.get(guide.regulation) ?? null,
              guide.name,
              guide.intro ?? null,
              json(guide.aliases ?? []),
              json(guide.sections ?? []),
              guide.seo?.slug ?? guide.id,
              guide.seo?.title ?? guide.name,
              guide.seo?.meta_description ?? '',
              sourceId,
              guide.source?.status ?? 'needs_verification',
              guide.notes ?? null,
            ]
          );
        }
      });
    }

    const prune = scopes.pruneMode === 'apply'
      ? await runAuthoritativePrunePhase(ctx, content, 'apply')
      : null;

    try {
      ctx.logger('import complete');
    } catch {
      // All selected phases (including any authoritative prune) are already
      // committed. A best-effort progress logger must not change that outcome.
    }
    return {
      ...summary,
      sourcesTouched: ctx.summary.sourcesTouched,
      ...(prune ? { prune } : {}),
      lastCompletedPhase: ctx.lastCompletedPhase,
    };
  } catch (err) {
    err.currentPhase = ctx.currentPhase;
    err.lastCompletedPhase = ctx.lastCompletedPhase;
    throw err;
  }
}

export async function exportDbContent(conn) {
  const [regRows] = await conn.query(`
    SELECT r.*, s.origin_url, s.retrieved_at
    FROM regulations r
    LEFT JOIN sources s ON s.id = r.source_id
    ORDER BY r.code
  `);
  const regCodeById = new Map(regRows.map(row => [row.id, row.code]));
  const regulations = regRows.map(row => stripNullish({
    code: row.code,
    full_name: row.full_name,
    effective_from: row.effective_from,
    status: row.status,
    supersedes: row.supersedes_id ? regCodeById.get(row.supersedes_id) ?? null : null,
    branch_groups: parseJson(row.branch_groups_json, undefined),
    evaluation_scheme: row.evaluation_scheme ?? undefined,
    honors_minor_rules: row.honors_minor_rules ?? undefined,
    source_url: row.origin_url ?? null,
    last_verified: dateOnly(row.last_verified_at),
    notes: row.notes ?? null,
  }));

  const [branchRows] = await conn.query(`
    SELECT b.*, s.origin_url, s.retrieved_at, s.caveat_text
    FROM branches b
    LEFT JOIN sources s ON s.id = b.source_id
    ORDER BY b.code
  `);
  const branches = branchRows.map(row => stripNullish({
    code: row.code,
    name: row.name,
    group: row.branch_group,
    specializations: parseJson(row.specializations_json, []),
    source: sourceFromRow(row, row.status),
  }));

  const [subjectRows] = await conn.query(`
    SELECT su.*, r.code AS regulation_code, b.code AS branch_code, legacy.stable_id AS legacy_stable_id,
      src.origin_url, src.retrieved_at, src.caveat_text
    FROM subjects su
    LEFT JOIN regulations r ON r.id = su.regulation_id
    LEFT JOIN branches b ON b.id = su.branch_id
    LEFT JOIN subjects legacy ON legacy.id = su.legacy_subject_id
    LEFT JOIN sources src ON src.id = su.source_id
    ORDER BY b.code, su.year, su.semester, su.stable_id
  `);
  const subjects = subjectRows.map(row => {
    const offerings = parseJson(row.offerings_json, null);
    const branchCodes = parseJson(row.branch_codes_json, null);
    return stripNullish({
      id: row.stable_id,
      regulation: row.regulation_code,
      branch: offerings ? undefined : (row.branch_code ?? (branchCodes?.length ? null : undefined)),
      branchCodes: offerings ? undefined : (branchCodes?.length ? branchCodes : undefined),
      offerings: offerings || undefined,
      specialization: row.specialization_code ?? undefined,
      year: offerings ? undefined : row.year,
      semester: offerings ? undefined : row.semester,
      year_sem_label: offerings ? undefined : row.year_sem_label,
      subject_code: row.subject_code,
      name: row.name,
      category: row.category,
      offering_categories: parseJson(row.offering_categories_json, undefined),
      credits: offerings ? undefined : parseJson(row.credits_json, null),
      type: row.subject_type,
      units: parseJson(row.units_json, []),
      course_outcomes: parseJson(row.course_outcomes_json, []),
      resources: parseJson(row.resources_json, {}),
      publication: row.publication_mode === 'listing_only'
        ? { mode: 'listing_only', listing_url: row.listing_url ?? null }
        : undefined,
      seo: {
        slug: row.seo_slug,
        title: row.seo_title,
        meta_description: row.meta_description,
      },
      legacy_equivalent_id: row.legacy_stable_id ?? undefined,
      source: sourceFromRow(row, row.status),
      notes: row.notes ?? null,
    });
  });

  const [collegeRows] = await conn.query(`
    SELECT c.*, u.code AS university_code, src.origin_url, src.retrieved_at, src.caveat_text
    FROM colleges c
    LEFT JOIN universities u ON u.id = c.university_id
    LEFT JOIN sources src ON src.id = c.source_id
    ORDER BY u.code, c.name
  `);
  const colleges = collegeRows.map(row => ({
    name: row.name,
    short_code: row.short_code,
    affiliated_to: row.university_code,
    location: {
      city: row.city,
      district: row.district,
      state: row.state,
    },
    type: row.college_type,
    branches_offered: parseJson(row.branches_offered_json, []),
    official_website: row.official_website,
    nirf_rank: row.nirf_rank,
    source: sourceFromRow(row, row.status),
  }));

  const [profileRows] = await conn.query(`
    SELECT bp.*, src.origin_url, src.retrieved_at, src.caveat_text
    FROM branch_profiles bp
    LEFT JOIN sources src ON src.id = bp.source_id
    ORDER BY bp.branch_code
  `);
  const branchProfiles = profileRows.map(row => ({
    branch: row.branch_code,
    tagline: row.tagline,
    core_focus: parseJson(row.core_focus_json, []),
    suits_students_who: parseJson(row.suits_students_who_json, []),
    less_good_fit_if: parseJson(row.less_good_fit_if_json, []),
    career_paths: parseJson(row.career_paths_json, []),
    further_study_paths: parseJson(row.further_study_paths_json, []),
    related_branches: parseJson(row.related_branches_json, []),
    data_disclaimer: row.data_disclaimer,
    source: sourceFromRow(row, row.status),
  }));

  const [guideRows] = await conn.query(`
    SELECT g.*, r.code AS regulation_code, src.origin_url, src.retrieved_at, src.caveat_text
    FROM guides g
    LEFT JOIN regulations r ON r.id = g.regulation_id
    LEFT JOIN sources src ON src.id = g.source_id
    ORDER BY g.stable_id
  `);
  const guides = guideRows.map(row => stripNullish({
    id: row.stable_id,
    regulation: row.regulation_code,
    name: row.name,
    intro: row.intro ?? undefined,
    aliases: parseJson(row.aliases_json, []),
    sections: parseJson(row.sections_json, []),
    seo: {
      slug: row.seo_slug,
      title: row.seo_title,
      meta_description: row.meta_description,
    },
    source: sourceFromRow(row, row.status),
    notes: row.notes ?? null,
  }));

  return {
    shared: { regulations, branches },
    subjects,
    colleges,
    branchProfiles,
    guides,
  };
}

export function writeExportedJson(content, outDir) {
  const dataDir = path.join(outDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'shared.json'), `${JSON.stringify(content.shared, null, 2)}\n`);
  fs.writeFileSync(path.join(dataDir, 'branch-guide-data.json'), `${JSON.stringify({ branch_profiles: content.branchProfiles }, null, 2)}\n`);
  fs.writeFileSync(path.join(dataDir, 'guides.json'), `${JSON.stringify({ guides: content.guides || [] }, null, 2)}\n`);

  const subjectsByBranch = groupBy(content.subjects, subject => {
    if (subject.offerings?.some(offering => offering.year === 1) || subject.year === 1) return 'first-year';
    const idBranch = String(subject.id || '').match(/^r\d+-([a-z]+)-/)?.[1];
    return String(subject.branch || idBranch || subject.branchCodes?.[0] || 'unknown').toLowerCase();
  });
  for (const [branch, subjects] of [...subjectsByBranch.entries()].sort()) {
    fs.writeFileSync(path.join(dataDir, `subjects-${branch}.json`), `${JSON.stringify({ subjects }, null, 2)}\n`);
  }

  const collegesByCampus = groupBy(content.colleges, college => college.affiliated_to || 'unknown');
  for (const [code, colleges] of [...collegesByCampus.entries()].sort()) {
    fs.writeFileSync(path.join(dataDir, campusFileName(code)), `${JSON.stringify({ colleges }, null, 2)}\n`);
  }

  return dataDir;
}

export function dbContentToSearchDocs(content) {
  return buildSearchIndex({
    subjects: content.subjects,
    branches: content.shared?.branches || content.branches || [],
    colleges: content.colleges,
    branchProfiles: content.branchProfiles,
    guides: content.guides || [],
  });
}

export function parityReport(jsonContent, dbContent) {
  const jsonSearchDocs = dbContentToSearchDocs({
    subjects: jsonContent.subjects,
    branches: jsonContent.shared?.branches || [],
    colleges: jsonContent.colleges,
    branchProfiles: jsonContent.branchProfiles,
    guides: jsonContent.guides || [],
  });
  const dbSearchDocs = dbContentToSearchDocs(dbContent);

  const checks = [];
  const add = (name, ok, details = '') => checks.push({ name, ok, details });
  const jsonVerifiedSubjects = jsonContent.subjects.filter(s => s.source?.status === 'verified').length;
  const dbVerifiedSubjects = dbContent.subjects.filter(s => s.source?.status === 'verified').length;
  const dbPageSubjects = dbContent.subjects.filter(s => s.source?.status === 'verified' && (s.publication?.mode || 'page') === 'page').length;
  const dbListingSubjects = dbContent.subjects.filter(s => s.source?.status === 'verified' && s.publication?.mode === 'listing_only').length;

  add('subject count', dbContent.subjects.length === EXPECTED_PARITY_COUNTS.subjects && dbContent.subjects.length === jsonContent.subjects.length, `${dbContent.subjects.length}`);
  add('verified subject count', dbVerifiedSubjects === EXPECTED_PARITY_COUNTS.verifiedSubjects && dbVerifiedSubjects === jsonVerifiedSubjects, `${dbVerifiedSubjects}`);
  add('subject page count', dbPageSubjects === EXPECTED_PARITY_COUNTS.subjectPages, `${dbPageSubjects}`);
  add('listing-only subject count', dbListingSubjects === EXPECTED_PARITY_COUNTS.listingSubjects, `${dbListingSubjects}`);
  add('college count', dbContent.colleges.length === EXPECTED_PARITY_COUNTS.colleges && dbContent.colleges.length === jsonContent.colleges.length, `${dbContent.colleges.length}`);
  add('branch profile count', dbContent.branchProfiles.length === EXPECTED_PARITY_COUNTS.branchProfiles && dbContent.branchProfiles.length === jsonContent.branchProfiles.length, `${dbContent.branchProfiles.length}`);
  add('guide count', (dbContent.guides || []).length === EXPECTED_PARITY_COUNTS.guides && (dbContent.guides || []).length === (jsonContent.guides || []).length, `${(dbContent.guides || []).length}`);
  add('search index doc count', dbSearchDocs.length === EXPECTED_PARITY_COUNTS.searchDocs && dbSearchDocs.length === jsonSearchDocs.length, `${dbSearchDocs.length}`);

  for (const slug of REPRESENTATIVE_SUBJECT_SLUGS) {
    const jsonSubject = jsonContent.subjects.find(s => s.seo?.slug === slug);
    const dbSubject = dbContent.subjects.find(s => s.seo?.slug === slug);
    add(`subject slug ${slug}`, Boolean(jsonSubject && dbSubject && jsonSubject.source?.status === dbSubject.source?.status), dbSubject?.source?.status || 'missing');
  }

  for (const branch of REPRESENTATIVE_BRANCHES) {
    const jsonProfile = jsonContent.branchProfiles.find(p => p.branch === branch);
    const dbProfile = dbContent.branchProfiles.find(p => p.branch === branch);
    add(`branch profile ${branch}`, Boolean(jsonProfile && dbProfile && jsonProfile.source?.status === dbProfile.source?.status), dbProfile?.source?.status || 'missing');
  }

  for (const code of REPRESENTATIVE_COLLEGE_CODES) {
    const jsonCount = jsonContent.colleges.filter(c => c.affiliated_to === code).length;
    const dbCount = dbContent.colleges.filter(c => c.affiliated_to === code).length;
    add(`college campus ${code}`, jsonCount > 0 && jsonCount === dbCount, `${dbCount}`);
  }

  return {
    ok: checks.every(check => check.ok),
    checks,
    counts: {
      json: {
        subjects: jsonContent.subjects.length,
        verifiedSubjects: jsonVerifiedSubjects,
        colleges: jsonContent.colleges.length,
        branchProfiles: jsonContent.branchProfiles.length,
        guides: (jsonContent.guides || []).length,
        searchDocs: jsonSearchDocs.length,
      },
      db: {
        subjects: dbContent.subjects.length,
        verifiedSubjects: dbVerifiedSubjects,
        colleges: dbContent.colleges.length,
        branchProfiles: dbContent.branchProfiles.length,
        guides: (dbContent.guides || []).length,
        searchDocs: dbSearchDocs.length,
      },
    },
  };
}
