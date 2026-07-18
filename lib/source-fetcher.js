import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { describeDbError, getDbPool } from './db.js';
import { getDiscoverySource } from './discovery-sources.js';
import {
  getAsset,
  getAssetFileStatus,
  registerAsset,
  repairAssetRecordWithBuffer,
} from './assets.js';

const MAX_DOWNLOAD_BYTES = 30 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15000;
const DNS_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SENSITIVE_QUERY_KEY = /(?:^|[_-])(?:access[_-]?key|api[_-]?key|auth|authorization|credential|pass(?:word|wd)?|secret|sig(?:nature)?|token)(?:$|[_-])/i;
const ALLOWED_CONTENT_TYPES = [
  'text/html',
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
];

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeId(value, label = 'ID') {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function mediaType(value) {
  return clean(value).toLowerCase().split(';')[0].trim();
}

function isAllowedContentType(value) {
  const type = mediaType(value);
  return ALLOWED_CONTENT_TYPES.includes(type) || type.startsWith('image/');
}

function assertUrlHasNoCredentials(url) {
  if (url.username || url.password) {
    throw new Error('Fetch URL must not contain embedded credentials.');
  }
  for (const key of url.searchParams.keys()) {
    if (key.toLowerCase() === 'key' || SENSITIVE_QUERY_KEY.test(key)) {
      throw new Error(`Fetch URL must not contain sensitive query parameter "${key}".`);
    }
  }
}

export function normalizeSourceFetchUrl(value) {
  let parsed;
  try {
    parsed = new URL(clean(value));
  } catch {
    throw new Error('Fetch URL must be a valid URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Fetch URL must use http or https.');
  }
  assertUrlHasNoCredentials(parsed);
  parsed.hash = '';
  return parsed;
}

function hostBelongsToSource(url, source) {
  const targetHost = url.hostname.toLowerCase();
  const baseHost = new URL(source.baseUrl).hostname.toLowerCase();
  return targetHost === baseHost || targetHost.endsWith(`.${baseHost}`);
}

function ipv4Number(address) {
  if (net.isIP(address) !== 4) return null;
  return address.split('.').reduce((value, part) => (value << 8n) | BigInt(Number(part)), 0n);
}

function ipv6Number(address) {
  let normalized = address.toLowerCase();
  const ipv4Match = normalized.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Match) {
    const ipv4 = ipv4Number(ipv4Match[2]);
    if (ipv4 == null) return null;
    normalized = `${ipv4Match[1]}${Number((ipv4 >> 16n) & 0xffffn).toString(16)}:${Number(ipv4 & 0xffffn).toString(16)}`;
  }
  if (net.isIP(normalized) !== 6) return null;
  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = halves.length === 2
    ? [...left, ...Array(missing).fill('0'), ...right]
    : left;
  if (groups.length !== 8) return null;
  let value = 0n;
  for (const group of groups) {
    const parsed = Number.parseInt(group, 16);
    if (!/^[a-f0-9]{1,4}$/i.test(group) || !Number.isInteger(parsed)) return null;
    value = (value << 16n) | BigInt(parsed);
  }
  return value;
}

function inPrefix(value, base, prefixBits, width) {
  const shift = BigInt(width - prefixBits);
  return (value >> shift) === (base >> shift);
}

function ipv4In(address, base, prefixBits) {
  const value = ipv4Number(address);
  const baseValue = ipv4Number(base);
  return value != null && baseValue != null && inPrefix(value, baseValue, prefixBits, 32);
}

function isBlockedIpv4(address) {
  return [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ].some(([base, prefix]) => ipv4In(address, base, prefix));
}

function isBlockedIpv6(address) {
  const value = ipv6Number(address);
  if (value == null) return true;
  const mappedPrefix = 0xffffn;
  if ((value >> 32n) === mappedPrefix) {
    const mapped = [24n, 16n, 8n, 0n]
      .map(shift => Number((value >> shift) & 0xffn))
      .join('.');
    return isBlockedIpv4(mapped);
  }

  // Only global unicast (2000::/3) is accepted. Documentation, benchmarking,
  // Teredo, 6to4, local, multicast, and future/reserved ranges fail closed.
  const globalBase = ipv6Number('2000::');
  if (!inPrefix(value, globalBase, 3, 128)) return true;
  return [
    ['2001::', 32],
    ['2001:2::', 48],
    ['2001:10::', 28],
    ['2001:20::', 28],
    ['2001:db8::', 32],
    ['2002::', 16],
  ].some(([base, prefix]) => inPrefix(value, ipv6Number(base), prefix, 128));
}

export function isBlockedSourceAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true;
}

function unbracketedHostname(url) {
  return url.hostname.replace(/^\[|\]$/g, '');
}

export async function resolvePublicSourceAddress(url, { lookup = dns.lookup } = {}) {
  const hostname = unbracketedHostname(url);
  if (['localhost', 'localhost.localdomain'].includes(hostname.toLowerCase())) {
    throw new Error('Fetch URL cannot target localhost.');
  }
  const literalFamily = net.isIP(hostname);
  if (literalFamily) {
    if (isBlockedSourceAddress(hostname)) throw new Error('Fetch URL cannot target private, local, or reserved IP ranges.');
    return { address: hostname, family: literalFamily };
  }

  let timeout;
  const lookupTimeout = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      const error = new Error(`DNS lookup timed out after ${DNS_TIMEOUT_MS}ms.`);
      error.code = 'ETIMEDOUT';
      reject(error);
    }, DNS_TIMEOUT_MS);
  });
  let addresses;
  try {
    addresses = await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      lookupTimeout,
    ]);
  } finally {
    clearTimeout(timeout);
  }
  if (!Array.isArray(addresses) || !addresses.length) throw new Error('Fetch URL hostname did not resolve.');
  const normalizedAddresses = addresses.map(entry => {
    const family = net.isIP(entry?.address || '');
    if (!family || (Number(entry?.family) !== family)) {
      throw new Error('Fetch URL hostname returned an invalid DNS address.');
    }
    return { address: entry.address, family };
  });
  if (normalizedAddresses.some(entry => isBlockedSourceAddress(entry.address))) {
    throw new Error('Fetch URL resolved to a private, local, or reserved IP range.');
  }
  const selected = normalizedAddresses.sort((a, b) => a.family - b.family)[0];
  return { address: selected.address, family: selected.family };
}

function filenameFromResponse(url, headers) {
  const disposition = headers.get('content-disposition') || '';
  const filenameMatch = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  if (filenameMatch?.[1]) return decodeURIComponent(filenameMatch[1].replaceAll('"', '').trim());
  const basename = path.basename(url.pathname);
  if (basename && basename !== '/') return basename;
  const ext = mediaType(headers.get('content-type')) === 'application/pdf'
    ? '.pdf'
    : mediaType(headers.get('content-type')).includes('zip')
      ? '.zip'
      : '.html';
  return `source-fetch${ext}`;
}

export function requestPinnedSource(url, pinned, {
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
  maxBytes = MAX_DOWNLOAD_BYTES,
} = {}) {
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0 || requestTimeoutMs > REQUEST_TIMEOUT_MS) {
    throw new Error(`Source request timeout must be between 1 and ${REQUEST_TIMEOUT_MS}ms.`);
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Source response limit must be between 1 and ${MAX_DOWNLOAD_BYTES} bytes.`);
  }
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    let settled = false;
    let request;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const timeout = setTimeout(() => {
      const error = new Error(`Source request timed out after ${requestTimeoutMs}ms.`);
      error.code = 'ETIMEDOUT';
      request?.destroy(error);
      finish(reject, error);
    }, requestTimeoutMs);

    const options = {
      method: 'GET',
      headers: {
        'user-agent': 'JNTUStack manual source fetch/0.1',
        accept: 'text/html,application/pdf,application/zip,image/*;q=0.8,*/*;q=0.1',
      },
      lookup(_hostname, lookupOptions, callback) {
        if (lookupOptions?.all) {
          callback(null, [{ address: pinned.address, family: pinned.family }]);
          return;
        }
        callback(null, pinned.address, pinned.family);
      },
    };
    if (url.protocol === 'https:' && net.isIP(unbracketedHostname(url)) === 0) {
      options.servername = unbracketedHostname(url);
    }

    request = transport.request(url, options, response => {
      const headers = new Headers(response.headers);
      const status = response.statusCode || 0;
      if (REDIRECT_STATUSES.has(status)) {
        response.destroy();
        finish(resolve, {
          status,
          statusText: response.statusMessage || '',
          ok: false,
          headers,
          buffer: Buffer.alloc(0),
        });
        return;
      }

      const declaredLength = Number(headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        const error = new Error(`Downloaded asset is too large. Limit is ${maxBytes} bytes.`);
        response.destroy(error);
        finish(reject, error);
        return;
      }
      const chunks = [];
      let total = 0;
      response.on('data', chunk => {
        if (settled) return;
        total += chunk.length;
        if (total > maxBytes) {
          const error = new Error(`Downloaded asset exceeded ${maxBytes} bytes.`);
          response.destroy(error);
          finish(reject, error);
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      response.once('end', () => finish(resolve, {
        status,
        statusText: response.statusMessage || '',
        ok: status >= 200 && status < 300,
        headers,
        buffer: Buffer.concat(chunks, total),
      }));
      response.once('error', error => finish(reject, error));
    });
    request.once('error', error => finish(reject, error));
    request.end();
  });
}

async function fetchWithRedirects(initialUrl, source) {
  let current = initialUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    if (!hostBelongsToSource(current, source)) {
      throw new Error('Fetch URL must belong to the configured discovery source domain.');
    }
    const pinned = await resolvePublicSourceAddress(current);
    const response = await requestPinnedSource(current, pinned);

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`Redirect ${response.status} did not include a Location header.`);
      current = normalizeSourceFetchUrl(new URL(location, current).href);
      continue;
    }

    return { response, finalUrl: current };
  }
  throw new Error(`Too many redirects. Limit is ${MAX_REDIRECTS}.`);
}

async function audit({ actor, action, entityType, entityId, before = null, after = null }) {
  const pool = await getDbPool({ requireConfigured: true });
  await pool.execute(
    `INSERT INTO audit_log
      (actor, action, entity_type, entity_id, before_json, after_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      actor,
      action,
      entityType,
      entityId == null ? null : String(entityId),
      before == null ? null : JSON.stringify(before),
      after == null ? null : JSON.stringify(after),
    ]
  );
}

async function findAssetByUrl(discoverySourceId, sourceUrl) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute(
    `SELECT id, download_status, source_url, resolved_url, url, local_storage_path, storage_path,
       storage_provider, storage_key, sha256_checksum
     FROM source_assets
     WHERE discovery_source_id = ?
       AND (source_url = ? OR resolved_url = ? OR url = ?)
     ORDER BY id DESC
     LIMIT 1`,
    [discoverySourceId, sourceUrl, sourceUrl, sourceUrl]
  );
  return rows[0] || null;
}

async function downloadSourceAsset({ source, initialUrl }) {
  const { response, finalUrl } = await fetchWithRedirects(initialUrl, source);
  if (!response.ok) {
    throw new Error(`Fetch failed with HTTP ${response.status}.`);
  }
  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  if (!isAllowedContentType(contentType)) {
    throw new Error(`Unsupported fetched content type: ${contentType || 'missing'}.`);
  }
  const buffer = response.buffer;
  if (buffer.length === 0) throw new Error('Fetched response body is empty.');
  return {
    response,
    finalUrl,
    contentType,
    buffer,
    filename: filenameFromResponse(finalUrl, response.headers),
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'),
  };
}

async function repairExistingAssetFromUrl({
  root,
  source,
  assetId,
  sourceUrl,
  actor,
  reason = 'stored_file_missing',
}) {
  const initialUrl = normalizeSourceFetchUrl(sourceUrl);
  await audit({
    actor,
    action: 'source_asset.repair_started',
    entityType: 'source_asset',
    entityId: assetId,
    after: { reason, source_url: initialUrl.href },
  });
  try {
    const downloaded = await downloadSourceAsset({ source, initialUrl });
    return await repairAssetRecordWithBuffer({
      root,
      assetId,
      originalFilename: downloaded.filename,
      contentType: downloaded.contentType,
      buffer: downloaded.buffer,
      etag: downloaded.etag,
      lastModified: downloaded.lastModified,
      assetKind: 'manual_fetch',
      finalUrl: downloaded.finalUrl.href,
      actor,
      reason,
    });
  } catch (err) {
    await audit({
      actor,
      action: 'source_asset.repair_failed',
      entityType: 'source_asset',
      entityId: assetId,
      after: {
        reason,
        source_url: initialUrl.href,
        error: err.message || String(err),
      },
    });
    throw err;
  }
}

async function handleExistingAsset({ root, source, existing, sourceUrl, actor }) {
  const existingAsset = await getAsset(existing.id);
  const fileStatus = await getAssetFileStatus(root, existingAsset);
  if (fileStatus.exists) {
    await audit({
      actor,
      action: 'source_fetch.duplicate',
      entityType: 'source_asset',
      entityId: existing.id,
      after: { reason: 'source_url_already_stored', source_url: sourceUrl },
    });
    return { assetId: existing.id, duplicateDetected: true, existingUrl: true };
  }

  const integrityInvalid = fileStatus.status === 'invalid';
  await audit({
    actor,
    action: 'source_asset.missing_detected',
    entityType: 'source_asset',
    entityId: existing.id,
    after: {
      reason: integrityInvalid ? 'stored_file_invalid' : 'stored_file_missing',
      source_url: sourceUrl,
      storage_provider: existingAsset.storageProvider,
      storage_key: existingAsset.storageKey,
      storage_path: existingAsset.localStoragePath,
      integrity_error: fileStatus.integrityError,
    },
  });
  const repair = await repairExistingAssetFromUrl({
    root,
    source,
    assetId: existing.id,
    sourceUrl,
    actor,
    reason: integrityInvalid ? 'source_url_file_invalid' : 'source_url_file_missing',
  });
  await audit({
    actor,
    action: 'source_fetch.success',
    entityType: 'source_asset',
    entityId: repair.asset.id,
    after: {
      discovery_source_id: source.id,
      source_url: sourceUrl,
      repaired: true,
      versioned: Boolean(repair.versioned),
      supersedes_asset_id: repair.supersedesAssetId || null,
      duplicate_detected: repair.duplicateDetected,
      content_type: repair.asset.contentType,
      file_size: repair.asset.fileSize,
    },
  });
  return {
    assetId: repair.asset.id,
    asset: repair.asset,
    repaired: true,
    versioned: Boolean(repair.versioned),
    supersedesAssetId: repair.supersedesAssetId || null,
    duplicateDetected: repair.duplicateDetected,
    duplicateOf: repair.duplicateOf,
  };
}

export async function fetchSourceUrl({
  root,
  discoverySourceId,
  sourceUrl,
  actor = null,
}) {
  const sourceId = normalizeId(discoverySourceId, 'Discovery source ID');
  const source = await getDiscoverySource(sourceId);
  if (!source) throw new Error(`Discovery source not found: ${sourceId}`);
  if (!source.enabled) throw new Error('Discovery source is disabled. Enable it before fetching new evidence.');
  const initialUrl = normalizeSourceFetchUrl(sourceUrl);

  await audit({
    actor,
    action: 'source_fetch.run',
    entityType: 'discovery_source',
    entityId: source.id,
    after: { discovery_source_id: source.id, source_url: initialUrl.href },
  });

  try {
    if (!hostBelongsToSource(initialUrl, source)) {
      throw new Error('Fetch URL must belong to the configured discovery source domain.');
    }
    const existing = await findAssetByUrl(source.id, initialUrl.href);
    if (existing) {
      return await handleExistingAsset({ root, source, existing, sourceUrl: initialUrl.href, actor });
    }

    const downloaded = await downloadSourceAsset({ source, initialUrl });
    if (downloaded.finalUrl.href !== initialUrl.href) {
      const redirectedExisting = await findAssetByUrl(source.id, downloaded.finalUrl.href);
      if (redirectedExisting) {
        return await handleExistingAsset({
          root,
          source,
          existing: redirectedExisting,
          sourceUrl: downloaded.finalUrl.href,
          actor,
        });
      }
    }

    const result = await registerAsset({
      root,
      discoverySourceId: source.id,
      sourceUrl: initialUrl.href,
      resolvedUrl: downloaded.finalUrl.href,
      originalFilename: downloaded.filename,
      contentType: downloaded.contentType,
      buffer: downloaded.buffer,
      etag: downloaded.etag,
      lastModified: downloaded.lastModified,
      assetKind: 'manual_fetch',
      actor,
    });

    await audit({
      actor,
      action: result.duplicateDetected ? 'source_fetch.duplicate' : 'source_fetch.success',
      entityType: 'source_asset',
      entityId: result.asset.id,
      after: {
        discovery_source_id: source.id,
        source_url: downloaded.finalUrl.href,
        duplicate_detected: result.duplicateDetected,
        content_type: downloaded.contentType,
        file_size: downloaded.buffer.length,
        etag: downloaded.etag,
        last_modified: downloaded.lastModified,
      },
    });

    return {
      assetId: result.asset.id,
      asset: result.asset,
      duplicateDetected: result.duplicateDetected,
      duplicateOf: result.duplicateOf,
    };
  } catch (err) {
    await audit({
      actor,
      action: 'source_fetch.error',
      entityType: 'discovery_source',
      entityId: source.id,
      after: {
        discovery_source_id: source.id,
        source_url: initialUrl.href,
        download_status: 'failed',
        download_error: err.message || String(err),
      },
    });
    throw err;
  }
}

export async function repairMissingAssetFile({
  root,
  assetId,
  actor = null,
}) {
  const id = normalizeId(assetId, 'Asset ID');
  const asset = await getAsset(id);
  if (!asset) throw new Error(`Source asset not found: ${id}`);
  if (!asset.sourceUrl) throw new Error('Asset has no source URL to re-fetch.');
  if (!asset.discoverySourceId) throw new Error('Asset is not linked to a discovery source.');
  const source = await getDiscoverySource(asset.discoverySourceId);
  if (!source) throw new Error(`Discovery source not found: ${asset.discoverySourceId}`);
  if (!source.enabled) throw new Error('Discovery source is disabled. Enable it before repairing the evidence file.');
  const fileStatus = await getAssetFileStatus(root, asset);
  if (fileStatus.exists) {
    throw new Error('Asset file is already present; repair is not needed.');
  }
  await audit({
    actor,
    action: 'source_asset.missing_detected',
    entityType: 'source_asset',
    entityId: asset.id,
    after: {
      reason: fileStatus.status === 'invalid' ? 'admin_repair_file_invalid' : 'admin_repair_file_missing',
      source_url: asset.sourceUrl,
      storage_provider: asset.storageProvider,
      storage_key: asset.storageKey,
      storage_path: asset.localStoragePath,
      integrity_error: fileStatus.integrityError,
    },
  });
  return repairExistingAssetFromUrl({
    root,
    source,
    assetId: asset.id,
    sourceUrl: asset.sourceUrl,
    actor,
    reason: fileStatus.status === 'invalid' ? 'admin_repair_file_invalid' : 'admin_repair_file_missing',
  });
}

export function sourceFetchErrorSummary(err) {
  const safe = describeDbError(err);
  if (err?.name === 'DatabaseConfigError') {
    return 'Manual source fetch requires MySQL configuration. Set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, and run migrations.';
  }
  if (safe.code === 'ER_NO_SUCH_TABLE' || safe.code === 'ER_BAD_FIELD_ERROR') {
    return 'Source fetch tables are missing or out of date. Run npm run db:migrate.';
  }
  return `${safe.code ? `${safe.code}: ` : ''}${safe.message}`;
}
