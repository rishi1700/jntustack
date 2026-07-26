import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createAssetStorage } from './asset-storage.js';
import { getAssetStoragePublicationReadiness } from './config.js';
import {
  DEPLOYMENT_PROVENANCE_FILENAME,
  normalizeCommitSha,
  readDeploymentProvenance,
} from './deployment-provenance.js';

const MARKER_SCHEMA_VERSION = 1;
const MARKER_KEY = 'health/deployment-persistence.json';
const MAX_MARKER_BYTES = 4096;
const STORE_ID_PATTERN = /^[A-Za-z0-9._-]{16,128}$/;

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPathWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === ''
    || (
      relative !== '..'
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative)
    );
}

function unsafePersistentRoot(storageRoot, applicationRoot) {
  const resolvedStorageRoot = path.resolve(storageRoot);
  const resolvedApplicationRoot = path.resolve(applicationRoot);
  if (resolvedStorageRoot === path.parse(resolvedStorageRoot).root) return true;
  if (isPathWithin(resolvedApplicationRoot, resolvedStorageRoot)) return true;
  const segments = resolvedStorageRoot
    .split(path.sep)
    .filter(Boolean)
    .map(segment => segment.toLowerCase());
  return segments.includes('public_html') || segments.includes('nodejs');
}

function persistenceResult({
  provider,
  status,
  configured = true,
  verified = false,
  acknowledged = false,
  seeded = false,
}) {
  return {
    provider,
    configured,
    verified,
    acknowledged,
    ready: configured && verified && acknowledged,
    seeded,
    status,
  };
}

async function readBoundedRegularFile(storage, key) {
  const absolute = await storage.safeAbsolutePathForKey(key, { requireFile: true });
  const handle = await fs.open(
    absolute,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0)
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_MARKER_BYTES) {
      throw new Error('Asset persistence marker is not a bounded regular file.');
    }
    return await handle.readFile({ encoding: 'utf8' });
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fs.open(directory, fsConstants.O_RDONLY);
    await handle.sync();
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM'].includes(error?.code)) throw error;
  } finally {
    if (handle) await handle.close();
  }
}

async function createMarkerAtomically(storage, marker) {
  const buffer = Buffer.from(`${JSON.stringify(marker)}\n`);
  if (buffer.length > MAX_MARKER_BYTES) throw new Error('Asset persistence marker is too large.');

  const temporaryKey = `health/.deployment-persistence.${crypto.randomUUID()}.tmp`;
  const temporaryPath = await storage.safeAbsolutePathForKey(temporaryKey, { createParent: true });
  const markerPath = await storage.safeAbsolutePathForKey(MARKER_KEY, { createParent: true });
  let temporaryCreated = false;
  let handle;
  try {
    handle = await fs.open(
      temporaryPath,
      fsConstants.O_WRONLY
        | fsConstants.O_CREAT
        | fsConstants.O_EXCL
        | (fsConstants.O_NOFOLLOW || 0),
      0o600
    );
    temporaryCreated = true;
    await handle.writeFile(buffer);
    await handle.sync();
    await handle.close();
    handle = null;

    try {
      await fs.link(temporaryPath, markerPath);
      await syncDirectory(path.dirname(markerPath));
      return true;
    } catch (error) {
      if (error?.code === 'EEXIST') return false;
      throw error;
    }
  } finally {
    if (handle) await handle.close().catch(() => {});
    if (temporaryCreated) {
      await fs.unlink(temporaryPath).catch(error => {
        if (error?.code !== 'ENOENT') throw error;
      });
    }
  }
}

function parseMarker(value) {
  const marker = JSON.parse(value);
  if (
    marker?.schema_version !== MARKER_SCHEMA_VERSION
    || !STORE_ID_PATTERN.test(clean(marker.store_id))
    || !normalizeCommitSha(marker.seed_commit)
    || !Number.isFinite(Date.parse(marker.seeded_at))
  ) {
    throw new Error('Asset persistence marker is invalid.');
  }
  return {
    schema_version: MARKER_SCHEMA_VERSION,
    store_id: clean(marker.store_id),
    seed_commit: normalizeCommitSha(marker.seed_commit),
    seeded_at: new Date(marker.seeded_at).toISOString(),
  };
}

export async function checkAssetStoragePersistence({
  root = process.cwd(),
  env = process.env,
  seedIfMissing = false,
  now = () => new Date(),
  storageFactory = createAssetStorage,
} = {}) {
  const configured = getAssetStoragePublicationReadiness(env);
  if (configured.provider !== 'local') {
    return persistenceResult({
      provider: configured.provider,
      status: configured.ready ? 'configured' : 'not_configured',
      configured: configured.ready,
      verified: configured.ready,
      acknowledged: configured.ready,
    });
  }

  const expectedStoreId = clean(env.ASSET_STORAGE_EXPECTED_ID);
  const acknowledged = clean(env.ASSET_STORAGE_PERSISTENCE_VERIFIED).toLowerCase() === 'true';
  if (!configured.absoluteRoot) {
    return persistenceResult({
      provider: 'local',
      status: 'not_configured',
      configured: false,
      acknowledged,
    });
  }
  if (unsafePersistentRoot(env.ASSET_STORAGE_ROOT, root)) {
    return persistenceResult({
      provider: 'local',
      status: 'unsafe_storage_root',
      configured: false,
      acknowledged,
    });
  }
  if (!STORE_ID_PATTERN.test(expectedStoreId)) {
    return persistenceResult({
      provider: 'local',
      status: 'not_configured',
      configured: false,
      acknowledged,
    });
  }

  const deployment = readDeploymentProvenance(
    path.join(root, 'dist', DEPLOYMENT_PROVENANCE_FILENAME)
  );
  const currentCommit = normalizeCommitSha(deployment.commit_sha);
  if (!currentCommit) {
    return persistenceResult({
      provider: 'local',
      status: 'deployment_provenance_unavailable',
      acknowledged,
    });
  }

  let storage;
  try {
    storage = storageFactory({ env, root });
    if (storage?.provider !== 'local' || typeof storage.safeAbsolutePathForKey !== 'function') {
      throw new Error('Local asset storage adapter is unavailable.');
    }
  } catch {
    return persistenceResult({
      provider: 'local',
      status: 'storage_unavailable',
      acknowledged,
    });
  }

  let marker;
  try {
    marker = parseMarker(await readBoundedRegularFile(storage, MARKER_KEY));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      return persistenceResult({
        provider: 'local',
        status: 'marker_invalid',
        acknowledged,
      });
    }
    if (!seedIfMissing) {
      return persistenceResult({
        provider: 'local',
        status: 'marker_missing',
        acknowledged,
      });
    }
    try {
      const seeded = await createMarkerAtomically(storage, {
        schema_version: MARKER_SCHEMA_VERSION,
        store_id: expectedStoreId,
        seed_commit: currentCommit,
        seeded_at: now().toISOString(),
      });
      if (!seeded) {
        marker = parseMarker(await readBoundedRegularFile(storage, MARKER_KEY));
      } else {
        return persistenceResult({
          provider: 'local',
          status: 'seeded_waiting_for_new_deploy',
          acknowledged,
          seeded: true,
        });
      }
    } catch {
      return persistenceResult({
        provider: 'local',
        status: 'marker_seed_failed',
        acknowledged,
      });
    }
  }

  if (marker.store_id !== expectedStoreId) {
    return persistenceResult({
      provider: 'local',
      status: 'store_identity_mismatch',
      acknowledged,
    });
  }
  if (marker.seed_commit === currentCommit) {
    return persistenceResult({
      provider: 'local',
      status: 'waiting_for_new_deploy',
      acknowledged,
    });
  }
  return persistenceResult({
    provider: 'local',
    status: acknowledged ? 'verified' : 'verified_not_acknowledged',
    verified: true,
    acknowledged,
  });
}

export const ASSET_STORAGE_PERSISTENCE_MARKER_KEY = MARKER_KEY;
