import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEPLOYMENT_PROVENANCE_SCHEMA_VERSION,
  normalizeCommitSha,
  readDeploymentProvenance,
  resolveDeploymentProvenance,
  sanitizeDeploymentProvenance,
} from '../lib/deployment-provenance.js';

const gitSha = 'a'.repeat(40);
const envSha = 'B'.repeat(40);

assert.equal(normalizeCommitSha(` ${envSha}\n`), envSha.toLowerCase());
assert.equal(normalizeCommitSha('abc123'), null);
assert.equal(normalizeCommitSha('a'.repeat(39)), null);
assert.equal(normalizeCommitSha(`${'a'.repeat(40)} secret`), null);

const cleanGit = resolveDeploymentProvenance({
  root: '/repo',
  env: { DEPLOYMENT_COMMIT_SHA: envSha },
  gitExec(args) {
    if (args[0] === 'rev-parse') return `${gitSha}\n`;
    if (args[0] === 'status') return '';
    throw new Error(`Unexpected git arguments: ${args.join(' ')}`);
  },
});
assert.deepEqual(cleanGit, {
  schema_version: DEPLOYMENT_PROVENANCE_SCHEMA_VERSION,
  commit_sha: gitSha,
  source: 'git',
  source_clean: true,
});

const dirtyGit = resolveDeploymentProvenance({
  root: '/repo',
  env: {},
  gitExec(args) {
    if (args[0] === 'rev-parse') return gitSha;
    if (args[0] === 'status') return ' M server.js\n';
    throw new Error(`Unexpected git arguments: ${args.join(' ')}`);
  },
});
assert.equal(dirtyGit.source_clean, false);

const environmentFallback = resolveDeploymentProvenance({
  root: '/archive',
  env: {
    DEPLOYMENT_COMMIT_SHA: 'not-a-commit-or-secret-value',
    GITHUB_SHA: envSha,
  },
  gitExec() {
    throw new Error('No git metadata');
  },
});
assert.deepEqual(environmentFallback, {
  schema_version: DEPLOYMENT_PROVENANCE_SCHEMA_VERSION,
  commit_sha: envSha.toLowerCase(),
  source: 'environment',
  source_clean: null,
});

const unavailable = resolveDeploymentProvenance({
  root: '/archive',
  env: { DEPLOYMENT_COMMIT_SHA: 'database-password' },
  gitExec() {
    throw new Error('No git metadata');
  },
});
assert.deepEqual(unavailable, {
  schema_version: DEPLOYMENT_PROVENANCE_SCHEMA_VERSION,
  commit_sha: null,
  source: 'unavailable',
  source_clean: null,
});

assert.deepEqual(sanitizeDeploymentProvenance({
  schema_version: 1,
  commit_sha: gitSha,
  source: 'git',
  source_clean: true,
  accidental_secret: 'must not survive sanitization',
}), cleanGit);
assert.deepEqual(sanitizeDeploymentProvenance({
  schema_version: 2,
  commit_sha: gitSha,
  source: 'git',
  source_clean: true,
}), {
  schema_version: 1,
  commit_sha: null,
  source: 'unavailable',
  source_clean: null,
});
assert.deepEqual(sanitizeDeploymentProvenance({
  schema_version: 1,
  commit_sha: gitSha,
  source: 'attacker-controlled-source',
  source_clean: true,
}), {
  schema_version: 1,
  commit_sha: null,
  source: 'unavailable',
  source_clean: null,
});

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jntustack-deployment-'));
try {
  const markerPath = path.join(tempDir, 'deployment.json');
  fs.writeFileSync(markerPath, JSON.stringify({
    schema_version: 1,
    commit_sha: gitSha,
    source: 'environment',
    source_clean: true,
    extra: 'ignored',
  }));
  assert.deepEqual(readDeploymentProvenance(markerPath), {
    schema_version: 1,
    commit_sha: gitSha,
    source: 'environment',
    source_clean: null,
  });

  fs.writeFileSync(markerPath, '{invalid');
  assert.deepEqual(readDeploymentProvenance(markerPath), {
    schema_version: 1,
    commit_sha: null,
    source: 'unavailable',
    source_clean: null,
  });
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('Deployment provenance tests passed.');
