#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  canonicalJson,
  publicationBranchName,
  sha256,
} from './verify-publication-artifact.js';

const verifierPath = fileURLToPath(new URL('./verify-publication-artifact.js', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jntustack-publication-gate-'));
const signingKeyId = 'test-2026-07';
const { privateKey: signingPrivateKey, publicKey: signingPublicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const signingPublicKeysJson = JSON.stringify({
  [signingKeyId]: Buffer.from(signingPublicKey.export({ type: 'spki', format: 'pem' })).toString('base64'),
});

function yamlBlock(source, key, indentation) {
  const lines = source.split('\n');
  const prefix = `${' '.repeat(indentation)}${key}:`;
  const start = lines.findIndex((line) => line.startsWith(prefix));
  assert.notEqual(start, -1, `Workflow must define ${key}`);

  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    const leadingSpaces = line.match(/^ */)[0].length;
    if (line.trim() && leadingSpaces <= indentation) break;
    end += 1;
  }
  return lines.slice(start, end).join('\n');
}

function workflowSteps(source) {
  const lines = source.split('\n');
  const starts = lines
    .map((line, index) => (/^ {6}- /.test(line) ? index : -1))
    .filter((index) => index !== -1);

  return starts.map((start, index) => {
    const nextStep = starts[index + 1] ?? lines.length;
    let end = start + 1;
    while (end < nextStep) {
      const line = lines[end];
      const leadingSpaces = line.match(/^ */)[0].length;
      if (line.trim() && leadingSpaces < 6) break;
      end += 1;
    }
    return lines.slice(start, end).join('\n');
  });
}

function literalRunBody(step) {
  const lines = step.split('\n');
  const runLine = lines.findIndex((line) => /^ {8}run:\s*\|\s*$/.test(line));
  assert.notEqual(runLine, -1, 'Expected a literal workflow run block');
  const bodyLines = [];
  for (const line of lines.slice(runLine + 1)) {
    const leadingSpaces = line.match(/^ */)[0].length;
    if (line.trim() && leadingSpaces < 10) break;
    bodyLines.push(line);
  }
  return bodyLines
    .map((line) => line.startsWith(' '.repeat(10)) ? line.slice(10) : line)
    .join('\n')
    .trimEnd();
}

function assertMainPullRequestTrigger(source, eventName, workflowName) {
  const trigger = yamlBlock(source, eventName, 2);
  assert.match(
    trigger,
    /^ {4}branches:\s*\[[^\]]*\bmain\b[^\]]*\]\s*$/m,
    `${workflowName} must run only for pull requests targeting main`,
  );
  assert.match(
    trigger,
    /^ {4}types:\s*\[[^\]]*\bedited\b[^\]]*\]\s*$/m,
    `${workflowName} must rerun when pull-request metadata is edited`,
  );
}

function assertActionRefsAreImmutable(source, workflowName) {
  const actionRefs = [...source.matchAll(/^\s*- uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)]
    .map((match) => match[1]);
  assert.ok(actionRefs.length > 0, `${workflowName} must use at least one action`);
  for (const actionRef of actionRefs) {
    assert.match(
      actionRef,
      /^[^@\s]+@[0-9a-f]{40}$/i,
      `${workflowName} action ${actionRef} must be pinned to a full commit SHA`,
    );
  }
}

function assertDefaultBranchGuard(source, workflowName) {
  assert.match(
    source,
    /PR_BASE_REF:\s*\$\{\{ github\.event\.pull_request\.base\.ref \}\}/,
    `${workflowName} must read the pull request base ref`,
  );
  assert.match(
    source,
    /REPOSITORY_DEFAULT_BRANCH:\s*\$\{\{ github\.event\.repository\.default_branch \}\}/,
    `${workflowName} must read the repository default branch`,
  );
  assert.match(
    source,
    /\[\[\s+-z "\$REPOSITORY_DEFAULT_BRANCH"\s+\|\|\s+"\$PR_BASE_REF"\s+!=\s+"\$REPOSITORY_DEFAULT_BRANCH"\s+\]\]/,
    `${workflowName} must reject pull requests whose base is not the default branch`,
  );
}

function assertPublicationWorkflowTrustRoot() {
  const verifyWorkflow = fs.readFileSync(
    path.join(repositoryRoot, '.github/workflows/verify.yml'),
    'utf8',
  );
  const integrityWorkflow = fs.readFileSync(
    path.join(repositoryRoot, '.github/workflows/publication-integrity.yml'),
    'utf8',
  );

  assertMainPullRequestTrigger(verifyWorkflow, 'pull_request', 'verify workflow');
  assertMainPullRequestTrigger(
    integrityWorkflow,
    'pull_request_target',
    'publication-integrity workflow',
  );
  assertActionRefsAreImmutable(verifyWorkflow, 'verify workflow');
  assertActionRefsAreImmutable(integrityWorkflow, 'publication-integrity workflow');
  assertDefaultBranchGuard(verifyWorkflow, 'verify workflow');
  assertDefaultBranchGuard(integrityWorkflow, 'publication-integrity workflow');

  const integritySteps = workflowSteps(integrityWorkflow);
  const integrityRunSteps = integritySteps.filter((step) => /^ {8}run:\s*\|\s*$/m.test(step));
  assert.equal(
    integrityRunSteps.length,
    2,
    'Any new publication-integrity shell step must be reviewed as a possible head-code execution path',
  );

  const baseGuard = integritySteps.find((step) => step.includes('Require the repository default branch as PR base'));
  assert.ok(baseGuard, 'publication-integrity workflow must have a default-branch guard step');
  assert.equal(
    literalRunBody(baseGuard),
    [
      'if [[ -z "$REPOSITORY_DEFAULT_BRANCH" || "$PR_BASE_REF" != "$REPOSITORY_DEFAULT_BRANCH" ]]; then',
      '  echo "Publication integrity checks only trust the repository default branch as the pull-request base."',
      '  exit 1',
      'fi',
    ].join('\n'),
    'publication-integrity base guard must not execute workspace/head code',
  );

  const headCheckout = integritySteps.find((step) => step.includes('uses: actions/checkout@'));
  assert.ok(headCheckout, 'publication-integrity workflow must fetch the immutable PR head as data');
  assert.match(
    headCheckout,
    /ref:\s*\$\{\{ github\.event\.pull_request\.head\.sha \}\}/,
    'publication-integrity checkout must use the immutable head SHA, not a mutable branch ref',
  );
  assert.match(
    headCheckout,
    /persist-credentials:\s*false/,
    'publication-integrity checkout must not retain repository credentials',
  );

  const trustedVerifier = integritySteps.find((step) => step.includes('Run verifier from the trusted base commit'));
  assert.ok(trustedVerifier, 'publication-integrity workflow must have a trusted-base verifier step');
  assert.match(
    trustedVerifier,
    /git show "\$\{PR_BASE_SHA\}:scripts\/verify-publication-artifact\.js"\s*>\s*"\$RUNNER_TEMP\/verify-publication-artifact\.mjs"/,
    'publication-integrity workflow must extract verifier code from the trusted base commit',
  );
  assert.match(
    trustedVerifier,
    /node "\$RUNNER_TEMP\/verify-publication-artifact\.mjs"/,
    'publication-integrity workflow must execute only the base-owned verifier copy',
  );
  assert.equal(
    literalRunBody(trustedVerifier),
    [
      'git show "${PR_BASE_SHA}:scripts/verify-publication-artifact.js" > "$RUNNER_TEMP/verify-publication-artifact.mjs"',
      'node "$RUNNER_TEMP/verify-publication-artifact.mjs"',
    ].join('\n'),
    'publication-integrity workflow must not install dependencies or execute workspace/head code',
  );
}

function signedManifest({ artifactHash, branchName, payload }) {
  const unsigned = {
    schema_version: 1,
    artifact_hash: artifactHash,
    branch_name: branchName,
    repository_full_name: 'example/jntustack',
    default_branch: 'main',
    payload,
    authorization: { algorithm: 'RS256', key_id: signingKeyId },
  };
  return {
    ...unsigned,
    authorization: {
      ...unsigned.authorization,
      signature: crypto.sign('RSA-SHA256', Buffer.from(canonicalJson(unsigned)), signingPrivateKey).toString('base64'),
    },
  };
}

function publisherJson(value) {
  return `${JSON.stringify(JSON.parse(canonicalJson(value)), null, 2)}\n`;
}

function git(args) {
  return execFileSync('git', args, { cwd: tempRoot, encoding: 'utf8' }).trim();
}

function write(relativePath, contents) {
  const target = path.join(tempRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function runVerifier(eventPath) {
  return spawnSync(process.execPath, [verifierPath], {
    cwd: tempRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REPOSITORY: 'example/jntustack',
      PUBLICATION_SIGNING_PUBLIC_KEYS_JSON: signingPublicKeysJson,
    },
  });
}

try {
  assertPublicationWorkflowTrustRoot();

  git(['init', '-b', 'main']);
  git(['config', 'user.name', 'Publication Gate Test']);
  git(['config', 'user.email', 'publication-gate@example.invalid']);

  const before = Buffer.from('{\n  "subjects": []\n}\n');
  const after = Buffer.from('{\n  "subjects": [{"id":"R23-CSE-TEST"}]\n}\n');
  write('data/subjects-test.json', before);
  git(['add', 'data/subjects-test.json']);
  git(['commit', '-m', 'baseline']);
  const baseSha = git(['rev-parse', 'HEAD']);

  git(['switch', '-c', 'docs-only-test']);
  write('README.md', 'ordinary pull request\n');
  git(['add', 'README.md']);
  git(['commit', '-m', 'ordinary change']);
  const ordinaryHeadSha = git(['rev-parse', 'HEAD']);
  const eventPath = path.join(tempRoot, 'event.json');
  fs.writeFileSync(eventPath, JSON.stringify({
    pull_request: {
      head: { ref: 'docs-only-test', sha: ordinaryHeadSha, repo: { full_name: 'example/jntustack' } },
      base: { ref: 'main', sha: baseSha, repo: { full_name: 'example/jntustack' } },
    },
  }));
  const ordinary = runVerifier(eventPath);
  assert.equal(ordinary.status, 0, ordinary.stderr);
  assert.match(ordinary.stdout, /skipped for a normal pull request/);
  git(['switch', 'main']);

  git(['switch', '-c', 'direct-data-bypass']);
  write('data/subjects-odd name.json', after);
  git(['add', 'data/subjects-odd name.json']);
  git(['commit', '-m', 'attempt direct live data edit']);
  const bypassHeadSha = git(['rev-parse', 'HEAD']);
  fs.writeFileSync(eventPath, JSON.stringify({
    pull_request: {
      head: { ref: 'direct-data-bypass', sha: bypassHeadSha, repo: { full_name: 'example/jntustack' } },
      base: { ref: 'main', sha: baseSha, repo: { full_name: 'example/jntustack' } },
    },
  }));
  const bypass = runVerifier(eventPath);
  assert.notEqual(bypass.status, 0);
  assert.match(bypass.stderr, /Protected live data changes require/);
  git(['switch', 'main']);

  const releaseCandidateId = 42;
  const payload = {
    schema_version: 1,
    release_candidate_id: releaseCandidateId,
    base_sha: baseSha,
    files: [{
      path: 'data/subjects-test.json',
      before_sha256: sha256(before),
      after_sha256: sha256(after),
      before_size: before.length,
      after_size: after.length,
    }],
    patch: [],
    validation: [],
  };
  const artifactHash = sha256(canonicalJson(payload));
  const branchName = publicationBranchName(releaseCandidateId, artifactHash);
  git(['switch', '-c', branchName]);
  write('data/subjects-test.json', after);
  write('data/release.json', publisherJson({
    schema_version: 1,
    release_id: releaseCandidateId,
    artifact_hash: artifactHash,
  }));
  const manifest = signedManifest({ artifactHash, branchName, payload });
  write('data/release-artifact.json', publisherJson(manifest));
  git(['add', 'data']);
  git(['commit', '-m', 'reviewed publication artifact']);
  const headSha = git(['rev-parse', 'HEAD']);

  const event = {
    pull_request: {
      head: { ref: branchName, sha: headSha, repo: { full_name: 'example/jntustack' } },
      base: { ref: 'main', sha: baseSha, repo: { full_name: 'example/jntustack' } },
    },
  };
  fs.writeFileSync(eventPath, JSON.stringify(event));

  const verified = runVerifier(eventPath);
  assert.equal(verified.status, 0, verified.stderr);
  assert.match(verified.stdout, /Verified sealed publication artifact/);

  write('data/release-artifact.json', `${JSON.stringify(manifest)}\n`);
  git(['add', 'data/release-artifact.json']);
  git(['commit', '--amend', '--no-edit']);
  event.pull_request.head.sha = git(['rev-parse', 'HEAD']);
  fs.writeFileSync(eventPath, JSON.stringify(event));
  const reformattedManifest = runVerifier(eventPath);
  assert.notEqual(reformattedManifest.status, 0);
  assert.match(reformattedManifest.stderr, /exact deterministic JSON encoding/);
  git(['reset', '--hard', headSha]);
  event.pull_request.head.sha = headSha;
  fs.writeFileSync(eventPath, JSON.stringify(event));

  const reorderedManifest = {
    payload: manifest.payload,
    authorization: manifest.authorization,
    default_branch: manifest.default_branch,
    repository_full_name: manifest.repository_full_name,
    branch_name: manifest.branch_name,
    artifact_hash: manifest.artifact_hash,
    schema_version: manifest.schema_version,
  };
  write('data/release-artifact.json', `${JSON.stringify(reorderedManifest, null, 2)}\n`);
  git(['add', 'data/release-artifact.json']);
  git(['commit', '--amend', '--no-edit']);
  event.pull_request.head.sha = git(['rev-parse', 'HEAD']);
  fs.writeFileSync(eventPath, JSON.stringify(event));
  const reorderedEncoding = runVerifier(eventPath);
  assert.notEqual(reorderedEncoding.status, 0);
  assert.match(reorderedEncoding.stderr, /exact deterministic JSON encoding/);
  git(['reset', '--hard', headSha]);
  event.pull_request.head.sha = headSha;
  fs.writeFileSync(eventPath, JSON.stringify(event));

  const badSignatureManifest = {
    ...manifest,
    authorization: {
      ...manifest.authorization,
      signature: `${manifest.authorization.signature.slice(0, -4)}AAAA`,
    },
  };
  write('data/release-artifact.json', publisherJson(badSignatureManifest));
  git(['add', 'data/release-artifact.json']);
  git(['commit', '--amend', '--no-edit']);
  event.pull_request.head.sha = git(['rev-parse', 'HEAD']);
  fs.writeFileSync(eventPath, JSON.stringify(event));
  const invalidSignature = runVerifier(eventPath);
  assert.notEqual(invalidSignature.status, 0);
  assert.match(invalidSignature.stderr, /authorization signature is invalid/);
  git(['reset', '--hard', headSha]);
  event.pull_request.head.sha = headSha;
  fs.writeFileSync(eventPath, JSON.stringify(event));

  git(['update-index', '--chmod=+x', 'data/subjects-test.json']);
  git(['commit', '--amend', '--no-edit']);
  event.pull_request.head.sha = git(['rev-parse', 'HEAD']);
  fs.writeFileSync(eventPath, JSON.stringify(event));
  const executableMode = runVerifier(eventPath);
  assert.notEqual(executableMode.status, 0);
  assert.match(executableMode.stderr, /must be a non-executable 100644 Git blob/);
  git(['reset', '--hard', headSha]);
  event.pull_request.head.sha = headSha;
  fs.writeFileSync(eventPath, JSON.stringify(event));

  fs.appendFileSync(path.join(tempRoot, 'data/subjects-test.json'), 'tampered\n');
  const tampered = runVerifier(eventPath);
  assert.notEqual(tampered.status, 0);
  assert.match(tampered.stderr, /does not match the checked-out HEAD commit/);

  // Even a self-consistent replacement manifest cannot pass on the already
  // reviewed ref: the full artifact digest is anchored in the branch name.
  git(['reset', '--hard', 'HEAD']);
  const alternateAfter = Buffer.from('{\n  "subjects": [{"id":"R23-CSE-ALTERED"}]\n}\n');
  const alternatePayload = {
    ...payload,
    files: [{
      ...payload.files[0],
      after_sha256: sha256(alternateAfter),
      after_size: alternateAfter.length,
    }],
  };
  const alternateHash = sha256(canonicalJson(alternatePayload));
  write('data/subjects-test.json', alternateAfter);
  write('data/release.json', publisherJson({
    schema_version: 1,
    release_id: releaseCandidateId,
    artifact_hash: alternateHash,
  }));
  write('data/release-artifact.json', publisherJson(signedManifest({
    artifactHash: alternateHash,
    branchName,
    payload: alternatePayload,
  })));
  git(['add', 'data']);
  git(['commit', '--amend', '--no-edit']);
  event.pull_request.head.sha = git(['rev-parse', 'HEAD']);
  fs.writeFileSync(eventPath, JSON.stringify(event));
  const rehashedTamper = runVerifier(eventPath);
  assert.notEqual(rehashedTamper.status, 0);
  assert.match(rehashedTamper.stderr, /Publication branch mismatch/);

  console.log('Publication artifact verifier tests passed.');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
