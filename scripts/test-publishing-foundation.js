import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  AssetIntegrityError,
  LocalAssetStorage,
  R2AssetStorage,
  createAssetStorage,
  sha256,
} from '../lib/asset-storage.js';
import {
  assetStorageExists,
  getAssetFileStatus,
  readAssetBuffer,
} from '../lib/assets.js';
import { GitHubAppClient, createGitHubAppJwt } from '../lib/github-app-client.js';
import { acquireReleasePublicationLocks } from '../lib/release-publication-lock.js';
import { getContentPublicationMode, getGitHubPublicationTrustReady } from '../lib/config.js';
import {
  buildPublicationArtifact,
  canonicalJson,
  canonicalPrettyJson,
  hashPublicationValue,
  githubPublicationActionAllowed,
  publicationArtifactManifest,
  githubPublicationStatusForVerification,
  publicationBranchName,
  publicationIdempotencyKey,
  releaseMarker,
  storedPublicationManifestBuffer,
  verifyDeploymentMarker,
} from '../lib/github-publisher.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'jntustack-publishing-'));
try {
  const storage = new LocalAssetStorage({ root: tempRoot, maxBytes: 1024 });
  const body = Buffer.from('official source evidence');
  const checksum = sha256(body);
  const first = await storage.putImmutable({ body, contentType: 'application/pdf', sha256: checksum });
  assert.equal(first.provider, 'local');
  assert.equal(first.key, `source-assets/sha256/${checksum.slice(0, 2)}/${checksum}`);
  assert.equal(first.reused, false);
  assert.deepEqual(await storage.getBuffer({
    provider: 'local',
    key: first.key,
    expectedSha256: checksum,
  }), body);
  assert.equal(await storage.exists({ provider: 'local', key: first.key, expectedSha256: checksum }), true);

  const second = await storage.putImmutable({ body, contentType: 'application/pdf', sha256: checksum });
  assert.equal(second.reused, true);
  await assert.rejects(
    storage.getBuffer({ provider: 'local', key: first.key, expectedSha256: '0'.repeat(64) }),
    err => err instanceof AssetIntegrityError && err.code === 'checksum_mismatch'
  );
  await assert.rejects(
    storage.getBuffer({ provider: 'local', key: first.key, expectedSha256: checksum, maxBytes: 4 }),
    err => err instanceof AssetIntegrityError && err.code === 'asset_too_large'
  );

  const legacyBody = Buffer.from('legacy local evidence');
  const legacyPath = path.join('storage', 'source-assets', '7', 'legacy.pdf');
  await fs.mkdir(path.join(tempRoot, path.dirname(legacyPath)), { recursive: true });
  await fs.writeFile(path.join(tempRoot, legacyPath), legacyBody);
  const legacyAsset = {
    id: 7,
    storageProvider: 'local',
    storageKey: null,
    localStoragePath: legacyPath,
    sha256Checksum: sha256(legacyBody),
  };
  assert.deepEqual(await readAssetBuffer({ root: tempRoot, asset: legacyAsset }), legacyBody);
  assert.equal(await assetStorageExists({ root: tempRoot, asset: legacyAsset }), true);
  await assert.rejects(
    readAssetBuffer({ root: tempRoot, asset: { ...legacyAsset, sha256Checksum: null } }),
    err => err instanceof AssetIntegrityError && err.code === 'checksum_missing'
  );

  const r2Body = Buffer.from('remote R2 evidence');
  const r2Key = `source-assets/sha256/${sha256(r2Body).slice(0, 2)}/${sha256(r2Body)}`;
  const fakeR2Storage = {
    provider: 'r2',
    async getBuffer({ provider, key, expectedSha256 }) {
      assert.equal(provider, 'r2');
      assert.equal(key, r2Key);
      assert.equal(expectedSha256, sha256(r2Body));
      return r2Body;
    },
    async exists({ provider, key, expectedSha256 }) {
      assert.equal(provider, 'r2');
      assert.equal(key, r2Key);
      assert.equal(expectedSha256, sha256(r2Body));
      return true;
    },
  };
  const r2Asset = {
    id: 8,
    storageProvider: 'r2',
    storageKey: r2Key,
    localStoragePath: null,
    sha256Checksum: sha256(r2Body),
  };
  assert.deepEqual(await readAssetBuffer({ root: tempRoot, asset: r2Asset, storage: fakeR2Storage }), r2Body);
  assert.equal((await getAssetFileStatus(tempRoot, r2Asset, { storage: fakeR2Storage })).status, 'present');
  const invalidStatus = await getAssetFileStatus(tempRoot, r2Asset, {
    storage: {
      provider: 'r2',
      async exists() {
        throw new AssetIntegrityError('tampered', 'checksum_mismatch');
      },
    },
  });
  assert.equal(invalidStatus.status, 'invalid');
  assert.equal(invalidStatus.repairAvailable, false);

  assert.throws(
    () => createAssetStorage({ env: { ASSET_STORAGE_PROVIDER: 'r2' }, root: tempRoot }),
    /R2 configuration is incomplete/
  );
  let storedR2Object = null;
  const successfulR2 = new R2AssetStorage({
    accountId: 'account',
    accessKeyId: 'access',
    secretAccessKey: 'secret',
    bucket: 'private-bucket',
    fetchImpl: async (_url, options) => {
      if (options.method === 'PUT') {
        storedR2Object = Buffer.from(options.body);
        return new Response(null, { status: 200, headers: { etag: 'immutable-etag' } });
      }
      if (options.method === 'GET' && storedR2Object) {
        return new Response(storedR2Object, {
          status: 200,
          headers: { 'content-length': String(storedR2Object.length) },
        });
      }
      return new Response(null, { status: 404 });
    },
  });
  const successfulR2Write = await successfulR2.putImmutable({
    body,
    contentType: 'application/pdf',
    sha256: checksum,
  });
  assert.equal(successfulR2Write.reused, false);
  assert.equal(successfulR2Write.etag, 'immutable-etag');
  assert.equal(await successfulR2.exists({
    provider: 'r2',
    key: successfulR2Write.key,
    expectedSha256: checksum,
  }), true);

  const r2Failure = new R2AssetStorage({
    accountId: 'account',
    accessKeyId: 'access',
    secretAccessKey: 'secret',
    bucket: 'private-bucket',
    now: () => new Date('2026-07-18T12:00:00Z'),
    fetchImpl: async () => new Response('denied', { status: 403 }),
  });
  await assert.rejects(
    r2Failure.putImmutable({ body, contentType: 'application/pdf', sha256: checksum }),
    /R2 immutable upload failed \(403\)/
  );
  const oversizedR2Body = Buffer.from('untrusted oversized evidence');
  const r2Oversized = new R2AssetStorage({
    accountId: 'account',
    accessKeyId: 'access',
    secretAccessKey: 'secret',
    bucket: 'private-bucket',
    maxBytes: 4,
    fetchImpl: async () => new Response(oversizedR2Body, { status: 200 }),
  });
  await assert.rejects(
    r2Oversized.getBuffer({
      provider: 'r2',
      key: `source-assets/sha256/${sha256(oversizedR2Body).slice(0, 2)}/${sha256(oversizedR2Body)}`,
      expectedSha256: sha256(oversizedR2Body),
    }),
    err => err instanceof AssetIntegrityError && err.code === 'asset_too_large'
  );

  const beforeDocument = {
    subjects: [
      { id: 'existing', name: 'Before' },
    ],
  };
  const beforeBuffer = Buffer.from(`${JSON.stringify(beforeDocument, null, 2)}\n`);
  const plan = {
    release_candidate_id: 42,
    final_warnings: [],
    validation_summary: [{ proposal_id: 11, status: 'passed' }],
    changes: [
      {
        order: 1,
        proposal_id: 11,
        entity_type: 'subject',
        entity_key: 'existing',
        file: 'data/subjects-test.json',
        operation: 'replace',
        index: 0,
        before_json: { id: 'existing', name: 'Before' },
        after_json: { id: 'existing', name: 'After' },
      },
      {
        order: 2,
        proposal_id: 12,
        entity_type: 'subject',
        entity_key: 'new',
        file: 'data/subjects-test.json',
        operation: 'add',
        index: 1,
        before_json: null,
        after_json: { id: 'new', name: 'New' },
      },
    ],
    combined_patch: [
      { file: 'data/subjects-test.json', collection: 'subjects', proposal_id: 11, op: 'replace' },
      { file: 'data/subjects-test.json', collection: 'subjects', proposal_id: 12, op: 'add' },
    ],
  };
  const snapshot = {
    headSha: 'a'.repeat(40),
    treeSha: 'b'.repeat(40),
    files: new Map([['data/subjects-test.json', { buffer: beforeBuffer }]]),
  };
  const artifact = buildPublicationArtifact({
    releaseCandidateId: 42,
    baseSha: snapshot.headSha,
    plan,
    snapshot,
  });
  assert.equal(artifact.schemaVersion, 1);
  assert.match(artifact.artifactHash, /^[a-f0-9]{64}$/);
  assert.equal(artifact.payload.files[0].before_size, beforeBuffer.length);
  assert.equal(artifact.payload.files[0].after_size, artifact.files[0].afterBuffer.length);
  assert.deepEqual(JSON.parse(artifact.files[0].afterBuffer), {
    subjects: [
      { id: 'existing', name: 'After' },
      { id: 'new', name: 'New' },
    ],
  });
  assert.equal(publicationBranchName(42, artifact.artifactHash), `jntustack/rc-42-${artifact.artifactHash}`);
  assert.equal(
    publicationIdempotencyKey(42, artifact.artifactHash),
    publicationIdempotencyKey(42, artifact.artifactHash)
  );
  assert.notEqual(publicationIdempotencyKey(42, artifact.artifactHash), publicationIdempotencyKey(43, artifact.artifactHash));
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
  assert.deepEqual(releaseMarker({ releaseCandidateId: 42, artifactHash: artifact.artifactHash }), {
    schema_version: 1,
    release_id: 42,
    artifact_hash: artifact.artifactHash,
  });
  const { privateKey: publicationSigningPrivateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const signedManifest = publicationArtifactManifest({
    artifactHash: artifact.artifactHash,
    branchName: publicationBranchName(42, artifact.artifactHash),
    repositoryFullName: 'example/jntustack',
    defaultBranch: 'main',
    payload: artifact.payload,
    signingPrivateKey: publicationSigningPrivateKey.export({ type: 'pkcs8', format: 'pem' }),
    signingKeyId: 'test-2026-07',
  });
  assert.deepEqual(signedManifest.payload, artifact.payload);
  assert.deepEqual(
    { ...signedManifest.authorization, signature: undefined },
    { algorithm: 'RS256', key_id: 'test-2026-07', signature: undefined }
  );
  assert.match(signedManifest.authorization.signature, /^[A-Za-z0-9+/]+={0,2}$/);
  const signedManifestBuffer = Buffer.from(canonicalPrettyJson(signedManifest));
  const storedManifestIdentity = {
    manifestBase64: signedManifestBuffer.toString('base64'),
    manifestSha256: hashPublicationValue(signedManifestBuffer),
    artifactHash: artifact.artifactHash,
    branchName: publicationBranchName(42, artifact.artifactHash),
    repositoryFullName: 'example/jntustack',
    defaultBranch: 'main',
    baseSha: artifact.baseSha,
    signingKeyId: 'test-2026-07',
  };
  assert.deepEqual(storedPublicationManifestBuffer(storedManifestIdentity), signedManifestBuffer);
  await assert.rejects(
    async () => storedPublicationManifestBuffer({
      ...storedManifestIdentity,
      manifestBase64: Buffer.from('tampered').toString('base64'),
    }),
    err => err?.code === 'tampered'
  );
  assert.equal(getContentPublicationMode({}), 'github_pr');
  assert.equal(getContentPublicationMode({ CONTENT_PUBLICATION_MODE: 'legacy' }), 'legacy');
  assert.equal(getGitHubPublicationTrustReady({}), false);
  assert.equal(getGitHubPublicationTrustReady({ GITHUB_PUBLICATION_TRUST_READY: 'true' }), true);
  assert.equal(githubPublicationActionAllowed('pr_open', 'refresh'), true);
  assert.equal(githubPublicationActionAllowed('deploy_pending', 'verify_deployment'), true);
  assert.equal(githubPublicationActionAllowed('verification_inconclusive', 'verify_deployment'), true);
  assert.equal(githubPublicationActionAllowed('superseded', 'verify_deployment'), false);
  assert.equal(githubPublicationActionAllowed('tampered', 'refresh'), false);
  assert.equal(githubPublicationActionAllowed('closed_unmerged', 'retry'), false);

  const staleSnapshot = {
    ...snapshot,
    files: new Map([['data/subjects-test.json', {
      buffer: Buffer.from(JSON.stringify({ subjects: [{ id: 'existing', name: 'Changed elsewhere' }] })),
    }]]),
  };
  assert.throws(
    () => buildPublicationArtifact({ releaseCandidateId: 42, baseSha: snapshot.headSha, plan, snapshot: staleSnapshot }),
    err => err?.code === 'stale_base'
  );

  function liveFetch({
    releaseId = 42,
    liveHash = artifact.artifactHash,
    releaseBody = null,
    releaseStatus = 200,
    healthBody = JSON.stringify({ status: 'ok' }),
    healthStatus = 200,
    sitemapBody = '<?xml version="1.0"?><urlset></urlset>',
    sitemapStatus = 200,
  } = {}) {
    return async url => {
      if (String(url).endsWith('/release.json')) {
        return new Response(
          releaseBody ?? JSON.stringify({ schema_version: 1, release_id: releaseId, artifact_hash: liveHash }),
          { status: releaseStatus }
        );
      }
      if (String(url).endsWith('/health')) {
        return new Response(healthBody, { status: healthStatus });
      }
      if (String(url).endsWith('/sitemap.xml')) {
        return new Response(sitemapBody, { status: sitemapStatus });
      }
      return new Response('missing', { status: 404 });
    };
  }
  const verified = await verifyDeploymentMarker({
    siteUrl: 'https://example.test',
    releaseCandidateId: 42,
    artifactHash: artifact.artifactHash,
    fetchImpl: liveFetch(),
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.outcome, 'verified');
  assert.equal(verified.revert_recommended, false);
  assert.equal(githubPublicationStatusForVerification(verified.outcome), 'deployed');
  const mismatch = await verifyDeploymentMarker({
    siteUrl: 'https://example.test',
    releaseCandidateId: 42,
    artifactHash: artifact.artifactHash,
    fetchImpl: liveFetch({ liveHash: 'f'.repeat(64) }),
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.outcome, 'mismatch');
  assert.equal(mismatch.reason_code, 'artifact_hash_mismatch');
  assert.equal(mismatch.revert_recommended, true);
  assert.equal(githubPublicationStatusForVerification(mismatch.outcome), 'verification_failed');

  const newer = await verifyDeploymentMarker({
    siteUrl: 'https://example.test',
    releaseCandidateId: 42,
    artifactHash: artifact.artifactHash,
    fetchImpl: liveFetch({ releaseId: 43, liveHash: 'e'.repeat(64) }),
  });
  assert.equal(newer.outcome, 'superseded');
  assert.equal(newer.revert_recommended, false);
  assert.equal(githubPublicationStatusForVerification(newer.outcome), 'superseded');

  const older = await verifyDeploymentMarker({
    siteUrl: 'https://example.test',
    releaseCandidateId: 42,
    artifactHash: artifact.artifactHash,
    fetchImpl: liveFetch({ releaseId: 41 }),
  });
  assert.equal(older.outcome, 'inconclusive');
  assert.equal(older.reason_code, 'older_release_live');
  assert.equal(older.revert_recommended, false);

  const networkFailure = await verifyDeploymentMarker({
    siteUrl: 'https://example.test',
    releaseCandidateId: 42,
    artifactHash: artifact.artifactHash,
    fetchImpl: async () => { throw new TypeError('temporary network failure'); },
  });
  assert.equal(networkFailure.outcome, 'inconclusive');
  assert.equal(networkFailure.revert_recommended, false);

  const redirectTarget = 'http://127.0.0.1:8080/private-health';
  const redirectRequests = [];
  const redirected = await verifyDeploymentMarker({
    siteUrl: 'https://example.test',
    releaseCandidateId: 42,
    artifactHash: artifact.artifactHash,
    fetchImpl: async (url, options = {}) => {
      redirectRequests.push(String(url));
      assert.equal(options.redirect, 'manual');
      if (String(url).endsWith('/release.json')) {
        return new Response('', {
          status: 302,
          headers: { location: redirectTarget },
        });
      }
      return liveFetch()(url);
    },
  });
  assert.equal(redirected.outcome, 'inconclusive');
  assert.equal(redirected.reason_code, 'release_redirect');
  assert.equal(redirected.revert_recommended, false);
  assert.equal(redirectRequests.includes(redirectTarget), false);
  assert.deepEqual(redirectRequests.sort(), [
    'https://example.test/health',
    'https://example.test/release.json',
    'https://example.test/sitemap.xml',
  ]);

  await assert.rejects(
    verifyDeploymentMarker({
      siteUrl: 'https://user:password@example.test',
      releaseCandidateId: 42,
      artifactHash: artifact.artifactHash,
      fetchImpl: liveFetch(),
    }),
    /must not contain embedded credentials/
  );
  await assert.rejects(
    verifyDeploymentMarker({
      siteUrl: 'http://example.test',
      releaseCandidateId: 42,
      artifactHash: artifact.artifactHash,
      fetchImpl: liveFetch(),
    }),
    /must use HTTPS/
  );

  const timedOut = await verifyDeploymentMarker({
    siteUrl: 'https://example.test',
    releaseCandidateId: 42,
    artifactHash: artifact.artifactHash,
    fetchImpl: async () => new Promise(() => {}),
    timeoutMs: 10,
  });
  assert.equal(timedOut.outcome, 'inconclusive');
  assert.equal(timedOut.reason_code, 'timeout');

  const serverError = await verifyDeploymentMarker({
    siteUrl: 'https://example.test',
    releaseCandidateId: 42,
    artifactHash: artifact.artifactHash,
    fetchImpl: liveFetch({ healthStatus: 503, healthBody: 'temporarily unavailable' }),
  });
  assert.equal(serverError.outcome, 'inconclusive');
  assert.equal(serverError.reason_code, 'health_http_5xx');

  const invalidTemporary = await verifyDeploymentMarker({
    siteUrl: 'https://example.test',
    releaseCandidateId: 42,
    artifactHash: artifact.artifactHash,
    fetchImpl: liveFetch({ releaseBody: '<html>deploying</html>' }),
  });
  assert.equal(invalidTemporary.outcome, 'inconclusive');
  assert.equal(invalidTemporary.reason_code, 'invalid_release_marker');

  const oversized = await verifyDeploymentMarker({
    siteUrl: 'https://example.test',
    releaseCandidateId: 42,
    artifactHash: artifact.artifactHash,
    fetchImpl: liveFetch(),
    maxMarkerBytes: 8,
  });
  assert.equal(oversized.outcome, 'inconclusive');
  assert.equal(oversized.reason_code, 'response_too_large');
  assert.equal(githubPublicationStatusForVerification(oversized.outcome), 'verification_inconclusive');

  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const jwt = createGitHubAppJwt({ appId: 123, privateKey: pem, now: new Date('2026-07-18T12:00:00Z') });
  const [, encodedPayload] = jwt.split('.');
  assert.equal(JSON.parse(Buffer.from(encodedPayload, 'base64url')).iss, '123');
  const client = new GitHubAppClient({
    appId: 123,
    installationId: 456,
    privateKey: pem,
    owner: 'example',
    repo: 'repo',
    fetchImpl: async () => new Response(JSON.stringify({ message: 'unused' }), { status: 500 }),
  });
  assert.equal(client.mergePullRequest, undefined, 'Publisher client must not expose an automatic merge operation.');

  const releasedKeys = [];
  let pooledConnectionReleased = false;
  let pooledConnectionDestroyed = false;
  const lockConnection = {
    async execute(sql, values) {
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
      releasedKeys.push(values[0]);
      return [[{ released: values[0].endsWith(':2') ? 0 : 1 }]];
    },
    release() {
      pooledConnectionReleased = true;
    },
    destroy() {
      pooledConnectionDestroyed = true;
    },
  };
  const lockHandle = await acquireReleasePublicationLocks({
    async getConnection() {
      return lockConnection;
    },
  }, [1, 2, 3]);
  await lockHandle.release();
  assert.deepEqual(releasedKeys, [
    'jntustack:github-publication:3',
    'jntustack:github-publication:2',
    'jntustack:github-publication:1',
  ]);
  assert.equal(pooledConnectionReleased, false, 'A session with uncertain named-lock cleanup must not return to the pool.');
  assert.equal(pooledConnectionDestroyed, true, 'A session with uncertain named-lock cleanup must be destroyed.');

  const uncertainReleasedKeys = [];
  let uncertainGetLockCalls = 0;
  let uncertainConnectionReleased = false;
  let uncertainConnectionDestroyed = false;
  const uncertainLockConnection = {
    async execute(sql, values) {
      if (sql.includes('GET_LOCK')) {
        uncertainGetLockCalls += 1;
        if (uncertainGetLockCalls === 2) throw new Error('lost GET_LOCK response');
        return [[{ acquired: 1 }]];
      }
      uncertainReleasedKeys.push(values[0]);
      return [[{ released: 1 }]];
    },
    release() {
      uncertainConnectionReleased = true;
    },
    destroy() {
      uncertainConnectionDestroyed = true;
    },
  };
  await assert.rejects(
    acquireReleasePublicationLocks({
      async getConnection() {
        return uncertainLockConnection;
      },
    }, [10, 11]),
    /lost GET_LOCK response/
  );
  assert.deepEqual(uncertainReleasedKeys, ['jntustack:github-publication:10']);
  assert.equal(uncertainConnectionReleased, false, 'An uncertain GET_LOCK session must not return to the pool.');
  assert.equal(uncertainConnectionDestroyed, true, 'An uncertain GET_LOCK session must be destroyed.');

  console.log('Publishing foundation checks passed.');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
