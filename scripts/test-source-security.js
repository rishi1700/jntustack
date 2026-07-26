import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
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
  isBlockedSourceAddress,
  normalizeSourceFetchUrl,
  requestPinnedSource,
  resolvePublicSourceAddress,
} from '../lib/source-fetcher.js';
import {
  assertAssetStorageIntakeReady,
  registerAsset,
  repairAssetRecordWithBuffer,
} from '../lib/assets.js';

class PartialWriteLocalAssetStorage extends LocalAssetStorage {
  async writeAndSyncTempFile(absolute, buffer) {
    const partialLength = Math.max(1, Math.floor(buffer.length / 2));
    await fs.writeFile(absolute, buffer.subarray(0, partialLength), {
      flag: 'wx',
      mode: 0o600,
    });
    const error = new Error('simulated local asset write failure');
    error.code = 'ENOSPC';
    throw error;
  }
}

await assert.rejects(
  assertAssetStorageIntakeReady({
    env: {},
    persistenceCheck: async () => ({ provider: 'local', ready: false }),
  }),
  error => (
    error instanceof AssetIntegrityError &&
    error.code === 'asset_storage_persistence_not_verified'
  )
);

for (const environment of ['production', 'test', 'development']) {
  await assert.rejects(
    assertAssetStorageIntakeReady({
      env: {
        NODE_ENV: environment,
        ASSET_STORAGE_PROVIDER: 'local',
        ASSET_STORAGE_ALLOW_UNVERIFIED_LOCAL: 'true',
      },
      persistenceCheck: async () => ({ provider: 'local', ready: false }),
    }),
    error => (
      error instanceof AssetIntegrityError &&
      error.code === 'asset_storage_persistence_not_verified'
    )
  );
}

const readyPersistence = {
  provider: 'local',
  ready: true,
  status: 'verified',
};
let readyCheckArguments = null;
assert.strictEqual(
  await assertAssetStorageIntakeReady({
    root: '/persistent/assets',
    env: { NODE_ENV: 'production', ASSET_STORAGE_PROVIDER: 'local' },
    persistenceCheck: async options => {
      readyCheckArguments = options;
      return readyPersistence;
    },
  }),
  readyPersistence
);
assert.deepEqual(readyCheckArguments, {
  root: '/persistent/assets',
  env: { NODE_ENV: 'production', ASSET_STORAGE_PROVIDER: 'local' },
  seedIfMissing: false,
});

let blockedStorageInteractions = 0;
let blockedDatabaseInteractions = 0;
const blockedStorage = new Proxy({}, {
  get() {
    blockedStorageInteractions += 1;
    return async () => {
      throw new Error('Blocked storage must not be called.');
    };
  },
});
const blockedDatabase = new Proxy({}, {
  get() {
    blockedDatabaseInteractions += 1;
    return async () => {
      throw new Error('Blocked database must not be called.');
    };
  },
});
const blockedPersistenceCheck = async () => ({ provider: 'local', ready: false });
const blockedAssetArguments = {
  root: '/tmp/blocked-assets',
  originalFilename: 'blocked.html',
  contentType: 'text/html',
  buffer: Buffer.from('<!doctype html><title>Blocked evidence</title>'),
  storage: blockedStorage,
  database: blockedDatabase,
  storagePersistenceCheck: blockedPersistenceCheck,
};
await assert.rejects(
  registerAsset({
    ...blockedAssetArguments,
    discoverySourceId: 1,
  }),
  error => error?.code === 'asset_storage_persistence_not_verified'
);
await assert.rejects(
  repairAssetRecordWithBuffer({
    ...blockedAssetArguments,
    assetId: 1,
  }),
  error => error?.code === 'asset_storage_persistence_not_verified'
);
assert.equal(blockedStorageInteractions, 0);
assert.equal(blockedDatabaseInteractions, 0);

const blocked = [
  '0.0.0.0',
  '10.0.0.1',
  '100.64.0.1',
  '127.0.0.1',
  '169.254.169.254',
  '172.31.255.255',
  '192.0.2.1',
  '192.168.1.1',
  '198.18.0.1',
  '198.51.100.1',
  '203.0.113.1',
  '224.0.0.1',
  '::',
  '::1',
  '::ffff:127.0.0.1',
  'fc00::1',
  'fe80::1',
  '2001:db8::1',
  '2001:20::1',
  '2002:7f00:1::',
];
for (const address of blocked) {
  assert.equal(isBlockedSourceAddress(address), true, `${address} must be blocked`);
}
for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
  assert.equal(isBlockedSourceAddress(address), false, `${address} should be considered globally routable`);
}

assert.equal(normalizeSourceFetchUrl('https://example.edu/syllabus.pdf#section').href, 'https://example.edu/syllabus.pdf');
assert.equal(normalizeSourceFetchUrl('https://example.edu/syllabus.pdf?course_key=cs101').search, '?course_key=cs101');
assert.throws(() => normalizeSourceFetchUrl('https://user:pass@example.edu/file.pdf'), /embedded credentials/);
assert.throws(() => normalizeSourceFetchUrl('https://example.edu/file.pdf?token=secret'), /sensitive query parameter/);
assert.throws(() => normalizeSourceFetchUrl('https://example.edu/file.pdf?X-Amz-Signature=secret'), /sensitive query parameter/);

const pinned = await resolvePublicSourceAddress(new URL('https://example.edu/file.pdf'), {
  lookup: async () => [
    { address: '2606:4700:4700::1111', family: 6 },
    { address: '8.8.8.8', family: 4 },
  ],
});
assert.deepEqual(pinned, { address: '8.8.8.8', family: 4 });
await assert.rejects(
  resolvePublicSourceAddress(new URL('https://example.edu/file.pdf'), {
    lookup: async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ],
  }),
  /private, local, or reserved/
);

const server = http.createServer((request, response) => {
  if (request.url === '/slow') {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.write('partial');
    return;
  }
  if (request.url === '/large') {
    response.writeHead(200, { 'content-type': 'text/html', 'content-length': '20' });
    response.end('x'.repeat(20));
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end(request.headers.host || 'missing-host');
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
try {
  const { port } = server.address();
  const pinnedLoopback = { address: '127.0.0.1', family: 4 };
  const pinnedResponse = await requestPinnedSource(
    new URL(`http://official.example:${port}/ok`),
    pinnedLoopback,
    { requestTimeoutMs: 500, maxBytes: 1024 }
  );
  assert.equal(pinnedResponse.buffer.toString(), `official.example:${port}`);
  await assert.rejects(
    requestPinnedSource(new URL(`http://official.example:${port}/large`), pinnedLoopback, {
      requestTimeoutMs: 500,
      maxBytes: 4,
    }),
    /too large/
  );
  await assert.rejects(
    requestPinnedSource(new URL(`http://official.example:${port}/slow`), pinnedLoopback, {
      requestTimeoutMs: 30,
      maxBytes: 1024,
    }),
    error => error?.code === 'ETIMEDOUT'
  );
} finally {
  await new Promise(resolve => server.close(resolve));
}

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'jntustack-source-security-'));
try {
  const defaultStorage = createAssetStorage({
    env: { ASSET_STORAGE_PROVIDER: 'local' },
    root: tempRoot,
  });
  assert.equal(defaultStorage.root, path.resolve(tempRoot, 'storage'));
  assert.throws(
    () => createAssetStorage({
      env: {
        ASSET_STORAGE_PROVIDER: 'local',
        ASSET_STORAGE_ROOT: 'relative/persistent-assets',
      },
      root: tempRoot,
    }),
    /ASSET_STORAGE_ROOT must be an absolute path/
  );

  const persistentRootInput = path.join(
    tempRoot,
    'persistent',
    'releases',
    '..',
    'asset-store'
  );
  const persistentStorage = createAssetStorage({
    env: {
      ASSET_STORAGE_PROVIDER: 'local',
      ASSET_STORAGE_ROOT: persistentRootInput,
    },
    root: path.join(tempRoot, 'ephemeral-release'),
  });
  assert.equal(persistentStorage.root, path.resolve(persistentRootInput));
  const persistentBody = Buffer.from('persistent Hostinger asset bytes');
  const persistentChecksum = sha256(persistentBody);
  const persistentWrite = await persistentStorage.putImmutable({
    body: persistentBody,
    sha256: persistentChecksum,
  });
  assert.deepEqual(
    await fs.readFile(path.join(persistentStorage.root, persistentWrite.key)),
    persistentBody
  );
  await assert.rejects(
    fs.access(path.join(tempRoot, 'ephemeral-release', 'storage', persistentWrite.key)),
    error => error?.code === 'ENOENT'
  );
  const persistentAbsolute = path.join(persistentStorage.root, persistentWrite.key);
  await fs.chmod(persistentAbsolute, 0o644);
  await assert.rejects(
    persistentStorage.getBuffer({
      provider: 'local',
      key: persistentWrite.key,
      expectedSha256: persistentChecksum,
    }),
    error => error?.code === 'UNSAFE_ASSET_STORAGE_PERMISSIONS'
  );
  await fs.chmod(persistentAbsolute, 0o600);

  const unsafeModeRoot = path.join(tempRoot, 'unsafe-mode-storage');
  await fs.mkdir(unsafeModeRoot, { mode: 0o700 });
  await fs.chmod(unsafeModeRoot, 0o755);
  const unsafeModeStorage = new LocalAssetStorage({ storageRoot: unsafeModeRoot });
  await assert.rejects(
    unsafeModeStorage.putImmutable({
      body: persistentBody,
      sha256: persistentChecksum,
    }),
    error => error?.code === 'UNSAFE_ASSET_STORAGE_PERMISSIONS'
  );

  const partialWriteRoot = path.join(tempRoot, 'partial-write-storage');
  const partialWriteStorage = new PartialWriteLocalAssetStorage({
    storageRoot: partialWriteRoot,
    maxBytes: 1024,
  });
  const faultBody = Buffer.from('a partial write must never become canonical');
  const faultChecksum = sha256(faultBody);
  const faultKey = `source-assets/sha256/${faultChecksum.slice(0, 2)}/${faultChecksum}`;
  const faultCanonical = partialWriteStorage.absolutePathForKey(faultKey);
  await assert.rejects(
    partialWriteStorage.putImmutable({ body: faultBody, sha256: faultChecksum }),
    error => error?.code === 'ENOSPC'
  );
  await assert.rejects(
    fs.access(faultCanonical),
    error => error?.code === 'ENOENT'
  );
  assert.deepEqual(await fs.readdir(path.dirname(faultCanonical)), []);

  const healthyAfterPartial = new LocalAssetStorage({
    storageRoot: partialWriteRoot,
    maxBytes: 1024,
  });
  const healthyPublication = await healthyAfterPartial.putImmutable({
    body: faultBody,
    sha256: faultChecksum,
  });
  assert.equal(healthyPublication.reused, false);
  assert.deepEqual(
    await healthyAfterPartial.getBuffer({
      provider: 'local',
      key: faultKey,
      expectedSha256: faultChecksum,
    }),
    faultBody
  );
  const reusedAfterHealthyPublication = await healthyAfterPartial.putImmutable({
    body: faultBody,
    sha256: faultChecksum,
  });
  assert.equal(reusedAfterHealthyPublication.reused, true);
  assert.deepEqual(await fs.readdir(path.dirname(faultCanonical)), [faultChecksum]);

  const partialRecoveryRoot = path.join(tempRoot, 'partial-recovery-storage');
  const partialRecoveryStorage = new PartialWriteLocalAssetStorage({
    storageRoot: partialRecoveryRoot,
    maxBytes: 1024,
  });
  await assert.rejects(
    partialRecoveryStorage.putRecoveryImmutable({
      body: faultBody,
      sha256: faultChecksum,
    }),
    error => error?.code === 'ENOSPC'
  );
  const recoveryPublicationDirectory = path.join(
    partialRecoveryRoot,
    'source-assets',
    'recovery',
    'sha256',
    faultChecksum.slice(0, 2),
    faultChecksum
  );
  assert.deepEqual(await fs.readdir(recoveryPublicationDirectory), []);

  const concurrentRoot = path.join(tempRoot, 'concurrent-local-storage');
  const concurrentStorageA = new LocalAssetStorage({
    storageRoot: concurrentRoot,
    maxBytes: 1024,
  });
  const concurrentStorageB = new LocalAssetStorage({
    storageRoot: concurrentRoot,
    maxBytes: 1024,
  });
  const concurrentResults = await Promise.all([
    concurrentStorageA.putImmutable({ body: faultBody, sha256: faultChecksum }),
    concurrentStorageB.putImmutable({ body: faultBody, sha256: faultChecksum }),
  ]);
  assert.deepEqual(
    concurrentResults.map(result => result.reused).sort(),
    [false, true]
  );
  const concurrentCanonical = concurrentStorageA.absolutePathForKey(faultKey);
  assert.deepEqual(await fs.readFile(concurrentCanonical), faultBody);
  assert.deepEqual(await fs.readdir(path.dirname(concurrentCanonical)), [faultChecksum]);

  const storage = new LocalAssetStorage({ root: tempRoot, maxBytes: 1024 });
  const body = Buffer.from('verified recovery bytes');
  const checksum = sha256(body);
  const canonical = await storage.putImmutable({ body, sha256: checksum });
  await fs.writeFile(storage.absolutePathForKey(canonical.key), Buffer.from('corrupt'));
  await assert.rejects(
    storage.putImmutable({ body, sha256: checksum }),
    error => error instanceof AssetIntegrityError && error.code === 'checksum_mismatch'
  );
  const recovered = await storage.putRecoveryImmutable({ body, sha256: checksum });
  assert.match(recovered.key, new RegExp(`^source-assets/recovery/sha256/${checksum.slice(0, 2)}/${checksum}/`));
  assert.deepEqual(await storage.getBuffer({
    provider: 'local',
    key: recovered.key,
    expectedSha256: checksum,
  }), body);
  assert.equal((await fs.readFile(storage.absolutePathForKey(canonical.key))).toString(), 'corrupt');

  const outsideRoot = path.join(tempRoot, 'outside-storage-root');
  const symlinkStorageRoot = path.join(tempRoot, 'symlink-safe-storage');
  await fs.mkdir(outsideRoot, { recursive: true });
  await fs.mkdir(path.join(symlinkStorageRoot, 'source-assets'), { recursive: true });
  await fs.chmod(symlinkStorageRoot, 0o700);
  await fs.chmod(path.join(symlinkStorageRoot, 'source-assets'), 0o700);
  await fs.symlink(outsideRoot, path.join(symlinkStorageRoot, 'source-assets', 'sha256'));
  const symlinkStorage = new LocalAssetStorage({ storageRoot: symlinkStorageRoot });
  const symlinkBody = Buffer.from('must remain inside the configured storage root');
  const symlinkChecksum = sha256(symlinkBody);
  await assert.rejects(
    symlinkStorage.putImmutable({ body: symlinkBody, sha256: symlinkChecksum }),
    error => (
      error?.code === 'UNSAFE_ASSET_STORAGE_SYMLINK' &&
      /must not contain symbolic links/.test(error.message)
    )
  );
  await assert.rejects(
    fs.access(path.join(outsideRoot, symlinkChecksum.slice(0, 2), symlinkChecksum)),
    error => error?.code === 'ENOENT'
  );

  const rootSymlink = path.join(tempRoot, 'storage-root-symlink');
  await fs.symlink(outsideRoot, rootSymlink);
  const rootSymlinkStorage = new LocalAssetStorage({ storageRoot: rootSymlink });
  await assert.rejects(
    rootSymlinkStorage.putImmutable({ body: symlinkBody, sha256: symlinkChecksum }),
    error => error?.code === 'UNSAFE_ASSET_STORAGE_SYMLINK'
  );

  const fileSymlinkStorage = new LocalAssetStorage({
    storageRoot: path.join(tempRoot, 'file-symlink-storage'),
  });
  const fileSymlinkKey =
    `source-assets/sha256/${symlinkChecksum.slice(0, 2)}/${symlinkChecksum}`;
  const fileSymlinkAbsolute = fileSymlinkStorage.absolutePathForKey(fileSymlinkKey);
  const outsideFile = path.join(outsideRoot, 'outside-asset');
  await fs.mkdir(path.dirname(fileSymlinkAbsolute), { recursive: true });
  for (const privateDirectory of [
    fileSymlinkStorage.root,
    path.join(fileSymlinkStorage.root, 'source-assets'),
    path.join(fileSymlinkStorage.root, 'source-assets', 'sha256'),
    path.dirname(fileSymlinkAbsolute),
  ]) {
    await fs.chmod(privateDirectory, 0o700);
  }
  await fs.writeFile(outsideFile, Buffer.from('outside bytes'));
  await fs.symlink(outsideFile, fileSymlinkAbsolute);
  await assert.rejects(
    fileSymlinkStorage.putImmutable({ body: symlinkBody, sha256: symlinkChecksum }),
    error => error?.code === 'UNSAFE_ASSET_STORAGE_SYMLINK'
  );
  await assert.rejects(
    fileSymlinkStorage.getBuffer({
      provider: 'local',
      key: fileSymlinkKey,
      expectedSha256: symlinkChecksum,
    }),
    error => error?.code === 'UNSAFE_ASSET_STORAGE_SYMLINK'
  );
  assert.equal((await fs.readFile(outsideFile)).toString(), 'outside bytes');

  const r2Body = Buffer.from('bounded remote bytes');
  const r2Checksum = sha256(r2Body);
  const objects = new Map();
  const r2 = new R2AssetStorage({
    accountId: 'account',
    accessKeyId: 'access',
    secretAccessKey: 'secret',
    bucket: 'bucket',
    maxBytes: 1024,
    fetchImpl: async (url, options) => {
      const key = decodeURIComponent(new URL(url).pathname.split('/').slice(2).join('/'));
      if (options.method === 'PUT') {
        if (objects.has(key)) return new Response('exists', { status: 412 });
        objects.set(key, Buffer.from(options.body));
        return new Response(null, { status: 200 });
      }
      if (!objects.has(key)) return new Response('missing', { status: 404 });
      return new Response(objects.get(key), { status: 200 });
    },
  });
  const remoteRecovery = await r2.putRecoveryImmutable({ body: r2Body, sha256: r2Checksum });
  assert.equal(remoteRecovery.recovery, true);
  assert.match(remoteRecovery.key, /^source-assets\/recovery\/sha256\//);
  assert.deepEqual(await r2.getBuffer({
    provider: 'r2',
    key: remoteRecovery.key,
    expectedSha256: r2Checksum,
  }), r2Body);

  const timedR2 = new R2AssetStorage({
    accountId: 'account',
    accessKeyId: 'access',
    secretAccessKey: 'secret',
    bucket: 'bucket',
    requestTimeoutMs: 20,
    fetchImpl: async (_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
  });
  await assert.rejects(
    timedR2.getBuffer({
      provider: 'r2',
      key: `source-assets/sha256/${r2Checksum.slice(0, 2)}/${r2Checksum}`,
      expectedSha256: r2Checksum,
    }),
    /R2 request timed out after 20ms/
  );
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('Source URL, SSRF, storage recovery, and bounded-read security checks passed.');
