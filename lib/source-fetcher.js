import dns from 'node:dns/promises';
import net from 'node:net';
import path from 'node:path';
import { describeDbError, getDbPool } from './db.js';
import { getDiscoverySource } from './discovery-sources.js';
import { assetFileExists, registerAsset } from './assets.js';

const MAX_DOWNLOAD_BYTES = 30 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 5;
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

function normalizeUrl(value) {
  let parsed;
  try {
    parsed = new URL(clean(value));
  } catch {
    throw new Error('Fetch URL must be a valid URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Fetch URL must use http or https.');
  }
  parsed.hash = '';
  return parsed;
}

function hostBelongsToSource(url, source) {
  const targetHost = url.hostname.toLowerCase();
  const baseHost = new URL(source.baseUrl).hostname.toLowerCase();
  return targetHost === baseHost || targetHost.endsWith(`.${baseHost}`);
}

function isPrivateIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isPrivateIpv6(address) {
  const normalized = address.toLowerCase();
  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    normalized.startsWith('::ffff:127.') ||
    normalized.startsWith('::ffff:10.') ||
    normalized.startsWith('::ffff:192.168.')
  );
}

function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

async function assertPublicHost(url) {
  const hostname = url.hostname;
  if (['localhost', 'localhost.localdomain'].includes(hostname.toLowerCase())) {
    throw new Error('Fetch URL cannot target localhost.');
  }
  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname)) throw new Error('Fetch URL cannot target private or local IP ranges.');
    return;
  }
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length) throw new Error('Fetch URL hostname did not resolve.');
  if (addresses.some(entry => isBlockedAddress(entry.address))) {
    throw new Error('Fetch URL resolved to a private or local IP range.');
  }
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

async function readResponseBody(response) {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Downloaded asset is too large. Limit is ${MAX_DOWNLOAD_BYTES} bytes.`);
  }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_DOWNLOAD_BYTES) {
      throw new Error(`Downloaded asset exceeded ${MAX_DOWNLOAD_BYTES} bytes.`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function fetchWithRedirects(initialUrl, source) {
  let current = initialUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    if (!hostBelongsToSource(current, source)) {
      throw new Error('Fetch URL must belong to the configured discovery source domain.');
    }
    await assertPublicHost(current);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': 'JNTUStack manual source fetch/0.1',
          accept: 'text/html,application/pdf,application/zip,image/*;q=0.8,*/*;q=0.1',
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`Redirect ${response.status} did not include a Location header.`);
      current = normalizeUrl(new URL(location, current).href);
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
    `SELECT id, download_status, source_url, url, local_storage_path, storage_path
     FROM source_assets
     WHERE discovery_source_id = ?
       AND (source_url = ? OR url = ?)
     ORDER BY id DESC
     LIMIT 1`,
    [discoverySourceId, sourceUrl, sourceUrl]
  );
  return rows[0] || null;
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
  const initialUrl = normalizeUrl(sourceUrl);

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
      const existingPath = existing.local_storage_path ?? existing.storage_path;
      if (!(await assetFileExists(root, existingPath))) {
        await audit({
          actor,
          action: 'source_fetch.stale_asset_metadata',
          entityType: 'source_asset',
          entityId: existing.id,
          after: { reason: 'stored_file_missing', source_url: initialUrl.href },
        });
      } else {
        await audit({
          actor,
          action: 'source_fetch.duplicate',
          entityType: 'source_asset',
          entityId: existing.id,
          after: { reason: 'source_url_already_stored', source_url: initialUrl.href },
        });
        return { assetId: existing.id, duplicateDetected: true, existingUrl: true };
      }
    }

    const { response, finalUrl } = await fetchWithRedirects(initialUrl, source);
    if (!response.ok) {
      throw new Error(`Fetch failed with HTTP ${response.status}.`);
    }
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    if (!isAllowedContentType(contentType)) {
      throw new Error(`Unsupported fetched content type: ${contentType || 'missing'}.`);
    }
    const buffer = await readResponseBody(response);
    if (buffer.length === 0) throw new Error('Fetched response body is empty.');

    const result = await registerAsset({
      root,
      discoverySourceId: source.id,
      sourceUrl: finalUrl.href,
      originalFilename: filenameFromResponse(finalUrl, response.headers),
      contentType,
      buffer,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
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
        source_url: finalUrl.href,
        duplicate_detected: result.duplicateDetected,
        content_type: contentType,
        file_size: buffer.length,
        etag: response.headers.get('etag'),
        last_modified: response.headers.get('last-modified'),
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
