#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ARTIFACT_SCHEMA_VERSION = 1;
const MANIFEST_PATH = 'data/release-artifact.json';
const MARKER_PATH = 'data/release.json';
const PUBLICATION_BRANCH_PREFIX = 'jntustack/rc-';
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_MARKER_BYTES = 64 * 1024;
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_PUBLIC_KEYRING_BYTES = 64 * 1024;
const SIGNING_ALGORITHM = 'RS256';

class ArtifactVerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ArtifactVerificationError';
  }
}

function fail(message) {
  throw new ArtifactVerificationError(message);
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

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be a JSON object.`);
  }
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} must contain exactly: ${wanted.join(', ')}.`);
  }
}

function assertDigest(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    fail(`${label} must be a lowercase SHA-256 digest.`);
  }
}

function assertGitSha(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{40,64}$/.test(value)) {
    fail(`${label} must be a lowercase Git object ID.`);
  }
}

function assertByteSize(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a non-negative safe integer.`);
  }
}

function assertSafePayloadPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) {
    fail('Every artifact file path must be a non-empty string of at most 1024 characters.');
  }
  const normalized = value.replaceAll('\\', '/');
  if (
    normalized !== value
    || path.posix.normalize(value) !== value
    || !value.startsWith('data/')
    || !/^data\/[A-Za-z0-9._/-]+$/.test(value)
    || value === MANIFEST_PATH
    || value === MARKER_PATH
    || value.includes('\0')
  ) {
    fail(`Unsafe or reserved artifact file path: ${value}.`);
  }
  return value;
}

function readBoundedJson(filePath, maxBytes, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    fail(`${label} is missing: ${error.message}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${label} must be a regular file.`);
  if (stat.size > maxBytes) fail(`${label} exceeds the ${maxBytes}-byte limit.`);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

function assertExactPublisherJsonBytes(filePath, value, label) {
  const actual = fs.readFileSync(filePath);
  const expected = Buffer.from(`${JSON.stringify(canonicalValue(value), null, 2)}\n`);
  if (!actual.equals(expected)) {
    fail(`${label} bytes do not match the publisher's exact deterministic JSON encoding.`);
  }
}

function runGit(args, { encoding = null } = {}) {
  try {
    return execFileSync('git', args, {
      encoding,
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const detail = error.stderr?.toString('utf8').trim() || error.message;
    fail(`git ${args[0]} failed: ${detail}`);
  }
}

function gitText(args) {
  return runGit(args, { encoding: 'utf8' }).trim();
}

function changedPaths(baseSha, headSha) {
  const output = runGit([
    'diff',
    '--name-only',
    '--no-renames',
    '--diff-filter=ACDMRTUXB',
    '-z',
    baseSha,
    headSha,
    '--',
  ]);
  if (output.length === 0) return [];
  return output.toString('utf8').split('\0').filter(Boolean).sort();
}

function gitBlob(commitSha, filePath) {
  return runGit(['show', `${commitSha}:${filePath}`]);
}

function assertGitRegularBlob(commitSha, filePath, label) {
  const line = gitText(['ls-tree', commitSha, '--', filePath]);
  const match = line.match(/^100644 blob [a-f0-9]{40,64}\t(.+)$/);
  if (!match || match[1] !== filePath) {
    fail(`${label} ${filePath} must be a non-executable 100644 Git blob.`);
  }
}

function lowerRepo(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isProtectedLiveDataPath(filePath) {
  if (!filePath.startsWith('data/') || !filePath.endsWith('.json')) return false;
  const name = filePath.slice('data/'.length);
  if (!name || name.includes('/')) return false;
  return !['schema.json', 'release.json', 'release-artifact.json'].includes(name);
}

function signingPublicKey(keyId) {
  const raw = process.env.PUBLICATION_SIGNING_PUBLIC_KEYS_JSON || '';
  if (!raw || Buffer.byteLength(raw) > MAX_PUBLIC_KEYRING_BYTES) {
    fail('PUBLICATION_SIGNING_PUBLIC_KEYS_JSON is missing or exceeds the safe size limit.');
  }
  let keyring;
  try {
    keyring = JSON.parse(raw);
  } catch (error) {
    fail(`PUBLICATION_SIGNING_PUBLIC_KEYS_JSON is invalid JSON: ${error.message}`);
  }
  assertPlainObject(keyring, 'Publication signing public-key ring');
  if (Object.keys(keyring).length === 0 || Object.keys(keyring).length > 20) {
    fail('Publication signing public-key ring must contain 1-20 keys.');
  }
  const encoded = keyring[keyId];
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    fail(`No valid base64 public key is configured for signing key ${keyId}.`);
  }
  let key;
  try {
    key = crypto.createPublicKey(Buffer.from(encoded, 'base64').toString('utf8'));
  } catch (error) {
    fail(`Publication public key ${keyId} is invalid: ${error.message}`);
  }
  if (key.asymmetricKeyType !== 'rsa' || Number(key.asymmetricKeyDetails?.modulusLength || 0) < 2048) {
    fail(`Publication public key ${keyId} must be RSA with at least 2048 bits.`);
  }
  return key;
}

export function publicationBranchName(releaseCandidateId, artifactHash) {
  if (!Number.isSafeInteger(releaseCandidateId) || releaseCandidateId <= 0) {
    fail('payload.release_candidate_id must be a positive safe integer.');
  }
  assertDigest(artifactHash, 'manifest.artifact_hash');
  return `jntustack/rc-${releaseCandidateId}-${artifactHash}`;
}

function validateManifestAndMarker(manifest, marker) {
  assertPlainObject(manifest, 'Publication manifest');
  assertExactKeys(
    manifest,
    ['schema_version', 'artifact_hash', 'branch_name', 'repository_full_name', 'default_branch', 'payload', 'authorization'],
    'Publication manifest'
  );
  if (manifest.schema_version !== ARTIFACT_SCHEMA_VERSION) {
    fail(`Unsupported publication manifest schema version: ${manifest.schema_version}.`);
  }
  assertDigest(manifest.artifact_hash, 'manifest.artifact_hash');
  if (typeof manifest.branch_name !== 'string' || !manifest.branch_name.startsWith(PUBLICATION_BRANCH_PREFIX)) {
    fail(`manifest.branch_name must start with ${PUBLICATION_BRANCH_PREFIX}.`);
  }
  if (
    typeof manifest.repository_full_name !== 'string'
    || !/^[^/\s]+\/[^/\s]+$/.test(manifest.repository_full_name)
  ) {
    fail('manifest.repository_full_name must be an owner/repository name.');
  }
  if (typeof manifest.default_branch !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(manifest.default_branch)) {
    fail('manifest.default_branch is invalid.');
  }
  assertPlainObject(manifest.authorization, 'manifest.authorization');
  assertExactKeys(manifest.authorization, ['algorithm', 'key_id', 'signature'], 'manifest.authorization');
  if (manifest.authorization.algorithm !== SIGNING_ALGORITHM) {
    fail(`manifest.authorization.algorithm must be ${SIGNING_ALGORITHM}.`);
  }
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(manifest.authorization.key_id || '')) {
    fail('manifest.authorization.key_id is invalid.');
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(manifest.authorization.signature || '')) {
    fail('manifest.authorization.signature is not valid base64.');
  }

  assertPlainObject(manifest.payload, 'manifest.payload');
  const payload = manifest.payload;
  assertExactKeys(
    payload,
    ['schema_version', 'release_candidate_id', 'base_sha', 'files', 'patch', 'validation'],
    'manifest.payload'
  );
  if (payload.schema_version !== ARTIFACT_SCHEMA_VERSION) {
    fail(`Unsupported payload schema version: ${payload.schema_version}.`);
  }
  assertGitSha(payload.base_sha, 'manifest.payload.base_sha');
  if (!Array.isArray(payload.files) || payload.files.length === 0) {
    fail('manifest.payload.files must be a non-empty array.');
  }
  if (!Array.isArray(payload.patch) || !Array.isArray(payload.validation)) {
    fail('manifest.payload.patch and manifest.payload.validation must be arrays.');
  }

  const seenPaths = new Set();
  let previousPath = '';
  for (const [index, file] of payload.files.entries()) {
    assertPlainObject(file, `manifest.payload.files[${index}]`);
    assertExactKeys(
      file,
      ['path', 'before_sha256', 'after_sha256', 'before_size', 'after_size'],
      `manifest.payload.files[${index}]`
    );
    const filePath = assertSafePayloadPath(file.path);
    if (seenPaths.has(filePath)) fail(`Duplicate artifact file path: ${filePath}.`);
    if (previousPath && filePath.localeCompare(previousPath) <= 0) {
      fail('manifest.payload.files must be sorted by path.');
    }
    seenPaths.add(filePath);
    previousPath = filePath;
    assertDigest(file.before_sha256, `${filePath} before_sha256`);
    assertDigest(file.after_sha256, `${filePath} after_sha256`);
    assertByteSize(file.before_size, `${filePath} before_size`);
    assertByteSize(file.after_size, `${filePath} after_size`);
  }

  const recomputedHash = sha256(canonicalJson(payload));
  if (recomputedHash !== manifest.artifact_hash) {
    fail(`Publication artifact hash mismatch: expected ${manifest.artifact_hash}, recomputed ${recomputedHash}.`);
  }
  const unsignedManifest = {
    schema_version: manifest.schema_version,
    artifact_hash: manifest.artifact_hash,
    branch_name: manifest.branch_name,
    repository_full_name: manifest.repository_full_name,
    default_branch: manifest.default_branch,
    payload: manifest.payload,
    authorization: {
      algorithm: manifest.authorization.algorithm,
      key_id: manifest.authorization.key_id,
    },
  };
  const signatureValid = crypto.verify(
    'RSA-SHA256',
    Buffer.from(canonicalJson(unsignedManifest)),
    signingPublicKey(manifest.authorization.key_id),
    Buffer.from(manifest.authorization.signature, 'base64')
  );
  if (!signatureValid) fail('Publication manifest authorization signature is invalid.');
  const expectedBranch = publicationBranchName(payload.release_candidate_id, manifest.artifact_hash);
  if (manifest.branch_name !== expectedBranch) {
    fail(`Publication branch mismatch: expected ${expectedBranch}, found ${manifest.branch_name}.`);
  }

  assertPlainObject(marker, 'Release marker');
  assertExactKeys(marker, ['schema_version', 'release_id', 'artifact_hash'], 'Release marker');
  if (
    marker.schema_version !== ARTIFACT_SCHEMA_VERSION
    || marker.release_id !== payload.release_candidate_id
    || marker.artifact_hash !== manifest.artifact_hash
  ) {
    fail('Release marker does not match the sealed publication manifest.');
  }

  return { payload, expectedBranch };
}

function validatePullRequestIdentity(event, manifest, payload, localHeadSha) {
  const pullRequest = event.pull_request;
  assertPlainObject(pullRequest, 'GitHub pull_request event');
  assertPlainObject(pullRequest.head, 'pull_request.head');
  assertPlainObject(pullRequest.base, 'pull_request.base');

  const headRepo = lowerRepo(pullRequest.head.repo?.full_name);
  const baseRepo = lowerRepo(pullRequest.base.repo?.full_name);
  const sealedRepo = lowerRepo(manifest.repository_full_name);
  const workflowRepo = lowerRepo(process.env.GITHUB_REPOSITORY);
  if (!headRepo || headRepo !== baseRepo) fail('Publication pull requests must originate from the base repository, not a fork.');
  if (headRepo !== sealedRepo) fail('Pull request repository does not match manifest.repository_full_name.');
  if (workflowRepo && workflowRepo !== sealedRepo) fail('GITHUB_REPOSITORY does not match manifest.repository_full_name.');
  if (pullRequest.head.ref !== manifest.branch_name) fail('Pull request head ref does not match manifest.branch_name.');
  if (pullRequest.base.ref !== manifest.default_branch) fail('Pull request base ref does not match manifest.default_branch.');
  if (pullRequest.base.sha !== payload.base_sha) fail('Pull request base SHA does not match the sealed artifact base SHA.');
  if (pullRequest.head.sha !== localHeadSha) fail('Checked-out HEAD does not match the pull request head SHA.');
}

function assertSingleParent(headSha, baseSha) {
  const parts = gitText(['rev-list', '--parents', '-n', '1', headSha]).split(/\s+/);
  if (parts[0] !== headSha || parts.length !== 2 || parts[1] !== baseSha) {
    fail('Publication HEAD must be exactly one commit whose sole parent is the sealed base SHA.');
  }
}

function assertExactChangedPaths(actual, payloadFiles) {
  const expected = [...payloadFiles.map(file => file.path), MARKER_PATH, MANIFEST_PATH].sort();
  if (actual.length !== expected.length || actual.some((filePath, index) => filePath !== expected[index])) {
    fail(
      `Publication changed-path set is not sealed. Expected [${expected.join(', ')}], found [${actual.join(', ')}].`
    );
  }
}

function assertWorkspaceMatchesCommit(headSha, filePath, maxBytes, label) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${label} must be a regular file.`);
  if (stat.size > maxBytes) fail(`${label} exceeds the ${maxBytes}-byte limit.`);
  const workspace = fs.readFileSync(filePath);
  const committed = gitBlob(headSha, filePath);
  if (!workspace.equals(committed)) fail(`${label} does not match the checked-out HEAD commit.`);
}

function verifyFileContents(payload, headSha) {
  for (const file of payload.files) {
    assertGitRegularBlob(payload.base_sha, file.path, 'Base');
    assertGitRegularBlob(headSha, file.path, 'Head');
    const before = gitBlob(payload.base_sha, file.path);
    const afterStat = fs.lstatSync(file.path);
    if (!afterStat.isFile() || afterStat.isSymbolicLink()) fail(`Published file ${file.path} must be a regular file.`);
    const after = gitBlob(headSha, file.path);
    const workspaceAfter = fs.readFileSync(file.path);

    if (before.length !== file.before_size || sha256(before) !== file.before_sha256) {
      fail(`Base content for ${file.path} does not match its sealed hash and byte size.`);
    }
    if (after.length !== file.after_size || sha256(after) !== file.after_sha256) {
      fail(`Head content for ${file.path} does not match its sealed hash and byte size.`);
    }
    if (!workspaceAfter.equals(after)) fail(`Published file ${file.path} does not match the checked-out HEAD commit.`);
  }
}

function readEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) fail('GITHUB_EVENT_PATH is required for pull-request verification.');
  return readBoundedJson(eventPath, 8 * 1024 * 1024, 'GitHub event payload');
}

export function verifyPublicationArtifact() {
  const eventName = process.env.GITHUB_EVENT_NAME || '';
  if (eventName !== 'pull_request' && eventName !== 'pull_request_target') {
    console.log(`Publication artifact verification skipped for ${eventName || 'a non-PR event'}.`);
    return { skipped: true };
  }

  const event = readEvent();
  const localHeadSha = gitText(['rev-parse', 'HEAD']);
  assertGitSha(localHeadSha, 'Checked-out HEAD');
  const eventBaseSha = event.pull_request?.base?.sha;
  assertGitSha(eventBaseSha, 'pull_request.base.sha');
  const eventHeadSha = event.pull_request?.head?.sha;
  assertGitSha(eventHeadSha, 'pull_request.head.sha');
  const paths = changedPaths(eventBaseSha, eventHeadSha);
  const publicationBranch = String(event.pull_request?.head?.ref || '').startsWith(PUBLICATION_BRANCH_PREFIX);
  const manifestTouched = paths.includes(MANIFEST_PATH);
  const markerTouched = paths.includes(MARKER_PATH);
  const protectedContentTouched = paths.some(isProtectedLiveDataPath);
  if (!publicationBranch && !manifestTouched && !markerTouched && !protectedContentTouched) {
    console.log('Publication artifact verification skipped for a normal pull request.');
    return { skipped: true };
  }
  if (protectedContentTouched && (!manifestTouched || !markerTouched)) {
    fail('Protected live data changes require both a signed publication manifest and release marker in the same PR.');
  }

  const manifest = readBoundedJson(MANIFEST_PATH, MAX_MANIFEST_BYTES, 'Publication manifest');
  const marker = readBoundedJson(MARKER_PATH, MAX_MARKER_BYTES, 'Release marker');
  assertExactPublisherJsonBytes(MANIFEST_PATH, manifest, 'Publication manifest');
  assertExactPublisherJsonBytes(MARKER_PATH, marker, 'Release marker');
  assertWorkspaceMatchesCommit(localHeadSha, MANIFEST_PATH, MAX_MANIFEST_BYTES, 'Publication manifest');
  assertWorkspaceMatchesCommit(localHeadSha, MARKER_PATH, MAX_MARKER_BYTES, 'Release marker');
  assertGitRegularBlob(localHeadSha, MANIFEST_PATH, 'Head');
  assertGitRegularBlob(localHeadSha, MARKER_PATH, 'Head');
  const { payload } = validateManifestAndMarker(manifest, marker);
  validatePullRequestIdentity(event, manifest, payload, localHeadSha);
  assertSingleParent(localHeadSha, payload.base_sha);
  assertExactChangedPaths(paths, payload.files);
  verifyFileContents(payload, localHeadSha);

  console.log(
    `Verified sealed publication artifact ${manifest.artifact_hash} for release ${payload.release_candidate_id} `
    + `across ${payload.files.length} content file(s).`
  );
  return { skipped: false, artifactHash: manifest.artifact_hash };
}

function main() {
  try {
    verifyPublicationArtifact();
  } catch (error) {
    console.error(`Publication artifact verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
