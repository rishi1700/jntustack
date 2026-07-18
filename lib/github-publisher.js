import crypto from 'node:crypto';
import path from 'node:path';
import { getGitHubPublicationTrustReady } from './config.js';
import { getDbPool } from './db.js';
import { createGitHubAppClientFromEnv } from './github-app-client.js';
import { generateReleaseReviewSummary } from './release-review.js';
import { acquireReleasePublicationLock } from './release-publication-lock.js';

export const CREATE_REVIEW_PR_CONFIRMATION = 'CREATE REVIEW PR';
export const PUBLICATION_ARTIFACT_SCHEMA_VERSION = 1;
export const PUBLICATION_MANIFEST_MAX_BYTES = 2 * 1024 * 1024;
export const GITHUB_PUBLICATION_STATUSES = Object.freeze([
  'preparing',
  'pr_open',
  'blocked_stale_base',
  'tampered',
  'ci_failed',
  'closed_unmerged',
  'deploy_pending',
  'deployed',
  'verification_inconclusive',
  'verification_failed',
  'superseded',
  'failed',
]);

const GITHUB_PUBLICATION_STATUS_SET = new Set(GITHUB_PUBLICATION_STATUSES);

const FAILURE_CHECK_CONCLUSIONS = new Set([
  'action_required',
  'cancelled',
  'failure',
  'stale',
  'timed_out',
]);

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(item => canonicalValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .filter(key => value[key] !== undefined)
        .sort()
        .map(key => [key, canonicalValue(value[key])])
    );
  }
  return value;
}

function normalizePem(value, label) {
  const raw = clean(value);
  if (!raw) throw new PublicationStateError(`${label} is required.`, 'publication_signing_unavailable');
  if (raw.includes('BEGIN') || raw.includes('\\n')) return raw.replaceAll('\\n', '\n');
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    if (decoded.includes('BEGIN')) return decoded;
  } catch {
    // Fall through to the explicit configuration error below.
  }
  throw new PublicationStateError(`${label} must be PEM or base64-encoded PEM.`, 'publication_signing_unavailable');
}

function normalizeSigningKeyId(value) {
  const keyId = clean(value);
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId)) {
    throw new PublicationStateError(
      'PUBLICATION_SIGNING_KEY_ID must use 1-64 letters, numbers, dots, underscores, or hyphens.',
      'publication_signing_unavailable'
    );
  }
  return keyId;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function canonicalPrettyJson(value) {
  return `${JSON.stringify(canonicalValue(value), null, 2)}\n`;
}

export function hashPublicationValue(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sameJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function assertSafeDataFile(file) {
  const raw = typeof file === 'string' ? file : '';
  const normalized = raw.replaceAll('\\', '/');
  if (
    !normalized
    || normalized !== raw
    || normalized !== raw.trim()
    || normalized.length > 1024
    || path.posix.normalize(normalized) !== normalized
    || !/^data\/[A-Za-z0-9._/-]+$/.test(normalized)
    || ['data/release.json', 'data/release-artifact.json'].includes(normalized)
  ) {
    throw new PublicationStateError(`Unsafe publication file: ${file}`, 'unsafe_publication_file');
  }
  return normalized;
}

function collectionForChange(plan, change) {
  const patch = (plan.combined_patch || []).find(candidate =>
    Number(candidate.proposal_id) === Number(change.proposal_id) && candidate.file === change.file
  );
  if (patch?.collection) return patch.collection;
  if (change.entity_type === 'subject') return 'subjects';
  if (change.entity_type === 'college') return 'colleges';
  if (change.entity_type === 'branch_profile') return 'branch_profiles';
  if (change.entity_type === 'guide') return 'guides';
  throw new PublicationStateError(
    `Cannot determine collection for change ${change.order || change.proposal_id || '(unknown)'}.`,
    'invalid_apply_plan'
  );
}

function replayFile(rawBuffer, fileChanges, plan) {
  let document;
  try {
    document = JSON.parse(rawBuffer.toString('utf8'));
  } catch (err) {
    throw new PublicationStateError(`Target JSON cannot be parsed: ${err.message}`, 'stale_base');
  }

  for (const change of fileChanges) {
    const collection = collectionForChange(plan, change);
    const target = document[collection];
    if (!Array.isArray(target)) {
      throw new PublicationStateError(`Target file has no ${collection} array.`, 'stale_base');
    }
    const index = Number(change.index);
    if (!Number.isInteger(index) || index < 0) {
      throw new PublicationStateError(`Invalid apply-plan index for ${change.file}.`, 'invalid_apply_plan');
    }

    if (change.operation === 'add') {
      if (change.before_json != null || index !== target.length) {
        throw new PublicationStateError(
          `Add target for ${change.entity_key || change.proposal_id} changed after review.`,
          'stale_base'
        );
      }
      target.push(change.after_json);
      continue;
    }

    if (change.operation === 'replace') {
      if (index >= target.length || !sameJson(target[index], change.before_json)) {
        throw new PublicationStateError(
          `Replacement target for ${change.entity_key || change.proposal_id} changed after review.`,
          'stale_base'
        );
      }
      target[index] = change.after_json;
      continue;
    }

    throw new PublicationStateError(`Unsupported operation ${change.operation}.`, 'invalid_apply_plan');
  }

  return Buffer.from(`${JSON.stringify(document, null, 2)}\n`);
}

function fileHashMap(files, field) {
  return Object.fromEntries(files.map(file => [file.path, file[field]]));
}

function assertPlanReady(plan, releaseCandidateId) {
  if (!plan || Number(plan.release_candidate_id) !== Number(releaseCandidateId)) {
    throw new PublicationStateError('Stored apply plan does not match the release candidate.', 'invalid_apply_plan');
  }
  if ((plan.final_warnings || []).length > 0) {
    throw new PublicationStateError('Apply plan contains blocking warnings.', 'invalid_apply_plan');
  }
  if (!Array.isArray(plan.changes) || plan.changes.length === 0) {
    throw new PublicationStateError('Apply plan has no reviewed changes.', 'invalid_apply_plan');
  }
}

export class PublicationStateError extends Error {
  constructor(message, code = 'publication_state_error') {
    super(message);
    this.name = 'PublicationStateError';
    this.code = code;
  }
}

export function buildPublicationArtifact({ releaseCandidateId, baseSha, plan, snapshot }) {
  assertPlanReady(plan, releaseCandidateId);
  if (!snapshot?.headSha || snapshot.headSha !== baseSha || !(snapshot.files instanceof Map)) {
    throw new PublicationStateError('A complete default-branch snapshot is required.', 'stale_base');
  }

  const changesByFile = new Map();
  for (const change of plan.changes) {
    const file = assertSafeDataFile(change.file);
    if (!changesByFile.has(file)) changesByFile.set(file, []);
    changesByFile.get(file).push(change);
  }

  const files = [];
  for (const [filePath, changes] of [...changesByFile].sort(([left], [right]) => left.localeCompare(right))) {
    const source = snapshot.files.get(filePath);
    if (!source?.buffer) {
      throw new PublicationStateError(`Reviewed target is missing from the default branch: ${filePath}.`, 'stale_base');
    }
    const afterBuffer = replayFile(source.buffer, changes, plan);
    files.push({
      path: filePath,
      beforeSha256: hashPublicationValue(source.buffer),
      afterSha256: hashPublicationValue(afterBuffer),
      beforeSize: source.buffer.length,
      afterSize: afterBuffer.length,
      beforeBuffer: source.buffer,
      afterBuffer,
    });
  }

  const payload = {
    schema_version: PUBLICATION_ARTIFACT_SCHEMA_VERSION,
    release_candidate_id: Number(releaseCandidateId),
    base_sha: baseSha,
    files: files.map(file => ({
      path: file.path,
      before_sha256: file.beforeSha256,
      after_sha256: file.afterSha256,
      before_size: file.beforeSize,
      after_size: file.afterSize,
    })),
    patch: plan.combined_patch || plan.changes.map(change => ({
      file: change.file,
      operation: change.operation,
      index: change.index,
      entity_type: change.entity_type,
      entity_key: change.entity_key,
      after_json: change.after_json,
    })),
    validation: plan.validation_summary || [],
  };
  const artifactHash = hashPublicationValue(canonicalJson(payload));
  return {
    schemaVersion: PUBLICATION_ARTIFACT_SCHEMA_VERSION,
    releaseCandidateId: Number(releaseCandidateId),
    baseSha,
    payload,
    artifactHash,
    beforeFileHashes: fileHashMap(files, 'beforeSha256'),
    afterFileHashes: fileHashMap(files, 'afterSha256'),
    files,
  };
}

export function publicationBranchName(releaseCandidateId, artifactHash) {
  const id = Number(releaseCandidateId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Release candidate ID must be a positive integer.');
  if (!/^[a-f0-9]{64}$/.test(artifactHash)) throw new Error('Artifact hash must be a SHA-256 digest.');
  // The complete digest anchors the CI manifest to the branch name. A short
  // prefix would leave publication integrity dependent on truncated-hash
  // collision resistance.
  return `jntustack/rc-${id}-${artifactHash}`;
}

export function publicationIdempotencyKey(releaseCandidateId, artifactHash) {
  return hashPublicationValue(`github-publication:v1\0${Number(releaseCandidateId)}\0${artifactHash}`);
}

export function releaseMarker({ releaseCandidateId, artifactHash }) {
  return {
    schema_version: PUBLICATION_ARTIFACT_SCHEMA_VERSION,
    release_id: Number(releaseCandidateId),
    artifact_hash: artifactHash,
  };
}

export function unsignedPublicationArtifactManifest({
  artifactHash,
  branchName,
  repositoryFullName,
  defaultBranch,
  payload,
  signingKeyId,
}) {
  if (!/^[a-f0-9]{64}$/.test(clean(artifactHash))) {
    throw new PublicationStateError('Publication manifest requires a valid artifact hash.', 'invalid_apply_plan');
  }
  if (hashPublicationValue(canonicalJson(payload)) !== artifactHash) {
    throw new PublicationStateError('Publication manifest payload does not match its artifact hash.', 'tampered');
  }
  const repository = clean(repositoryFullName);
  const branch = clean(branchName);
  const baseBranch = clean(defaultBranch);
  const keyId = normalizeSigningKeyId(signingKeyId);
  if (!repository.includes('/') || !branch || !baseBranch) {
    throw new PublicationStateError('Publication manifest repository and branch identity are required.', 'invalid_apply_plan');
  }
  return {
    schema_version: PUBLICATION_ARTIFACT_SCHEMA_VERSION,
    artifact_hash: artifactHash,
    branch_name: branch,
    repository_full_name: repository,
    default_branch: baseBranch,
    payload,
    authorization: {
      algorithm: 'RS256',
      key_id: keyId,
    },
  };
}

export function publicationArtifactManifest(input) {
  const unsigned = unsignedPublicationArtifactManifest(input);
  let privateKey;
  try {
    privateKey = crypto.createPrivateKey(normalizePem(input.signingPrivateKey, 'Publication signing private key'));
  } catch (err) {
    if (err instanceof PublicationStateError) throw err;
    throw new PublicationStateError(`Publication signing private key is invalid: ${err.message}`, 'publication_signing_unavailable');
  }
  if (privateKey.asymmetricKeyType !== 'rsa' || Number(privateKey.asymmetricKeyDetails?.modulusLength || 0) < 2048) {
    throw new PublicationStateError(
      'Publication signing private key must be an RSA key of at least 2048 bits.',
      'publication_signing_unavailable'
    );
  }
  const signature = crypto.sign(
    'RSA-SHA256',
    Buffer.from(canonicalJson(unsigned)),
    privateKey
  ).toString('base64');
  return {
    ...unsigned,
    authorization: {
      ...unsigned.authorization,
      signature,
    },
  };
}

export function publicationArtifactManifestBuffer(input) {
  const buffer = Buffer.from(canonicalPrettyJson(publicationArtifactManifest(input)));
  if (buffer.length > PUBLICATION_MANIFEST_MAX_BYTES) {
    throw new PublicationStateError(
      `Publication manifest exceeds the ${PUBLICATION_MANIFEST_MAX_BYTES}-byte review limit. Split the release into smaller batches.`,
      'publication_manifest_too_large'
    );
  }
  return buffer;
}

export function markerBuffer(input) {
  return Buffer.from(canonicalPrettyJson(releaseMarker(input)));
}

function publicationFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    releaseCandidateId: row.release_candidate_id,
    releaseApplyPlanId: row.release_apply_plan_id,
    idempotencyKey: row.idempotency_key,
    artifactSchemaVersion: row.artifact_schema_version,
    artifactHash: row.artifact_hash,
    baseSha: row.base_sha,
    manifestSha256: row.manifest_sha256,
    manifestBase64: row.manifest_base64,
    signingKeyId: row.signing_key_id,
    repositoryFullName: row.repository_full_name,
    defaultBranch: row.default_branch,
    branchName: row.branch_name,
    headSha: row.head_sha,
    mergeSha: row.merge_sha,
    pullRequestNumber: row.pr_number,
    pullRequestUrl: row.pr_url,
    status: row.status,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    verification: parseJson(row.verification_json, null),
    lastVerificationAttempt: parseJson(row.last_verification_attempt_json, null),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pullRequestCreatedAt: row.pr_created_at,
    mergedAt: row.merged_at,
    lastCheckedAt: row.last_checked_at,
    verifiedAt: row.verified_at,
  };
}

export function githubPublicationActionAllowed(status, action) {
  const normalizedStatus = clean(status).toLowerCase();
  const normalizedAction = clean(action).toLowerCase();
  if (!GITHUB_PUBLICATION_STATUS_SET.has(normalizedStatus)) return false;
  if (normalizedAction === 'refresh') {
    return ['pr_open', 'ci_failed'].includes(normalizedStatus);
  }
  if (normalizedAction === 'verify_deployment') {
    return ['deploy_pending', 'verification_inconclusive', 'verification_failed', 'deployed'].includes(normalizedStatus);
  }
  if (normalizedAction === 'retry') {
    return ['preparing', 'failed'].includes(normalizedStatus);
  }
  return false;
}

async function audit(db, { actor, action, entityId, before = null, after = null }) {
  await db.execute(
    `INSERT INTO audit_log
      (actor, action, entity_type, entity_id, before_json, after_json)
     VALUES (?, ?, 'github_publication', ?, ?, ?)`,
    [
      actor,
      entityId == null ? null : String(entityId),
      before == null ? null : JSON.stringify(before),
      after == null ? null : JSON.stringify(after),
    ]
  );
}

async function loadReleasePlan(db, releaseCandidateId) {
  const [rows] = await db.execute(
    `SELECT
       rc.id AS release_candidate_id,
       rc.title AS release_title,
       rc.status AS release_status,
       rc.publication_mode,
       rap.id AS release_apply_plan_id,
       rap.plan_payload_json,
       rap.artifact_schema_version,
       rap.base_git_sha,
       rap.artifact_hash,
       rap.before_file_hashes_json,
       rap.after_file_hashes_json,
       rap.artifact_payload_json
     FROM release_candidates rc
     LEFT JOIN release_apply_plans rap ON rap.release_candidate_id = rc.id
     WHERE rc.id = ?
     LIMIT 1`,
    [releaseCandidateId]
  );
  const row = rows[0];
  if (!row) throw new PublicationStateError(`Release candidate not found: ${releaseCandidateId}.`, 'not_found');
  if (!row.release_apply_plan_id) throw new PublicationStateError('Release candidate has no durable apply plan.', 'invalid_apply_plan');
  return {
    row,
    plan: parseJson(row.plan_payload_json, null),
    beforeFileHashes: parseJson(row.before_file_hashes_json, null),
    afterFileHashes: parseJson(row.after_file_hashes_json, null),
  };
}

async function loadPublication(db, publicationId) {
  const [rows] = await db.execute('SELECT * FROM github_publications WHERE id = ? LIMIT 1', [publicationId]);
  return publicationFromRow(rows[0]);
}

async function loadPublicationForRelease(db, releaseCandidateId) {
  const [rows] = await db.execute(
    `SELECT * FROM github_publications
     WHERE release_candidate_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [releaseCandidateId]
  );
  return publicationFromRow(rows[0]);
}

async function listPublicationRows(db, { statuses = [], limit = 100 } = {}) {
  const statusValues = Array.isArray(statuses) ? statuses : [statuses];
  const normalizedStatuses = [...new Set(statusValues.map(status => clean(status).toLowerCase()).filter(Boolean))];
  for (const status of normalizedStatuses) {
    if (!GITHUB_PUBLICATION_STATUS_SET.has(status)) {
      throw new Error(`Unsupported GitHub publication status: ${status}.`);
    }
  }
  const parsedLimit = Number(limit);
  if (!Number.isSafeInteger(parsedLimit) || parsedLimit <= 0 || parsedLimit > 500) {
    throw new Error('Publication list limit must be an integer from 1 to 500.');
  }
  const where = normalizedStatuses.length
    ? `WHERE gp.status IN (${normalizedStatuses.map(() => '?').join(', ')})`
    : '';
  const [rows] = await db.execute(
    `SELECT gp.*, rc.title AS release_title
     FROM github_publications gp
     INNER JOIN release_candidates rc ON rc.id = gp.release_candidate_id
     ${where}
     ORDER BY gp.updated_at DESC, gp.id DESC
     LIMIT ?`,
    [...normalizedStatuses, parsedLimit]
  );
  return rows.map(row => ({ ...publicationFromRow(row), releaseTitle: row.release_title }));
}

async function publicationDatabase(db) {
  return db || getDbPool({ requireConfigured: true });
}

function githubRepositoryFullName(github) {
  return clean(github?.repositoryFullName || `${clean(github?.owner)}/${clean(github?.repo)}`)
    .replace(/^\/+|\/+$/g, '');
}

function pullRequestIdentityError(pullRequest, publication) {
  if (!pullRequest) return 'GitHub did not return the publication pull request.';
  if (pullRequest.head?.ref !== publication.branchName) {
    return 'Pull request head branch does not match the sealed publication branch.';
  }
  if (!pullRequest.head?.sha || pullRequest.head.sha !== publication.headSha) {
    return 'Pull request head commit does not match the sealed publication commit.';
  }
  if (pullRequest.base?.ref !== publication.defaultBranch) {
    return 'Pull request base branch does not match the sealed default branch.';
  }
  const expectedRepository = clean(publication.repositoryFullName).toLowerCase();
  const headRepository = clean(pullRequest.head?.repo?.full_name).toLowerCase();
  const baseRepository = clean(pullRequest.base?.repo?.full_name).toLowerCase();
  if (!expectedRepository || headRepository !== expectedRepository || baseRepository !== expectedRepository) {
    return 'Pull request repository identity does not match the sealed publication repository.';
  }
  return null;
}

export async function getGitHubPublication(publicationId, { db = null } = {}) {
  return loadPublication(await publicationDatabase(db), publicationId);
}

export async function getGitHubPublicationForRelease(releaseCandidateId, { db = null } = {}) {
  return loadPublicationForRelease(await publicationDatabase(db), releaseCandidateId);
}

export async function listGitHubPublications({ statuses = [], limit = 100, db = null } = {}) {
  return listPublicationRows(await publicationDatabase(db), { statuses, limit });
}

async function updatePublication(db, publicationId, fields) {
  const columns = {
    status: 'status',
    headSha: 'head_sha',
    mergeSha: 'merge_sha',
    pullRequestNumber: 'pr_number',
    pullRequestUrl: 'pr_url',
    lastError: 'last_error',
    verification: 'verification_json',
    lastVerificationAttempt: 'last_verification_attempt_json',
    pullRequestCreatedAt: 'pr_created_at',
    mergedAt: 'merged_at',
    lastCheckedAt: 'last_checked_at',
    verifiedAt: 'verified_at',
  };
  const assignments = [];
  const values = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!columns[key]) continue;
    assignments.push(`${columns[key]} = ?`);
    values.push(['verification', 'lastVerificationAttempt'].includes(key) && value != null ? JSON.stringify(value) : value);
  }
  if (!assignments.length) return loadPublication(db, publicationId);
  values.push(publicationId);
  await db.execute(
    `UPDATE github_publications
     SET ${assignments.join(', ')}
     WHERE id = ?`,
    values
  );
  return loadPublication(db, publicationId);
}

async function mutatePublicationWithAudit(db, {
  publicationId = null,
  actor,
  action,
  mutate,
  auditAfter = publication => publication,
}) {
  if (
    typeof db?.beginTransaction !== 'function'
    || typeof db?.commit !== 'function'
    || typeof db?.rollback !== 'function'
  ) {
    throw new Error('Publication lifecycle mutations require a dedicated database connection.');
  }
  if (typeof mutate !== 'function') throw new TypeError('Publication mutation callback is required.');

  await db.beginTransaction();
  try {
    let lockedPublication = null;
    if (publicationId != null) {
      const [beforeRows] = await db.execute(
        'SELECT * FROM github_publications WHERE id = ? LIMIT 1 FOR UPDATE',
        [publicationId]
      );
      lockedPublication = publicationFromRow(beforeRows[0]);
      if (!lockedPublication) {
        throw new PublicationStateError(`GitHub publication not found: ${publicationId}.`, 'not_found');
      }
    }

    const publication = await mutate(db, lockedPublication);
    if (!publication?.id) throw new Error('Publication lifecycle mutation did not return a publication row.');
    await audit(db, {
      actor,
      action,
      entityId: publication.id,
      after: auditAfter(publication),
    });
    await db.commit();
    return publication;
  } catch (err) {
    try {
      await db.rollback();
    } catch {
      // Preserve the mutation or audit error; the named-lock connection will
      // be discarded if its cleanup later proves unsafe.
    }
    throw err;
  }
}

async function updatePublicationWithAudit(db, publicationId, fields, { actor, action, auditAfter } = {}) {
  return mutatePublicationWithAudit(db, {
    publicationId,
    actor,
    action,
    auditAfter,
    mutate: connection => updatePublication(connection, publicationId, fields),
  });
}

function pullRequestBody({ releaseCandidateId, plan, artifact }) {
  const proposalIds = [...new Set((plan.changes || []).map(change => change.proposal_id).filter(Boolean))];
  return [
    '## Reviewed content release',
    '',
    `- Release candidate: ${releaseCandidateId}`,
    `- Base commit: \`${artifact.baseSha}\``,
    `- Artifact SHA-256: \`${artifact.artifactHash}\``,
    `- Proposals: ${proposalIds.length ? proposalIds.join(', ') : 'none recorded'}`,
    `- Files: ${artifact.files.map(file => `\`${file.path}\``).join(', ')}`,
    `- Validation entries: ${(plan.validation_summary || []).length}`,
    '',
    'This PR was created from a human-reviewed release candidate. Merge remains a human action.',
  ].join('\n');
}

function branchMatchesArtifact(snapshot, afterFileHashes) {
  if (!snapshot || !(snapshot.files instanceof Map)) return false;
  return Object.entries(afterFileHashes || {}).every(([filePath, expected]) => {
    const file = snapshot.files.get(filePath);
    return Boolean(file?.buffer) && hashPublicationValue(file.buffer) === expected;
  });
}

export function storedPublicationManifestBuffer(publication) {
  const encoded = clean(publication?.manifestBase64);
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new PublicationStateError('Stored signed publication manifest is missing or invalid.', 'tampered');
  }
  const buffer = Buffer.from(encoded, 'base64');
  if (
    buffer.length > PUBLICATION_MANIFEST_MAX_BYTES
    || hashPublicationValue(buffer) !== publication.manifestSha256
  ) {
    throw new PublicationStateError('Stored signed publication manifest does not match its sealed hash.', 'tampered');
  }
  let manifest;
  try {
    manifest = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new PublicationStateError('Stored signed publication manifest is not valid JSON.', 'tampered');
  }
  if (!buffer.equals(Buffer.from(canonicalPrettyJson(manifest)))) {
    throw new PublicationStateError('Stored signed publication manifest is not deterministically encoded.', 'tampered');
  }
  if (
    manifest?.artifact_hash !== publication.artifactHash
    || manifest?.branch_name !== publication.branchName
    || clean(manifest?.repository_full_name).toLowerCase() !== clean(publication.repositoryFullName).toLowerCase()
    || manifest?.default_branch !== publication.defaultBranch
    || manifest?.payload?.base_sha !== publication.baseSha
    || hashPublicationValue(canonicalJson(manifest?.payload)) !== publication.artifactHash
    || manifest?.authorization?.key_id !== publication.signingKeyId
  ) {
    throw new PublicationStateError('Stored signed publication manifest identity is inconsistent.', 'tampered');
  }
  return buffer;
}

function checksFailed(checks) {
  if (checks?.combinedStatus === 'failure' || checks?.combinedStatus === 'error') return true;
  return (checks?.checkRuns || []).some(run => FAILURE_CHECK_CONCLUSIONS.has(run.conclusion));
}

function isExistingRefConflict(error) {
  const detail = clean(error?.response?.message || error?.message).toLowerCase();
  return Number(error?.status) === 422 && detail.includes('reference already exists');
}

export async function verifyDeploymentMarker({
  siteUrl,
  releaseCandidateId,
  artifactHash,
  fetchImpl = globalThis.fetch,
  timeoutMs = 8_000,
  maxMarkerBytes = 32 * 1024,
  maxHealthBytes = 32 * 1024,
  maxSitemapBytes = 2 * 1024 * 1024,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Deployment verification requires fetch.');
  let parsedSiteUrl;
  try {
    parsedSiteUrl = new URL(clean(siteUrl));
  } catch {
    throw new Error('siteUrl must be an absolute HTTP or HTTPS URL.');
  }
  if (!['http:', 'https:'].includes(parsedSiteUrl.protocol)) {
    throw new Error('siteUrl must be an absolute HTTP or HTTPS URL.');
  }
  if (parsedSiteUrl.username || parsedSiteUrl.password) {
    throw new Error('siteUrl must not contain embedded credentials.');
  }
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (parsedSiteUrl.protocol !== 'https:' && !loopbackHosts.has(parsedSiteUrl.hostname.toLowerCase())) {
    throw new Error('siteUrl must use HTTPS except for an explicit loopback development URL.');
  }
  const base = parsedSiteUrl.toString().replace(/\/+$/, '');
  const parsedTimeout = Number(timeoutMs);
  if (!Number.isSafeInteger(parsedTimeout) || parsedTimeout <= 0 || parsedTimeout > 60_000) {
    throw new Error('Deployment verification timeoutMs must be an integer from 1 to 60000.');
  }
  const requests = [
    ['release', `${base}/release.json`, maxMarkerBytes],
    ['health', `${base}/health`, maxHealthBytes],
    ['sitemap', `${base}/sitemap.xml`, maxSitemapBytes],
  ];
  for (const [key, , maxBytes] of requests) {
    const limit = Number(maxBytes);
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 10 * 1024 * 1024) {
      throw new Error(`Deployment ${key} response limit must be an integer from 1 to 10485760 bytes.`);
    }
  }
  const result = {
    checked_at: new Date().toISOString(),
    outcome: 'inconclusive',
    reason_code: 'verification_not_completed',
    reason: 'Deployment verification did not complete.',
    urls: {},
    ok: false,
    revert_recommended: false,
  };

  function finish(outcome, reasonCode, reason, extra = {}) {
    return {
      ...result,
      ...extra,
      outcome,
      reason_code: reasonCode,
      reason,
      error: outcome === 'verified' || outcome === 'superseded' ? null : reason,
      ok: outcome === 'verified',
      revert_recommended: outcome === 'mismatch',
    };
  }

  async function readLimited(response, maxBytes) {
    const limit = Number(maxBytes);
    const declared = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(declared) && declared > limit) {
      const error = new Error(`Response declared ${declared} bytes; limit is ${limit}.`);
      error.code = 'response_too_large';
      throw error;
    }
    if (!response.body?.getReader) {
      const text = await response.text();
      if (Buffer.byteLength(text) > limit) {
        const error = new Error(`Response exceeded the ${limit}-byte limit.`);
        error.code = 'response_too_large';
        throw error;
      }
      return text;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel('response_too_large').catch(() => {});
        const error = new Error(`Response exceeded the ${limit}-byte limit.`);
        error.code = 'response_too_large';
        throw error;
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total).toString('utf8');
  }

  async function request([key, url, maxBytes]) {
    const controller = new AbortController();
    let timeoutId;
    let timedOut = false;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
        const error = new Error(`Request timed out after ${parsedTimeout}ms.`);
        error.code = 'timeout';
        reject(error);
      }, parsedTimeout);
    });
    try {
      const operation = (async () => {
        const response = await fetchImpl(url, {
          headers: { 'cache-control': 'no-cache' },
          cache: 'no-store',
          // These are canonical deployment endpoints. Following a redirect
          // would let a compromised live origin turn Hostinger into a bounded
          // but real SSRF client for loopback, link-local, or private services.
          redirect: 'manual',
          signal: controller.signal,
        });
        const text = await readLimited(response, maxBytes);
        return { key, url, response, text, bytes: Buffer.byteLength(text) };
      })();
      return await Promise.race([operation, timeout]);
    } catch (err) {
      if (timedOut || err?.name === 'AbortError') {
        err.code = 'timeout';
      } else if (!err?.code) {
        err.code = 'network_error';
      }
      throw Object.assign(err, { verificationKey: key, verificationUrl: url });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  const settled = await Promise.allSettled(requests.map(request));
  const byKey = {};
  for (let index = 0; index < settled.length; index++) {
    const [key, url] = requests[index];
    const item = settled[index];
    if (item.status === 'rejected') {
      result.urls[key] = {
        url,
        ok: false,
        error_code: item.reason?.code || 'network_error',
        error: item.reason?.message || String(item.reason),
      };
      continue;
    }
    byKey[key] = item.value;
    result.urls[key] = {
      url,
      status: item.value.response.status,
      ok: item.value.response.ok,
      bytes: item.value.bytes,
    };
  }

  if (!byKey.release) {
    const detail = result.urls.release;
    return finish('inconclusive', detail?.error_code || 'release_unavailable', 'The live release marker could not be read safely.');
  }
  if (!byKey.release.response.ok) {
    const status = byKey.release.response.status;
    if (status >= 300 && status < 400) {
      return finish(
        'inconclusive',
        'release_redirect',
        `The live release marker returned HTTP ${status} instead of the canonical endpoint response.`
      );
    }
    return finish(
      'inconclusive',
      status >= 500 ? 'release_http_5xx' : 'release_http_error',
      `The live release marker returned HTTP ${status}; deployment state is not yet conclusive.`
    );
  }

  let marker;
  try {
    marker = JSON.parse(byKey.release.text);
  } catch {
    return finish('inconclusive', 'invalid_release_marker', 'The live release marker was not valid JSON.');
  }
  result.marker = marker;
  const markerReleaseId = String(marker?.release_id ?? '').trim();
  const expectedReleaseId = String(releaseCandidateId ?? '').trim();
  const markerHash = String(marker?.artifact_hash || '').trim().toLowerCase();
  const expectedHash = String(artifactHash || '').trim().toLowerCase();
  result.schema_matches = Number(marker?.schema_version) === PUBLICATION_ARTIFACT_SCHEMA_VERSION;
  result.release_matches = markerReleaseId === expectedReleaseId;
  result.artifact_matches = markerHash === expectedHash;
  const validMarker = Number(marker?.schema_version) === PUBLICATION_ARTIFACT_SCHEMA_VERSION
    && /^\d{1,20}$/.test(markerReleaseId)
    && BigInt(markerReleaseId) > 0n
    && /^[a-f0-9]{64}$/.test(markerHash);
  if (!validMarker || !/^\d{1,20}$/.test(expectedReleaseId) || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    return finish('inconclusive', 'invalid_release_marker', 'The live release marker was well-formed JSON but not a valid deployment attestation.', { marker });
  }

  const liveRelease = BigInt(markerReleaseId);
  const expectedRelease = BigInt(expectedReleaseId);
  if (liveRelease > expectedRelease) {
    return finish('superseded', 'newer_release_live', `Release ${markerReleaseId} is already live, so this release has been superseded.`, {
      marker,
      live_release_id: markerReleaseId,
    });
  }
  if (liveRelease < expectedRelease) {
    return finish('inconclusive', 'older_release_live', `Release ${markerReleaseId} is still live while release ${expectedReleaseId} is deploying.`, {
      marker,
      live_release_id: markerReleaseId,
    });
  }
  if (markerHash !== expectedHash) {
    return finish('mismatch', 'artifact_hash_mismatch', 'The live marker names this release but its artifact hash differs from the reviewed artifact.', {
      marker,
      live_release_id: markerReleaseId,
    });
  }

  for (const key of ['health', 'sitemap']) {
    if (!byKey[key]) {
      const detail = result.urls[key];
      return finish('inconclusive', detail?.error_code || `${key}_unavailable`, `The live ${key} check could not be read safely.`, { marker });
    }
    if (!byKey[key].response.ok) {
      const status = byKey[key].response.status;
      if (status >= 300 && status < 400) {
        return finish(
          'inconclusive',
          `${key}_redirect`,
          `The live ${key} check returned HTTP ${status} instead of the canonical endpoint response.`,
          { marker }
        );
      }
      return finish(
        'inconclusive',
        status >= 500 ? `${key}_http_5xx` : `${key}_http_error`,
        `The live ${key} check returned HTTP ${status}; deployment health is not yet conclusive.`,
        { marker }
      );
    }
  }

  let health;
  try {
    health = JSON.parse(byKey.health.text);
  } catch {
    return finish('inconclusive', 'invalid_health_response', 'The health endpoint returned an invalid temporary response.', { marker });
  }
  if (health?.status !== 'ok') {
    return finish('inconclusive', 'health_not_ready', 'The reviewed artifact is live, but the health endpoint is not ready.', { marker, health });
  }
  if (!/<urlset\b/i.test(byKey.sitemap.text)) {
    return finish('inconclusive', 'invalid_sitemap_response', 'The sitemap endpoint returned an invalid temporary response.', { marker });
  }

  return finish('verified', 'artifact_verified', 'The reviewed release marker, health endpoint, and sitemap are live.', {
    marker,
    live_release_id: markerReleaseId,
    health_ok: true,
    sitemap_ok: true,
  });
}

export function githubPublicationStatusForVerification(outcome) {
  if (outcome === 'verified') return 'deployed';
  if (outcome === 'mismatch') return 'verification_failed';
  if (outcome === 'superseded') return 'superseded';
  return 'verification_inconclusive';
}

export class GitHubPublisher {
  constructor({
    db = null,
    github = null,
    siteUrl = process.env.SITE_URL || 'https://jntustack.com',
    fetchImpl = globalThis.fetch,
    defaultBranch = process.env.GITHUB_DEFAULT_BRANCH || 'main',
    deploymentVerificationOptions = {},
    signingPrivateKey = process.env.PUBLICATION_SIGNING_PRIVATE_KEY_BASE64
      || process.env.PUBLICATION_SIGNING_PRIVATE_KEY,
    signingKeyId = process.env.PUBLICATION_SIGNING_KEY_ID,
    trustReady = getGitHubPublicationTrustReady(),
  } = {}) {
    this.db = db;
    this.github = github;
    this.siteUrl = siteUrl;
    this.fetch = fetchImpl;
    this.defaultBranch = clean(defaultBranch) || 'main';
    this.deploymentVerificationOptions = deploymentVerificationOptions;
    this.signingPrivateKey = signingPrivateKey;
    this.signingKeyId = signingKeyId;
    this.trustReady = trustReady === true;
  }

  async database() {
    if (!this.db) this.db = await getDbPool({ requireConfigured: true });
    return this.db;
  }

  githubClient() {
    if (!this.github) this.github = createGitHubAppClientFromEnv();
    return this.github;
  }

  async getPublication({ publicationId }) {
    return loadPublication(await this.database(), publicationId);
  }

  async getPublicationForRelease({ releaseCandidateId }) {
    return loadPublicationForRelease(await this.database(), releaseCandidateId);
  }

  async listPublications({ statuses = [], limit = 100 } = {}) {
    return listPublicationRows(await this.database(), { statuses, limit });
  }

  async createPublication({ releaseCandidateId, actor = null, confirmation = '' }) {
    if (confirmation !== CREATE_REVIEW_PR_CONFIRMATION) {
      throw new PublicationStateError(`Confirmation must exactly match ${CREATE_REVIEW_PR_CONFIRMATION}.`, 'confirmation_required');
    }
    if (!this.trustReady) {
      throw new PublicationStateError(
        'GitHub publication is fail-closed until branch/ruleset protection is proven and GITHUB_PUBLICATION_TRUST_READY=true is set.',
        'publication_trust_not_ready'
      );
    }
    const database = await this.database();
    const lock = await acquireReleasePublicationLock(database, releaseCandidateId);
    const db = lock.db;
    try {
    const loaded = await loadReleasePlan(db, releaseCandidateId);
    if (loaded.row.release_status !== 'ready_for_review') {
      throw new PublicationStateError(
        `Release candidate must be ready_for_review. Current status: ${loaded.row.release_status}.`,
        'release_not_ready'
      );
    }
    if (loaded.row.publication_mode !== 'github_pr') {
      throw new PublicationStateError('Release candidate is not configured for GitHub PR publication.', 'legacy_publication_mode');
    }
    assertPlanReady(loaded.plan, releaseCandidateId);

    const existing = await loadPublicationForRelease(db, releaseCandidateId);
    const currentReview = await generateReleaseReviewSummary({ releaseCandidateId, db });
    if (currentReview.has_blocking_warnings) {
      const message = `Current release review has ${currentReview.blocking_warning_count} blocking warning(s). Regenerate artifacts only after a new human review.`;
      if (existing && ['preparing', 'pr_open', 'ci_failed', 'failed'].includes(existing.status)) {
        await updatePublicationWithAudit(
          db,
          existing.id,
          { status: 'blocked_stale_base', lastError: message },
          { actor, action: 'github_publication.review_blocked' }
        );
      }
      throw new PublicationStateError(message, 'current_review_blocked');
    }
    if (existing?.status === 'blocked_stale_base') {
      throw new PublicationStateError(
        'This publication was permanently blocked after its reviewed base changed. Close its PR and create a fresh release candidate.',
        'blocked_stale_base'
      );
    }
    if (existing && !['preparing', 'failed'].includes(existing.status)) {
      return existing;
    }

    const github = this.githubClient();
    const repositoryFullName = githubRepositoryFullName(github);
    if (!/^[^/]+\/[^/]+$/.test(repositoryFullName)) {
      throw new PublicationStateError('GitHub repository identity is missing or invalid.', 'github_configuration_invalid');
    }
    const targetFiles = [...new Set(loaded.plan.changes.map(change => assertSafeDataFile(change.file)))];
    const snapshot = await github.getBranchSnapshot({ branch: this.defaultBranch, paths: targetFiles });
    if (!snapshot) throw new PublicationStateError(`Default branch not found: ${this.defaultBranch}.`, 'stale_base');
    if (!snapshot.treeSha) throw new PublicationStateError('Default branch tree could not be sealed.', 'stale_base');

    if (loaded.row.base_git_sha && loaded.row.base_git_sha !== snapshot.headSha) {
      if (existing) {
        await updatePublicationWithAudit(
          db,
          existing.id,
          {
            status: 'blocked_stale_base',
            lastError: `Reviewed base ${loaded.row.base_git_sha} no longer matches ${snapshot.headSha}.`,
          },
          { actor, action: 'github_publication.stale_base' }
        );
      }
      throw new PublicationStateError('Default branch changed after the artifact was sealed. Regenerate and review it.', 'stale_base');
    }

    let artifact;
    try {
      artifact = buildPublicationArtifact({
        releaseCandidateId,
        baseSha: snapshot.headSha,
        plan: loaded.plan,
        snapshot,
      });
    } catch (err) {
      if (existing && err?.code === 'stale_base') {
        await updatePublicationWithAudit(
          db,
          existing.id,
          { status: 'blocked_stale_base', lastError: err.message },
          { actor, action: 'github_publication.stale_base' }
        );
      }
      throw err;
    }

    if (loaded.row.artifact_hash && loaded.row.artifact_hash !== artifact.artifactHash) {
      if (existing) {
        await updatePublicationWithAudit(
          db,
          existing.id,
          {
            status: 'tampered',
            lastError: 'Stored artifact hash does not match the reviewed content.',
          },
          { actor, action: 'github_publication.tampered' }
        );
      } else {
        await audit(db, {
          actor,
          action: 'github_publication.artifact_tampered',
          entityId: null,
          after: { release_candidate_id: Number(releaseCandidateId), error: 'Stored artifact hash mismatch.' },
        });
      }
      throw new PublicationStateError('Stored artifact hash does not match the reviewed content.', 'tampered');
    }

    const [artifactSealResult] = await db.execute(
      `UPDATE release_apply_plans
       SET artifact_schema_version = ?,
           base_git_sha = ?,
           artifact_hash = ?,
           before_file_hashes_json = ?,
           after_file_hashes_json = ?,
           artifact_payload_json = ?
       WHERE id = ?
         AND (artifact_hash IS NULL OR artifact_hash = ?)`,
      [
        artifact.schemaVersion,
        artifact.baseSha,
        artifact.artifactHash,
        JSON.stringify(artifact.beforeFileHashes),
        JSON.stringify(artifact.afterFileHashes),
        JSON.stringify(artifact.payload),
        loaded.row.release_apply_plan_id,
        artifact.artifactHash,
      ]
    );
    if (Number(artifactSealResult?.affectedRows) !== 1) {
      throw new PublicationStateError(
        'The reviewed apply-plan artifact was sealed concurrently with different content.',
        'tampered'
      );
    }

    const branchName = publicationBranchName(releaseCandidateId, artifact.artifactHash);
    const idempotencyKey = publicationIdempotencyKey(releaseCandidateId, artifact.artifactHash);
    const marker = markerBuffer({ releaseCandidateId, artifactHash: artifact.artifactHash });
    let proposedManifest;
    let proposedManifestSha256;
    let proposedSigningKeyId;
    if (existing) {
      if (
        existing.artifactHash !== artifact.artifactHash
        || existing.baseSha !== artifact.baseSha
        || existing.branchName !== branchName
        || clean(existing.repositoryFullName).toLowerCase() !== repositoryFullName.toLowerCase()
        || existing.defaultBranch !== this.defaultBranch
      ) {
        await updatePublicationWithAudit(
          db,
          existing.id,
          {
            status: 'tampered',
            lastError: 'Retry configuration or artifact does not match the first sealed publication attempt.',
          },
          { actor, action: 'github_publication.tampered' }
        );
        throw new PublicationStateError('Publication retry does not match its first sealed attempt.', 'tampered');
      }
      try {
        proposedManifest = storedPublicationManifestBuffer(existing);
        proposedManifestSha256 = existing.manifestSha256;
        proposedSigningKeyId = existing.signingKeyId;
      } catch (err) {
        await updatePublicationWithAudit(
          db,
          existing.id,
          {
            status: 'tampered',
            lastError: err.message || 'Stored signed publication manifest is invalid.',
          },
          { actor, action: 'github_publication.tampered' }
        );
        throw err;
      }
    } else {
      proposedManifest = publicationArtifactManifestBuffer({
        artifactHash: artifact.artifactHash,
        branchName,
        repositoryFullName,
        defaultBranch: this.defaultBranch,
        payload: artifact.payload,
        signingPrivateKey: this.signingPrivateKey,
        signingKeyId: this.signingKeyId,
      });
      proposedManifestSha256 = hashPublicationValue(proposedManifest);
      proposedSigningKeyId = normalizeSigningKeyId(this.signingKeyId);
    }
    let publication = await mutatePublicationWithAudit(db, {
      publicationId: existing?.id || null,
      actor,
      action: existing ? 'github_publication.retry_preparing' : 'github_publication.preparing',
      mutate: async connection => {
        if (existing) {
          await connection.execute(
            `UPDATE github_publications
             SET attempt_count = attempt_count + 1,
                 last_error = NULL
             WHERE id = ?`,
            [existing.id]
          );
        } else {
          await connection.execute(
            `INSERT INTO github_publications
              (release_candidate_id, release_apply_plan_id, idempotency_key, artifact_schema_version,
               artifact_hash, base_sha, manifest_sha256, manifest_base64, signing_key_id,
               repository_full_name, default_branch, branch_name,
               status, attempt_count, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'preparing', 1, ?)`,
            [
              releaseCandidateId,
              loaded.row.release_apply_plan_id,
              idempotencyKey,
              artifact.schemaVersion,
              artifact.artifactHash,
              artifact.baseSha,
              proposedManifestSha256,
              proposedManifest.toString('base64'),
              proposedSigningKeyId,
              repositoryFullName,
              this.defaultBranch,
              branchName,
              actor,
            ]
          );
        }
        const [publicationRows] = await connection.execute(
          'SELECT * FROM github_publications WHERE idempotency_key = ? LIMIT 1',
          [idempotencyKey]
        );
        return publicationFromRow(publicationRows[0]);
      },
    });

    try {
      // Retries always reuse the first signed bytes. This keeps an interrupted
      // publication stable across signing-key rotation and prevents the DB row,
      // branch and required CI artifact from diverging.
      const manifest = storedPublicationManifestBuffer(publication);
      const files = artifact.files.map(file => ({ path: file.path, buffer: file.afterBuffer }));
      files.push({
        path: 'data/release.json',
        buffer: marker,
      });
      files.push({
        path: 'data/release-artifact.json',
        buffer: manifest,
      });
      const branchFileHashes = {
        ...artifact.afterFileHashes,
        'data/release.json': hashPublicationValue(marker),
        'data/release-artifact.json': hashPublicationValue(manifest),
      };
      // Git trees are content-addressed. Rebuilding the expected tree from the
      // sealed base lets an interrupted retry reject a pre-existing branch
      // that contains any extra or altered path, not only the reviewed files.
      const expectedTree = await github.createTree({ baseTreeSha: snapshot.treeSha, files });
      let branch = await github.getBranchSnapshot({
        branch: branchName,
        paths: Object.keys(branchFileHashes),
      });
      let headSha;
      if (branch) {
        const exactParent = branch.parentShas?.length === 1 && branch.parentShas[0] === snapshot.headSha;
        if (!branchMatchesArtifact(branch, branchFileHashes) || branch.treeSha !== expectedTree.sha || !exactParent) {
          publication = await updatePublicationWithAudit(
            db,
            publication.id,
            {
              status: 'tampered',
              lastError: 'Deterministic publication branch does not exactly match the sealed base, tree, and reviewed content.',
            },
            { actor, action: 'github_publication.tampered' }
          );
          throw new PublicationStateError('Publication branch content does not match the reviewed artifact.', 'tampered');
        }
        headSha = branch.headSha;
      } else {
        const commit = await github.createCommit({
          message: `Publish reviewed content release ${releaseCandidateId}`,
          treeSha: expectedTree.sha,
          parentSha: snapshot.headSha,
        });
        const commitParents = Array.isArray(commit?.parents) ? commit.parents.map(parent => parent.sha).filter(Boolean) : [];
        if (commit?.tree?.sha !== expectedTree.sha || commitParents.length !== 1 || commitParents[0] !== snapshot.headSha) {
          throw new PublicationStateError('GitHub returned a commit that does not match the sealed tree and parent.', 'tampered');
        }
        try {
          await github.createRef({ branch: branchName, sha: commit.sha });
          headSha = commit.sha;
        } catch (err) {
          if (!isExistingRefConflict(err)) throw err;
          // A prior interrupted request or an external race may have created
          // the deterministic ref. Adopt it only after checking the exact
          // sealed tree, parent and every publication file.
          branch = await github.getBranchSnapshot({
            branch: branchName,
            paths: Object.keys(branchFileHashes),
          });
          const exactParent = branch?.parentShas?.length === 1 && branch.parentShas[0] === snapshot.headSha;
          if (!branch || !branchMatchesArtifact(branch, branchFileHashes) || branch.treeSha !== expectedTree.sha || !exactParent) {
            publication = await updatePublicationWithAudit(
              db,
              publication.id,
              {
                status: 'tampered',
                lastError: 'A conflicting deterministic publication ref does not match the sealed artifact.',
              },
              { actor, action: 'github_publication.tampered' }
            );
            throw new PublicationStateError('Conflicting publication branch does not match the reviewed artifact.', 'tampered');
          }
          headSha = branch.headSha;
        }
      }

      if (publication.headSha && publication.headSha !== headSha) {
        publication = await updatePublicationWithAudit(
          db,
          publication.id,
          {
            status: 'tampered',
            lastError: 'Publication branch head changed after creation.',
          },
          { actor, action: 'github_publication.tampered' }
        );
        throw new PublicationStateError('Publication branch head changed after creation.', 'tampered');
      }

      let pullRequest = await github.findPullRequest({ branch: branchName });
      if (!pullRequest) {
        pullRequest = await github.createPullRequest({
          branch: branchName,
          base: this.defaultBranch,
          title: `Content release ${releaseCandidateId}: ${loaded.row.release_title}`,
          body: pullRequestBody({ releaseCandidateId, plan: loaded.plan, artifact }),
        });
      }
      const identityError = pullRequestIdentityError(pullRequest, {
        ...publication,
        branchName,
        headSha,
        repositoryFullName,
        defaultBranch: this.defaultBranch,
      });
      if (identityError) {
        publication = await updatePublicationWithAudit(
          db,
          publication.id,
          {
            status: 'tampered',
            lastError: identityError,
          },
          { actor, action: 'github_publication.tampered' }
        );
        throw new PublicationStateError('Pull request does not match the reviewed publication branch.', 'tampered');
      }
      publication = await updatePublicationWithAudit(
        db,
        publication.id,
        {
          status: pullRequest.merged_at ? 'deploy_pending' : pullRequest.state === 'closed' ? 'closed_unmerged' : 'pr_open',
          headSha,
          mergeSha: pullRequest.merged_at ? pullRequest.merge_commit_sha || null : null,
          pullRequestNumber: pullRequest.number,
          pullRequestUrl: pullRequest.html_url,
          pullRequestCreatedAt: pullRequest.created_at ? new Date(pullRequest.created_at) : new Date(),
          mergedAt: pullRequest.merged_at ? new Date(pullRequest.merged_at) : null,
          lastError: null,
        },
        { actor, action: 'github_publication.pr_ready' }
      );
      return publication;
    } catch (err) {
      if (err?.code === 'tampered') {
        if (publication?.status !== 'tampered') {
          publication = await updatePublicationWithAudit(
            db,
            publication.id,
            {
              status: 'tampered',
              lastError: err.message || 'Publication artifact integrity check failed.',
            },
            { actor, action: 'github_publication.tampered' }
          );
        }
      } else if (err?.code === 'stale_base') {
        publication = await updatePublicationWithAudit(
          db,
          publication.id,
          {
            status: 'blocked_stale_base',
            lastError: err.message || 'Publication base changed after review.',
          },
          { actor, action: 'github_publication.stale_base' }
        );
      } else {
        publication = await updatePublicationWithAudit(
          db,
          publication.id,
          { status: 'failed', lastError: err.message || String(err) },
          { actor, action: 'github_publication.failed' }
        );
      }
      throw err;
    }
    } finally {
      await lock.release();
    }
  }

  async refreshPublication({ publicationId, actor = null }) {
    const database = await this.database();
    const initialPublication = await loadPublication(database, publicationId);
    if (!initialPublication) throw new PublicationStateError(`GitHub publication not found: ${publicationId}.`, 'not_found');
    const lock = await acquireReleasePublicationLock(database, initialPublication.releaseCandidateId);
    const db = lock.db;
    try {
    let publication = await loadPublication(db, publicationId);
    if (!publication) throw new PublicationStateError(`GitHub publication not found: ${publicationId}.`, 'not_found');
    if (!githubPublicationActionAllowed(publication.status, 'refresh')) {
      throw new PublicationStateError(`GitHub status refresh is not allowed from ${publication.status}.`, 'invalid_publication_action');
    }
    if (!publication.pullRequestNumber) return publication;

    const [planRows] = await db.execute(
      `SELECT after_file_hashes_json, artifact_hash, base_git_sha, artifact_payload_json
       FROM release_apply_plans
       WHERE id = ?
       LIMIT 1`,
      [publication.releaseApplyPlanId]
    );
    if (planRows[0]?.artifact_hash !== publication.artifactHash || planRows[0]?.base_git_sha !== publication.baseSha) {
      return updatePublicationWithAudit(
        db,
        publication.id,
        {
          status: 'tampered',
          lastError: 'Publication no longer matches its sealed apply-plan artifact.',
        },
        { actor, action: 'github_publication.tampered' }
      );
    }
    const afterFileHashes = parseJson(planRows[0]?.after_file_hashes_json, {});
    const artifactPayload = parseJson(planRows[0]?.artifact_payload_json, null);
    if (
      Object.keys(afterFileHashes).length === 0
      || !artifactPayload
      || hashPublicationValue(canonicalJson(artifactPayload)) !== publication.artifactHash
      || !/^[a-f0-9]{64}$/.test(clean(publication.manifestSha256))
      || !/^[A-Za-z0-9._-]{1,64}$/.test(clean(publication.signingKeyId))
    ) {
      return updatePublicationWithAudit(
        db,
        publication.id,
        {
          status: 'tampered',
          lastError: 'Publication is missing or no longer matches its sealed artifact payload.',
        },
        { actor, action: 'github_publication.tampered' }
      );
    }
    const github = this.githubClient();
    const configuredRepository = githubRepositoryFullName(github);
    if (
      configuredRepository.toLowerCase() !== clean(publication.repositoryFullName).toLowerCase()
      || this.defaultBranch !== publication.defaultBranch
    ) {
      return updatePublicationWithAudit(
        db,
        publication.id,
        {
          status: 'tampered',
          lastError: 'Runtime GitHub configuration no longer matches the sealed publication repository and branch.',
        },
        { actor, action: 'github_publication.tampered' }
      );
    }
    const pullRequest = await github.getPullRequest(publication.pullRequestNumber);
    const identityError = pullRequestIdentityError(pullRequest, publication);
    if (identityError) {
      return updatePublicationWithAudit(
        db,
        publication.id,
        {
          status: 'tampered',
          lastError: identityError,
        },
        { actor, action: 'github_publication.tampered' }
      );
    }
    if (!(pullRequest.merged_at || pullRequest.merged) && pullRequest.state !== 'closed') {
      const currentReview = await generateReleaseReviewSummary({ releaseCandidateId: publication.releaseCandidateId, db });
      if (currentReview.has_blocking_warnings) {
        return updatePublicationWithAudit(
          db,
          publication.id,
          {
            status: 'blocked_stale_base',
            lastError: `Current release review has ${currentReview.blocking_warning_count} blocking warning(s). Close this PR and prepare a fresh reviewed release.`,
          },
          { actor, action: 'github_publication.review_blocked' }
        );
      }
    }
    let status = 'pr_open';
    let error = null;
    if (pullRequest.merged_at || pullRequest.merged) {
      if (pullRequest.head?.sha !== publication.headSha) {
        status = 'tampered';
        error = 'Merged pull request head does not match the reviewed publication commit.';
      } else {
        status = 'deploy_pending';
      }
    } else if (pullRequest.state === 'closed') {
      status = 'closed_unmerged';
    } else {
      const currentBase = await github.getBranchSnapshot({ branch: this.defaultBranch, paths: [] });
      if (!currentBase || currentBase.headSha !== publication.baseSha) {
        status = 'blocked_stale_base';
        error = `Default branch changed after review (sealed ${publication.baseSha}, current ${currentBase?.headSha || 'missing'}). Prepare and review a fresh release.`;
      } else {
        const expectedBranchHashes = {
          ...afterFileHashes,
          'data/release.json': hashPublicationValue(markerBuffer({
            releaseCandidateId: publication.releaseCandidateId,
            artifactHash: publication.artifactHash,
          })),
          'data/release-artifact.json': publication.manifestSha256,
        };
        const branch = await github.getBranchSnapshot({
          branch: publication.branchName,
          paths: Object.keys(expectedBranchHashes),
        });
        const exactParent = branch?.parentShas?.length === 1 && branch.parentShas[0] === publication.baseSha;
        if (!branch || !branchMatchesArtifact(branch, expectedBranchHashes) || branch.headSha !== publication.headSha || !exactParent) {
          status = 'tampered';
          error = 'Publication branch, parent, or reviewed file content changed after review.';
        } else if (pullRequest.mergeable === false && pullRequest.mergeable_state === 'dirty') {
          status = 'blocked_stale_base';
          error = 'Pull request conflicts with the current default branch; prepare and review a fresh release.';
        } else {
          const checks = await github.getCommitChecks(publication.headSha);
          if (!checks?.checksAvailable && !checks?.statusesAvailable) {
            status = 'ci_failed';
            error = 'GitHub check and commit-status visibility is unavailable. Publication fails closed; do not merge.';
          } else if (checksFailed(checks)) {
            status = 'ci_failed';
            error = 'Required GitHub checks failed. The pull request remains open and must not be merged.';
          }
        }
      }
    }

    publication = await updatePublicationWithAudit(
      db,
      publication.id,
      {
        status,
        mergeSha: pullRequest.merged_at ? pullRequest.merge_commit_sha || publication.mergeSha : publication.mergeSha,
        mergedAt: pullRequest.merged_at ? new Date(pullRequest.merged_at) : publication.mergedAt,
        lastError: error,
      },
      { actor, action: 'github_publication.refresh' }
    );
    return publication;
    } finally {
      await lock.release();
    }
  }

  async verifyDeployment({ publicationId, actor = null }) {
    const database = await this.database();
    const initialPublication = await loadPublication(database, publicationId);
    if (!initialPublication) throw new PublicationStateError(`GitHub publication not found: ${publicationId}.`, 'not_found');
    const lock = await acquireReleasePublicationLock(database, initialPublication.releaseCandidateId);
    const db = lock.db;
    try {
    let publication = await loadPublication(db, publicationId);
    if (!publication) throw new PublicationStateError(`GitHub publication not found: ${publicationId}.`, 'not_found');
    if (!githubPublicationActionAllowed(publication.status, 'verify_deployment')) {
      throw new PublicationStateError(
        `Deployment verification is not allowed from status ${publication.status}.`,
        'deployment_not_ready'
      );
    }
    let verification = await verifyDeploymentMarker({
      ...this.deploymentVerificationOptions,
      siteUrl: this.siteUrl,
      releaseCandidateId: publication.releaseCandidateId,
      artifactHash: publication.artifactHash,
      fetchImpl: this.fetch,
    });
    if (verification.outcome === 'superseded') {
      const [knownRows] = await db.execute(
        `SELECT id
         FROM github_publications
         WHERE release_candidate_id = ?
           AND artifact_hash = ?
           AND merged_at IS NOT NULL
           AND status IN ('deploy_pending', 'verification_inconclusive', 'verification_failed', 'deployed', 'superseded')
         LIMIT 1`,
        [verification.live_release_id, verification.marker?.artifact_hash || null]
      );
      if (!knownRows[0]) {
        verification = {
          ...verification,
          outcome: 'inconclusive',
          reason_code: 'unknown_newer_release',
          reason: 'A valid-looking newer live marker is not linked to any known merged publication. Investigate before taking recovery action.',
          error: 'A valid-looking newer live marker is not linked to any known merged publication. Investigate before taking recovery action.',
          ok: false,
          revert_recommended: false,
        };
      }
    }
    let status = githubPublicationStatusForVerification(verification.outcome);
    let action = {
      deployed: 'github_publication.deployed',
      verification_inconclusive: 'github_publication.verification_inconclusive',
      verification_failed: 'github_publication.verification_failed',
      superseded: 'github_publication.superseded',
    }[status];
    const preserveVerifiedEvidence = publication.status === 'deployed' && status === 'verification_inconclusive';
    if (preserveVerifiedEvidence) {
      status = 'deployed';
      action = 'github_publication.deployed_recheck_inconclusive';
    }
    const update = {
      status,
      lastCheckedAt: new Date(),
      lastVerificationAttempt: verification,
      lastError: preserveVerifiedEvidence || ['deployed', 'superseded'].includes(status) ? null : verification.reason,
    };
    if (!preserveVerifiedEvidence) update.verification = verification;
    if (status === 'deployed') update.verifiedAt = publication.verifiedAt || new Date();
    publication = await updatePublicationWithAudit(db, publication.id, update, {
      actor,
      action,
      auditAfter: updatedPublication => ({
        publication: updatedPublication,
        verification_attempt: verification,
      }),
    });
    return publication;
    } finally {
      await lock.release();
    }
  }
}

export function createGitHubPublisher(options = {}) {
  return new GitHubPublisher(options);
}
