import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  AssetIntegrityError,
  LocalAssetStorage,
  R2AssetStorage,
  sha256,
} from '../lib/asset-storage.js';
import {
  isBlockedSourceAddress,
  normalizeSourceFetchUrl,
  requestPinnedSource,
  resolvePublicSourceAddress,
} from '../lib/source-fetcher.js';

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
