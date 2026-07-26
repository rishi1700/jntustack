import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
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

function normalizeAbsoluteStorageRoot(value, label = 'ASSET_STORAGE_ROOT') {
  const configured = clean(value);
  if (!configured) return null;
  if (!path.isAbsolute(configured)) {
    throw new Error(`${label} must be an absolute path.`);
  }
  return path.resolve(configured);
}

function isContainedPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function unsafeSymlinkError(target) {
  const error = new Error(`Local asset storage path must not contain symbolic links: ${target}`);
  error.code = 'UNSAFE_ASSET_STORAGE_SYMLINK';
  return error;
}

function assertSafeLocalOwnershipAndMode(stat, target, { requirePrivate = false } = {}) {
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (currentUid != null && Number.isInteger(stat.uid) && stat.uid !== currentUid) {
    const error = new Error(`Local asset storage path must be owned by the application user: ${target}`);
    error.code = 'UNSAFE_ASSET_STORAGE_OWNER';
    throw error;
  }
  const forbiddenMode = requirePrivate ? 0o077 : 0o022;
  if ((stat.mode & forbiddenMode) !== 0) {
    const error = new Error(
      requirePrivate
        ? `Persistent local asset storage paths must be private to the application user: ${target}`
        : `Local asset storage path must not be group- or world-writable: ${target}`
    );
    error.code = 'UNSAFE_ASSET_STORAGE_PERMISSIONS';
    throw error;
  }
}

async function readRegularFileNoFollow(absolute, maxBytes) {
  const limit = assertPositiveMaxBytes(maxBytes);
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0);
  const handle = await fs.open(absolute, flags);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new Error(`Local asset storage path is not a regular file: ${absolute}`);
    }
    if (stat.size > limit) {
      throw new AssetIntegrityError(
        `Asset is ${stat.size} bytes; maximum allowed is ${limit}.`,
        'asset_too_large'
      );
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
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
  constructor({
    root = process.cwd(),
    storageRoot = null,
    maxBytes = DEFAULT_MAX_BYTES,
  } = {}) {
    const configuredStorageRoot = normalizeAbsoluteStorageRoot(
      storageRoot,
      'Local asset storage root'
    );
    this.provider = 'local';
    this.root = configuredStorageRoot || path.resolve(root, 'storage');
    this.requirePrivatePermissions = Boolean(configuredStorageRoot);
    this.maxBytes = assertPositiveMaxBytes(maxBytes);
  }

  absolutePathForKey(key) {
    const normalized = assertStorageKey(key);
    const absolute = path.resolve(this.root, normalized);
    if (!isContainedPath(this.root, absolute)) {
      throw new Error('Asset storage key escapes the configured local storage root.');
    }
    return absolute;
  }

  async safeAbsolutePathForKey(key, { createParent = false, requireFile = false } = {}) {
    const lexicalAbsolute = this.absolutePathForKey(key);
    if (createParent) {
      await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    }

    const rootStat = await fs.lstat(this.root);
    if (rootStat.isSymbolicLink()) throw unsafeSymlinkError(this.root);
    if (!rootStat.isDirectory()) {
      throw new Error(`Local asset storage root is not a directory: ${this.root}`);
    }
    assertSafeLocalOwnershipAndMode(rootStat, this.root, {
      requirePrivate: this.requirePrivatePermissions,
    });
    const realRoot = await fs.realpath(this.root);
    const relative = path.relative(this.root, lexicalAbsolute);
    const segments = relative.split(path.sep);
    const filename = segments.pop();
    let current = realRoot;

    for (const segment of segments) {
      current = path.join(current, segment);
      let stat;
      try {
        stat = await fs.lstat(current);
      } catch (error) {
        if (error?.code !== 'ENOENT' || !createParent) throw error;
        try {
          await fs.mkdir(current, { mode: 0o700 });
        } catch (mkdirError) {
          if (mkdirError?.code !== 'EEXIST') throw mkdirError;
        }
        stat = await fs.lstat(current);
      }
      if (stat.isSymbolicLink()) throw unsafeSymlinkError(current);
      if (!stat.isDirectory()) {
        throw new Error(`Local asset storage parent is not a directory: ${current}`);
      }
      assertSafeLocalOwnershipAndMode(stat, current, {
        requirePrivate: this.requirePrivatePermissions,
      });
      const realCurrent = await fs.realpath(current);
      if (!isContainedPath(realRoot, realCurrent)) {
        throw new Error('Asset storage key escapes the configured local storage root.');
      }
      current = realCurrent;
    }

    const absolute = path.join(current, filename);
    if (!isContainedPath(realRoot, absolute)) {
      throw new Error('Asset storage key escapes the configured local storage root.');
    }
    try {
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) throw unsafeSymlinkError(absolute);
      if (!stat.isFile()) {
        throw new Error(`Local asset storage path is not a regular file: ${absolute}`);
      }
      assertSafeLocalOwnershipAndMode(stat, absolute, {
        requirePrivate: this.requirePrivatePermissions,
      });
    } catch (error) {
      if (error?.code !== 'ENOENT' || requireFile) throw error;
    }
    return absolute;
  }

  async writeAndSyncTempFile(absolute, buffer) {
    const flags = fsConstants.O_RDWR
      | fsConstants.O_CREAT
      | fsConstants.O_EXCL
      | (fsConstants.O_NOFOLLOW || 0);
    const handle = await fs.open(absolute, flags, 0o600);
    let operationError = null;
    try {
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesWritten } = await handle.write(
          buffer,
          offset,
          buffer.length - offset,
          offset
        );
        if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0) {
          throw new Error('Local asset temporary write made no forward progress.');
        }
        offset += bytesWritten;
      }
      if (offset !== buffer.length) {
        throw new Error(
          `Local asset temporary write was incomplete: wrote ${offset} of ${buffer.length} bytes.`
        );
      }
      await handle.sync();
    } catch (error) {
      operationError = error;
    }
    try {
      await handle.close();
    } catch (error) {
      operationError ||= error;
    }
    if (operationError) throw operationError;
  }

  async removeIfExists(absolute) {
    try {
      await fs.unlink(absolute);
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }

  async syncDirectory(absolute) {
    const unsupportedCodes = new Set([
      'EBADF',
      'EISDIR',
      'EINVAL',
      'ENOSYS',
      'ENOTSUP',
      'EOPNOTSUPP',
    ]);
    let handle;
    try {
      handle = await fs.open(
        absolute,
        fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY || 0)
      );
    } catch (error) {
      if (unsupportedCodes.has(error?.code)) return;
      throw error;
    }
    try {
      await handle.sync();
    } catch (error) {
      if (!unsupportedCodes.has(error?.code)) throw error;
    } finally {
      await handle.close();
    }
  }

  async cleanupFailedPublication({ tempAbsolute, finalAbsolute, published, originalError }) {
    const cleanupErrors = [];
    try {
      await this.removeIfExists(tempAbsolute);
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (published) {
      try {
        await this.removeIfExists(finalAbsolute);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      await this.syncDirectory(path.dirname(finalAbsolute));
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length) {
      const error = new AggregateError(
        [originalError, ...cleanupErrors],
        `${originalError.message || String(originalError)} Local asset publication cleanup was incomplete.`,
        { cause: originalError }
      );
      error.code = originalError?.code || 'ASSET_PUBLICATION_CLEANUP_FAILED';
      throw error;
    }
    throw originalError;
  }

  async publishImmutableBuffer({ key, buffer, expectedSha256, allowExisting }) {
    const finalAbsolute = await this.safeAbsolutePathForKey(key, { createParent: true });
    if (allowExisting) {
      try {
        const existing = await readRegularFileNoFollow(finalAbsolute, this.maxBytes);
        verifyBuffer(existing, {
          expectedSha256,
          maxBytes: this.maxBytes,
        });
        return { reused: true };
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }

    const directory = path.dirname(finalAbsolute);
    const tempAbsolute = path.join(
      directory,
      `.${path.basename(finalAbsolute)}.${crypto.randomUUID()}.tmp`
    );
    let published = false;
    try {
      await this.writeAndSyncTempFile(tempAbsolute, buffer);
      const temporary = await readRegularFileNoFollow(tempAbsolute, this.maxBytes);
      verifyBuffer(temporary, {
        expectedSha256,
        maxBytes: this.maxBytes,
      });

      try {
        await fs.link(tempAbsolute, finalAbsolute);
        published = true;
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        if (!allowExisting) {
          const collision = new Error(`Local immutable recovery key collision: ${key}`);
          collision.code = 'EEXIST';
          throw collision;
        }
        const existingAbsolute = await this.safeAbsolutePathForKey(key, {
          requireFile: true,
        });
        const existing = await readRegularFileNoFollow(existingAbsolute, this.maxBytes);
        verifyBuffer(existing, {
          expectedSha256,
          maxBytes: this.maxBytes,
        });
        await this.removeIfExists(tempAbsolute);
        await this.syncDirectory(directory);
        return { reused: true };
      }

      const storedAbsolute = await this.safeAbsolutePathForKey(key, { requireFile: true });
      const stored = await readRegularFileNoFollow(storedAbsolute, this.maxBytes);
      verifyBuffer(stored, {
        expectedSha256,
        maxBytes: this.maxBytes,
      });
      await this.removeIfExists(tempAbsolute);
      await this.syncDirectory(directory);
      return { reused: false };
    } catch (error) {
      return this.cleanupFailedPublication({
        tempAbsolute,
        finalAbsolute,
        published,
        originalError: error,
      });
    }
  }

  async putImmutable({ body, contentType = 'application/octet-stream', sha256: expectedSha256 }) {
    const buffer = asBuffer(body);
    const expected = normalizeSha256(expectedSha256, 'sha256');
    const verified = verifyBuffer(buffer, { expectedSha256: expected, maxBytes: this.maxBytes });
    const key = immutableKey(expected);
    const { reused } = await this.publishImmutableBuffer({
      key,
      buffer,
      expectedSha256: expected,
      allowExisting: true,
    });

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
      try {
        await this.publishImmutableBuffer({
          key,
          buffer,
          expectedSha256: expected,
          allowExisting: false,
        });
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
    const limit = assertPositiveMaxBytes(maxBytes);
    const absolute = await this.safeAbsolutePathForKey(key, { requireFile: true });
    const buffer = await readRegularFileNoFollow(absolute, limit);
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
  if (provider === 'local') {
    const storageRoot = normalizeAbsoluteStorageRoot(env.ASSET_STORAGE_ROOT);
    return new LocalAssetStorage({ root, storageRoot, maxBytes });
  }
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
