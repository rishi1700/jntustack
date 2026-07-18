import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asBuffer(body) {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === 'string') return Buffer.from(body);
  throw new TypeError('Asset body must be a Buffer, Uint8Array, or string.');
}

function assertPositiveMaxBytes(value) {
  const parsed = Number(value ?? DEFAULT_MAX_BYTES);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('maxBytes must be a positive safe integer.');
  }
  return parsed;
}

function normalizeSha256(value, label = 'sha256') {
  const normalized = clean(value).toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a 64-character hexadecimal SHA-256 digest.`);
  }
  return normalized;
}

function verifyBuffer(buffer, { expectedSha256, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const limit = assertPositiveMaxBytes(maxBytes);
  if (buffer.length > limit) {
    throw new AssetIntegrityError(`Asset is ${buffer.length} bytes; maximum allowed is ${limit}.`, 'asset_too_large');
  }
  const actualSha256 = sha256(buffer);
  if (expectedSha256 && actualSha256 !== normalizeSha256(expectedSha256, 'expectedSha256')) {
    throw new AssetIntegrityError(
      `Asset checksum mismatch: expected ${expectedSha256}, received ${actualSha256}.`,
      'checksum_mismatch'
    );
  }
  return { sha256: actualSha256, size: buffer.length };
}

function assertProvider(requested, actual) {
  const normalized = clean(requested).toLowerCase();
  if (normalized && normalized !== actual) {
    throw new Error(`Storage provider mismatch: requested ${normalized}, adapter is ${actual}.`);
  }
}

function assertStorageKey(key) {
  const normalized = clean(key).replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('../') || normalized.includes('/..')) {
    throw new Error('Asset storage key must be a safe relative path.');
  }
  return normalized;
}

function immutableKey(checksum) {
  return `source-assets/sha256/${checksum.slice(0, 2)}/${checksum}`;
}

function recoveryKey(checksum) {
  return `source-assets/recovery/sha256/${checksum.slice(0, 2)}/${checksum}/${crypto.randomUUID()}`;
}

function encodePath(value) {
  return value.split('/').map(part => encodeURIComponent(part)).join('/');
}

function hmac(key, value, encoding = undefined) {
  return crypto.createHmac('sha256', key).update(value).digest(encoding);
}

function awsTimestamp(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

async function readResponseWithLimit(response, maxBytes) {
  const limit = assertPositiveMaxBytes(maxBytes);
  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > limit) {
      throw new AssetIntegrityError(`Asset is ${buffer.length} bytes; maximum allowed is ${limit}.`, 'asset_too_large');
    }
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel('asset_too_large');
      throw new AssetIntegrityError(`Asset exceeds the ${limit}-byte maximum.`, 'asset_too_large');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

export class AssetIntegrityError extends Error {
  constructor(message, code = 'asset_integrity_error') {
    super(message);
    this.name = 'AssetIntegrityError';
    this.code = code;
  }
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export class LocalAssetStorage {
  constructor({ root = process.cwd(), maxBytes = DEFAULT_MAX_BYTES } = {}) {
    this.provider = 'local';
    this.root = path.resolve(root, 'storage');
    this.maxBytes = assertPositiveMaxBytes(maxBytes);
  }

  absolutePathForKey(key) {
    const normalized = assertStorageKey(key);
    const absolute = path.resolve(this.root, normalized);
    if (!absolute.startsWith(`${this.root}${path.sep}`)) {
      throw new Error('Asset storage key escapes the configured local storage root.');
    }
    return absolute;
  }

  async putImmutable({ body, contentType = 'application/octet-stream', sha256: expectedSha256 }) {
    const buffer = asBuffer(body);
    const expected = normalizeSha256(expectedSha256, 'sha256');
    const verified = verifyBuffer(buffer, { expectedSha256: expected, maxBytes: this.maxBytes });
    const key = immutableKey(expected);
    const absolute = this.absolutePathForKey(key);
    await fs.mkdir(path.dirname(absolute), { recursive: true });

    let reused = false;
    try {
      await fs.writeFile(absolute, buffer, { flag: 'wx', mode: 0o600 });
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
      const existing = await fs.readFile(absolute);
      verifyBuffer(existing, { expectedSha256: expected, maxBytes: this.maxBytes });
      reused = true;
    }

    return {
      provider: this.provider,
      key,
      etag: expected,
      sha256: verified.sha256,
      size: verified.size,
      contentType: clean(contentType) || 'application/octet-stream',
      reused,
      verifiedAt: new Date().toISOString(),
    };
  }

  async putRecoveryImmutable({ body, contentType = 'application/octet-stream', sha256: expectedSha256 }) {
    const buffer = asBuffer(body);
    const expected = normalizeSha256(expectedSha256, 'sha256');
    const verified = verifyBuffer(buffer, { expectedSha256: expected, maxBytes: this.maxBytes });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const key = recoveryKey(expected);
      const absolute = this.absolutePathForKey(key);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      try {
        await fs.writeFile(absolute, buffer, { flag: 'wx', mode: 0o600 });
        const stored = await fs.readFile(absolute);
        verifyBuffer(stored, { expectedSha256: expected, maxBytes: this.maxBytes });
        return {
          provider: this.provider,
          key,
          etag: expected,
          sha256: verified.sha256,
          size: verified.size,
          contentType: clean(contentType) || 'application/octet-stream',
          reused: false,
          recovery: true,
          verifiedAt: new Date().toISOString(),
        };
      } catch (err) {
        if (err?.code === 'EEXIST') continue;
        throw err;
      }
    }
    throw new Error('Could not allocate a unique immutable recovery key after 3 attempts.');
  }

  async getBuffer({ provider, key, expectedSha256, maxBytes = this.maxBytes }) {
    assertProvider(provider, this.provider);
    const expected = normalizeSha256(expectedSha256, 'expectedSha256');
    const absolute = this.absolutePathForKey(key);
    const stat = await fs.stat(absolute);
    const limit = assertPositiveMaxBytes(maxBytes);
    if (stat.size > limit) {
      throw new AssetIntegrityError(`Asset is ${stat.size} bytes; maximum allowed is ${limit}.`, 'asset_too_large');
    }
    const buffer = await fs.readFile(absolute);
    verifyBuffer(buffer, { expectedSha256: expected, maxBytes: limit });
    return buffer;
  }

  async exists({ provider, key, expectedSha256 }) {
    try {
      await this.getBuffer({ provider, key, expectedSha256, maxBytes: this.maxBytes });
      return true;
    } catch (err) {
      if (err?.code === 'ENOENT') return false;
      throw err;
    }
  }
}

export class R2AssetStorage {
  constructor({
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint = '',
    fetchImpl = globalThis.fetch,
    now = () => new Date(),
    maxBytes = DEFAULT_MAX_BYTES,
    requestTimeoutMs = 15_000,
  } = {}) {
    const missing = Object.entries({ accountId, accessKeyId, secretAccessKey, bucket })
      .filter(([, value]) => !clean(value))
      .map(([key]) => key);
    if (missing.length) throw new Error(`R2 configuration is incomplete. Missing: ${missing.join(', ')}.`);
    if (typeof fetchImpl !== 'function') throw new Error('R2 storage requires a fetch implementation.');

    this.provider = 'r2';
    this.accessKeyId = clean(accessKeyId);
    this.secretAccessKey = clean(secretAccessKey);
    this.bucket = clean(bucket);
    this.endpoint = (clean(endpoint) || `https://${clean(accountId)}.r2.cloudflarestorage.com`).replace(/\/+$/, '');
    const endpointUrl = new URL(this.endpoint);
    if (endpointUrl.protocol !== 'https:') throw new Error('R2 endpoint must use HTTPS.');
    this.fetch = fetchImpl;
    this.now = now;
    this.maxBytes = assertPositiveMaxBytes(maxBytes);
    this.requestTimeoutMs = assertPositiveMaxBytes(requestTimeoutMs);
    if (this.requestTimeoutMs > 60_000) throw new Error('requestTimeoutMs must not exceed 60000.');
  }

  objectUrl(key) {
    return new URL(`${this.endpoint}/${encodeURIComponent(this.bucket)}/${encodePath(assertStorageKey(key))}`);
  }

  signedHeaders({ method, url, bodySha256, contentType = '', extraHeaders = {} }) {
    const timestamp = awsTimestamp(this.now());
    const date = timestamp.slice(0, 8);
    const headers = {
      host: url.host,
      'x-amz-content-sha256': bodySha256,
      'x-amz-date': timestamp,
      ...Object.fromEntries(Object.entries(extraHeaders).map(([key, value]) => [key.toLowerCase(), String(value).trim()])),
    };
    if (contentType) headers['content-type'] = contentType;

    const headerNames = Object.keys(headers).sort();
    const canonicalHeaders = `${headerNames.map(name => `${name}:${headers[name].replace(/\s+/g, ' ')}`).join('\n')}\n`;
    const signedHeaderNames = headerNames.join(';');
    const canonicalRequest = [
      method,
      url.pathname,
      url.searchParams.toString(),
      canonicalHeaders,
      signedHeaderNames,
      bodySha256,
    ].join('\n');
    const scope = `${date}/auto/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      timestamp,
      scope,
      sha256(canonicalRequest),
    ].join('\n');
    const dateKey = hmac(`AWS4${this.secretAccessKey}`, date);
    const regionKey = hmac(dateKey, 'auto');
    const serviceKey = hmac(regionKey, 's3');
    const signingKey = hmac(serviceKey, 'aws4_request');
    const signature = hmac(signingKey, stringToSign, 'hex');

    return {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${signedHeaderNames}, Signature=${signature}`,
    };
  }

  async request({ method, key, body = undefined, contentType = '', extraHeaders = {}, responseMaxBytes = null }) {
    const url = this.objectUrl(key);
    const bodySha256 = sha256(body || '');
    const headers = this.signedHeaders({ method, url, bodySha256, contentType, extraHeaders });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetch(url, { method, headers, body, signal: controller.signal });
      let responseBody = null;
      if (responseMaxBytes != null) {
        responseBody = await readResponseWithLimit(response, responseMaxBytes);
      } else if (!response.ok) {
        responseBody = await readResponseWithLimit(response, 16 * 1024);
      } else if (response.body?.cancel) {
        await response.body.cancel().catch(() => {});
      }
      return { response, responseBody };
    } catch (err) {
      if (err?.name === 'AbortError') {
        const timeoutError = new Error(`R2 request timed out after ${this.requestTimeoutMs}ms.`);
        timeoutError.code = 'ETIMEDOUT';
        throw timeoutError;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async putAtImmutableKey({ buffer, contentType, expected, key, allowExisting }) {
    const verified = verifyBuffer(buffer, { expectedSha256: expected, maxBytes: this.maxBytes });
    let response;
    let responseBody;
    try {
      ({ response, responseBody } = await this.request({
        method: 'PUT',
        key,
        body: buffer,
        contentType,
        extraHeaders: {
          'if-none-match': '*',
          'x-amz-meta-sha256': expected,
        },
      }));
    } catch (err) {
      if (err instanceof AssetIntegrityError) throw err;
      throw new Error(`R2 immutable upload failed before a response was received: ${err.message || String(err)}`);
    }

    if (response.status === 412) {
      if (!allowExisting) {
        const collision = new Error(`R2 immutable recovery key collision: ${key}`);
        collision.code = 'EEXIST';
        throw collision;
      }
      await this.getBuffer({ provider: this.provider, key, expectedSha256: expected, maxBytes: this.maxBytes });
      return {
        provider: this.provider,
        key,
        etag: clean(response.headers.get('etag')).replaceAll('"', '') || null,
        sha256: expected,
        size: verified.size,
        contentType,
        reused: true,
        verifiedAt: new Date().toISOString(),
      };
    }
    if (!response.ok) {
      const detail = clean(responseBody?.toString('utf8') || response.statusText).slice(0, 500);
      throw new Error(`R2 immutable upload failed (${response.status}): ${detail || response.statusText}`);
    }

    // Treat a successful write response as provisional until the stored bytes
    // can be read back through the same private bucket and re-hashed.
    await this.getBuffer({
      provider: this.provider,
      key,
      expectedSha256: expected,
      maxBytes: this.maxBytes,
    });

    return {
      provider: this.provider,
      key,
      etag: clean(response.headers.get('etag')).replaceAll('"', '') || null,
      sha256: expected,
      size: verified.size,
      contentType,
      reused: false,
      verifiedAt: new Date().toISOString(),
    };
  }

  async putImmutable({ body, contentType = 'application/octet-stream', sha256: expectedSha256 }) {
    const buffer = asBuffer(body);
    const expected = normalizeSha256(expectedSha256, 'sha256');
    const key = immutableKey(expected);
    return this.putAtImmutableKey({
      buffer,
      contentType: clean(contentType) || 'application/octet-stream',
      expected,
      key,
      allowExisting: true,
    });
  }

  async putRecoveryImmutable({ body, contentType = 'application/octet-stream', sha256: expectedSha256 }) {
    const buffer = asBuffer(body);
    const expected = normalizeSha256(expectedSha256, 'sha256');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return {
          ...await this.putAtImmutableKey({
            buffer,
            contentType: clean(contentType) || 'application/octet-stream',
            expected,
            key: recoveryKey(expected),
            allowExisting: false,
          }),
          recovery: true,
        };
      } catch (err) {
        if (err?.code === 'EEXIST') continue;
        throw err;
      }
    }
    throw new Error('Could not allocate a unique R2 immutable recovery key after 3 attempts.');
  }

  async getBuffer({ provider, key, expectedSha256, maxBytes = this.maxBytes }) {
    assertProvider(provider, this.provider);
    const expected = normalizeSha256(expectedSha256, 'expectedSha256');
    let response;
    try {
      const result = await this.request({ method: 'GET', key, responseMaxBytes: maxBytes });
      response = result.response;
      var responseBuffer = result.responseBody;
    } catch (err) {
      if (err instanceof AssetIntegrityError) throw err;
      throw new Error(`R2 asset read failed before a response was received: ${err.message || String(err)}`);
    }
    if (response.status === 404) {
      const error = new Error(`R2 asset not found: ${key}`);
      error.code = 'ENOENT';
      throw error;
    }
    if (!response.ok) throw new Error(`R2 asset read failed (${response.status} ${response.statusText}).`);

    const limit = assertPositiveMaxBytes(maxBytes);
    const declaredSize = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredSize) && declaredSize > limit) {
      throw new AssetIntegrityError(`Asset is ${declaredSize} bytes; maximum allowed is ${limit}.`, 'asset_too_large');
    }
    const buffer = responseBuffer;
    verifyBuffer(buffer, { expectedSha256: expected, maxBytes: limit });
    return buffer;
  }

  async exists({ provider, key, expectedSha256 }) {
    try {
      await this.getBuffer({ provider, key, expectedSha256, maxBytes: this.maxBytes });
      return true;
    } catch (err) {
      if (err?.code === 'ENOENT') return false;
      throw err;
    }
  }
}

export function createAssetStorage({ env = process.env, root = process.cwd(), fetchImpl = globalThis.fetch } = {}) {
  const provider = clean(env.ASSET_STORAGE_PROVIDER).toLowerCase() || 'local';
  const maxBytes = env.ASSET_MAX_BYTES ? Number(env.ASSET_MAX_BYTES) : DEFAULT_MAX_BYTES;
  if (provider === 'local') return new LocalAssetStorage({ root, maxBytes });
  if (provider !== 'r2') throw new Error(`Unsupported ASSET_STORAGE_PROVIDER "${provider}". Expected local or r2.`);

  return new R2AssetStorage({
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET || env.R2_BUCKET_NAME,
    endpoint: env.R2_ENDPOINT,
    fetchImpl,
    maxBytes,
  });
}

export function createAssetStorageForProvider(provider, options = {}) {
  const env = options.env || process.env;
  return createAssetStorage({
    ...options,
    env: { ...env, ASSET_STORAGE_PROVIDER: provider },
  });
}

export const ASSET_STORAGE_DEFAULT_MAX_BYTES = DEFAULT_MAX_BYTES;
