import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkStorage } from '../lib/admin-checks.js';

const HEALTH_PREFIX = 'health/admin-system-checks/';
const deterministicRandomBytes = size => Buffer.alloc(size, 0x5a);

function fakeResponse(status) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'error',
  };
}

class FakeR2HealthStorage {
  constructor({ corruptRead = false, failDelete = false } = {}) {
    this.provider = 'r2';
    this.corruptRead = corruptRead;
    this.failDelete = failDelete;
    this.calls = [];
    this.objects = new Map();
  }

  async request({ method, key, body, responseMaxBytes }) {
    this.calls.push({
      method,
      key,
      bodyBytes: body?.length ?? 0,
      responseMaxBytes: responseMaxBytes ?? null,
    });
    assert.match(key, /^health\/admin-system-checks\/[0-9a-f-]+\.bin$/);

    if (method === 'PUT') {
      if (this.objects.has(key)) return { response: fakeResponse(412), responseBody: Buffer.alloc(0) };
      this.objects.set(key, Buffer.from(body));
      return { response: fakeResponse(200), responseBody: null };
    }
    if (method === 'GET') {
      const stored = this.objects.get(key);
      if (!stored) return { response: fakeResponse(404), responseBody: Buffer.alloc(0) };
      const responseBody = this.corruptRead
        ? Buffer.concat([stored.subarray(0, stored.length - 1), Buffer.from([stored.at(-1) ^ 0xff])])
        : Buffer.from(stored);
      return { response: fakeResponse(200), responseBody };
    }
    if (method === 'DELETE') {
      if (this.failDelete) return { response: fakeResponse(500), responseBody: Buffer.alloc(0) };
      this.objects.delete(key);
      return { response: fakeResponse(204), responseBody: null };
    }
    throw new Error(`Unexpected fake R2 method: ${method}`);
  }
}

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'jntustack-admin-checks-'));
try {
  const evidenceFile = path.join(
    tempRoot,
    'storage',
    'source-assets',
    'sha256',
    'aa',
    'production-evidence'
  );
  await fs.mkdir(path.dirname(evidenceFile), { recursive: true });
  await fs.writeFile(evidenceFile, 'do-not-touch');

  const local = await checkStorage(tempRoot, {
    env: { ASSET_STORAGE_PROVIDER: 'local' },
    randomBytes: deterministicRandomBytes,
  });
  assert.deepEqual(local, {
    provider: 'local',
    configured: true,
    ok: true,
    publicationReady: false,
    persistenceStatus: 'not_configured',
    persistenceVerified: false,
    message: 'write/read/checksum/delete probe passed; configure a persistent production root before publication',
  });
  assert.equal(await fs.readFile(evidenceFile, 'utf8'), 'do-not-touch');
  assert.deepEqual(
    await fs.readdir(path.join(tempRoot, 'storage', 'health', 'admin-system-checks')),
    []
  );
  assert.equal(JSON.stringify(local).includes(tempRoot), false);

  const unsafeRoot = path.join(tempRoot, 'public_html', 'private-assets');
  const unsafeLocal = await checkStorage(tempRoot, {
    env: {
      ASSET_STORAGE_PROVIDER: 'local',
      ASSET_STORAGE_ROOT: unsafeRoot,
      ASSET_STORAGE_EXPECTED_ID: 'jntustack-test-assets-2026-07',
      ASSET_STORAGE_PERSISTENCE_VERIFIED: 'false',
    },
    randomBytes: deterministicRandomBytes,
  });
  assert.deepEqual(unsafeLocal, {
    provider: 'local',
    configured: false,
    ok: false,
    publicationReady: false,
    persistenceStatus: 'unsafe_storage_root',
    persistenceVerified: false,
    code: 'ASSET_STORAGE_UNSAFE_ROOT',
    message: 'The configured persistent asset root is inside an unsafe deployment or public path.',
  });
  await assert.rejects(
    fs.access(unsafeRoot),
    error => error?.code === 'ENOENT'
  );

  await fs.rm(path.join(tempRoot, 'storage', 'health'), { recursive: true, force: true });
  const escapedHealthRoot = path.join(tempRoot, 'escaped-health');
  await fs.mkdir(escapedHealthRoot);
  await fs.symlink(escapedHealthRoot, path.join(tempRoot, 'storage', 'health'));
  const symlinkedLocal = await checkStorage(tempRoot, {
    env: { ASSET_STORAGE_PROVIDER: 'local' },
    randomBytes: deterministicRandomBytes,
  });
  assert.equal(symlinkedLocal.ok, false);
  assert.equal(symlinkedLocal.stage, 'setup');
  assert.deepEqual(await fs.readdir(escapedHealthRoot), []);
  await fs.unlink(path.join(tempRoot, 'storage', 'health'));

  const r2Env = {
    ASSET_STORAGE_PROVIDER: 'r2',
    R2_ACCOUNT_ID: 'account-id',
    R2_ACCESS_KEY_ID: 'access-key-id',
    R2_SECRET_ACCESS_KEY: 'super-secret-value',
    R2_BUCKET: 'private-production-evidence',
  };
  const fakeR2 = new FakeR2HealthStorage();
  const evidenceKey = 'source-assets/sha256/aa/production-evidence';
  fakeR2.objects.set(evidenceKey, Buffer.from('do-not-touch'));
  const r2 = await checkStorage(tempRoot, {
    env: r2Env,
    storageFactory: () => fakeR2,
    randomBytes: deterministicRandomBytes,
  });
  assert.equal(r2.ok, true);
  assert.equal(r2.configured, true);
  assert.equal(r2.provider, 'r2');
  assert.equal(r2.publicationReady, true);
  assert.equal(r2.persistenceStatus, 'configured');
  assert.equal(r2.persistenceVerified, true);
  assert.deepEqual(fakeR2.calls.map(call => call.method), ['PUT', 'GET', 'DELETE']);
  assert.equal(fakeR2.calls[0].bodyBytes, 64);
  assert.equal(fakeR2.calls[1].responseMaxBytes, 1024);
  assert.ok(fakeR2.calls.every(call => call.key.startsWith(HEALTH_PREFIX)));
  assert.equal(fakeR2.objects.size, 1);
  assert.equal(fakeR2.objects.get(evidenceKey).toString(), 'do-not-touch');
  const serializedR2 = JSON.stringify(r2);
  assert.doesNotMatch(serializedR2, /super-secret-value|private-production-evidence|account-id/);
  assert.doesNotMatch(serializedR2, /health\/admin-system-checks/);

  const corruptR2 = new FakeR2HealthStorage({ corruptRead: true });
  corruptR2.objects.set(evidenceKey, Buffer.from('do-not-touch'));
  const corrupt = await checkStorage(tempRoot, {
    env: r2Env,
    storageFactory: () => corruptR2,
    randomBytes: deterministicRandomBytes,
  });
  assert.equal(corrupt.ok, false);
  assert.equal(corrupt.configured, true);
  assert.equal(corrupt.code, 'ASSET_PERSISTENCE_PROBE_FAILED');
  assert.equal(corrupt.stage, 'checksum');
  assert.deepEqual(corruptR2.calls.map(call => call.method), ['PUT', 'GET', 'DELETE']);
  assert.equal(corruptR2.objects.size, 1);
  assert.equal(corruptR2.objects.get(evidenceKey).toString(), 'do-not-touch');
  assert.doesNotMatch(JSON.stringify(corrupt), /source-assets|production-evidence|super-secret-value/);

  const deleteFailureR2 = new FakeR2HealthStorage({ failDelete: true });
  const deleteFailure = await checkStorage(tempRoot, {
    env: r2Env,
    storageFactory: () => deleteFailureR2,
    randomBytes: deterministicRandomBytes,
  });
  assert.equal(deleteFailure.ok, false);
  assert.equal(deleteFailure.stage, 'cleanup');
  assert.deepEqual(
    deleteFailureR2.calls.map(call => call.method),
    ['PUT', 'GET', 'DELETE', 'DELETE']
  );
  assert.ok([...deleteFailureR2.objects.keys()].every(key => key.startsWith(HEALTH_PREFIX)));

  let incompleteFactoryCalled = false;
  const incompleteR2 = await checkStorage(tempRoot, {
    env: { ASSET_STORAGE_PROVIDER: 'r2' },
    storageFactory: () => {
      incompleteFactoryCalled = true;
      throw new Error('must not run');
    },
  });
  assert.equal(incompleteR2.ok, false);
  assert.equal(incompleteR2.configured, false);
  assert.equal(incompleteFactoryCalled, false);

  const unsupported = await checkStorage(tempRoot, {
    env: { ASSET_STORAGE_PROVIDER: '/private/secret/provider' },
  });
  assert.deepEqual(unsupported, {
    provider: 'unsupported',
    configured: false,
    ok: false,
    message: 'An unsupported storage provider is configured.',
  });
  assert.doesNotMatch(JSON.stringify(unsupported), /private|secret/);
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('Admin storage persistence health checks passed.');
