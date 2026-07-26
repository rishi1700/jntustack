import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ASSET_STORAGE_PERSISTENCE_MARKER_KEY,
  checkAssetStoragePersistence,
} from '../lib/asset-storage-persistence.js';

const COMMIT_A = 'a'.repeat(40);
const COMMIT_B = 'b'.repeat(40);
const STORE_ID = 'jntustack-hostinger-assets-2026-07';

async function writeDeployment(root, commitSha) {
  await fs.mkdir(path.join(root, 'dist'), { recursive: true });
  await fs.writeFile(path.join(root, 'dist', 'deployment.json'), JSON.stringify({
    schema_version: 1,
    commit_sha: commitSha,
    source: 'environment',
    source_clean: null,
  }));
}

const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'jntustack-storage-persistence-'));
const releaseA = path.join(sandbox, 'release-a');
const releaseB = path.join(sandbox, 'release-b');
const persistentRoot = path.join(sandbox, 'persistent-assets');
const env = {
  ASSET_STORAGE_PROVIDER: 'local',
  ASSET_STORAGE_ROOT: persistentRoot,
  ASSET_STORAGE_EXPECTED_ID: STORE_ID,
  ASSET_STORAGE_PERSISTENCE_VERIFIED: 'false',
};

try {
  await writeDeployment(releaseA, COMMIT_A);
  const seeded = await checkAssetStoragePersistence({
    root: releaseA,
    env,
    seedIfMissing: true,
    now: () => new Date('2026-07-26T00:00:00.000Z'),
  });
  assert.deepEqual(seeded, {
    provider: 'local',
    configured: true,
    verified: false,
    acknowledged: false,
    ready: false,
    seeded: true,
    status: 'seeded_waiting_for_new_deploy',
  });

  const sameRelease = await checkAssetStoragePersistence({
    root: releaseA,
    env,
    seedIfMissing: true,
  });
  assert.equal(sameRelease.status, 'waiting_for_new_deploy');
  assert.equal(sameRelease.ready, false);

  await writeDeployment(releaseB, COMMIT_B);
  const survived = await checkAssetStoragePersistence({
    root: releaseB,
    env,
    seedIfMissing: false,
  });
  assert.equal(survived.status, 'verified_not_acknowledged');
  assert.equal(survived.verified, true);
  assert.equal(survived.ready, false);

  const acknowledged = await checkAssetStoragePersistence({
    root: releaseB,
    env: { ...env, ASSET_STORAGE_PERSISTENCE_VERIFIED: 'true' },
  });
  assert.equal(acknowledged.status, 'verified');
  assert.equal(acknowledged.ready, true);

  const wrongStore = await checkAssetStoragePersistence({
    root: releaseB,
    env: {
      ...env,
      ASSET_STORAGE_EXPECTED_ID: 'different-hostinger-store-2026',
      ASSET_STORAGE_PERSISTENCE_VERIFIED: 'true',
    },
  });
  assert.equal(wrongStore.status, 'store_identity_mismatch');
  assert.equal(wrongStore.ready, false);

  const missingConfig = await checkAssetStoragePersistence({
    root: releaseB,
    env: { ASSET_STORAGE_PROVIDER: 'local' },
  });
  assert.equal(missingConfig.status, 'not_configured');
  assert.equal(missingConfig.configured, false);

  for (const unsafeRoot of [
    path.join(releaseB, 'storage'),
    path.join(sandbox, 'public_html', 'private-assets'),
    path.parse(sandbox).root,
  ]) {
    const unsafe = await checkAssetStoragePersistence({
      root: releaseB,
      env: { ...env, ASSET_STORAGE_ROOT: unsafeRoot },
      seedIfMissing: true,
    });
    assert.equal(unsafe.status, 'unsafe_storage_root');
    assert.equal(unsafe.configured, false);
    assert.equal(unsafe.ready, false);
  }

  const symlinkedRoot = path.join(sandbox, 'symlinked-assets');
  const escapedRoot = path.join(sandbox, 'escaped-assets');
  await fs.mkdir(symlinkedRoot);
  await fs.mkdir(escapedRoot);
  await fs.symlink(escapedRoot, path.join(symlinkedRoot, 'health'));
  const symlinked = await checkAssetStoragePersistence({
    root: releaseA,
    env: { ...env, ASSET_STORAGE_ROOT: symlinkedRoot },
    seedIfMissing: true,
  });
  assert.equal(symlinked.status, 'marker_invalid');
  assert.equal(symlinked.ready, false);
  assert.deepEqual(await fs.readdir(escapedRoot), []);

  const markerPath = path.join(
    persistentRoot,
    ...ASSET_STORAGE_PERSISTENCE_MARKER_KEY.split('/')
  );
  assert.equal(JSON.parse(await fs.readFile(markerPath, 'utf8')).seed_commit, COMMIT_A);
} finally {
  await fs.rm(sandbox, { recursive: true, force: true });
}

console.log('Asset storage deployment-persistence checks passed.');
