import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDbConfig } from '../lib/config.js';
import { assetFileExists, getAsset, repairAssetRecordWithBuffer } from '../lib/assets.js';
import { createContentStore, loadContent } from '../lib/content-store/index.js';
import { getDbPool } from '../lib/db.js';
import { runParser } from '../lib/parse-results.js';
import { buildSearchIndex } from '../lib/retrieve.js';
import { EXPECTED_PARITY_COUNTS } from '../lib/db-json.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function count(content) {
  const searchDocs = buildSearchIndex({
    subjects: content.data.subjects,
    colleges: content.colleges,
    branchProfiles: content.branchProfiles,
  });
  return {
    subjects: content.data.subjects.length,
    verifiedSubjects: content.data.subjects.filter(s => s.source?.status === 'verified').length,
    colleges: content.colleges.length,
    branchProfiles: content.branchProfiles.length,
    searchDocs: searchDocs.length,
  };
}

function assertEqual(name, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${name}: expected ${expected}, got ${actual}`);
  }
}

function assertExpectedCounts(label, counts) {
  assertEqual(`${label} verified subjects`, counts.verifiedSubjects, EXPECTED_PARITY_COUNTS.verifiedSubjects);
  assertEqual(`${label} colleges`, counts.colleges, EXPECTED_PARITY_COUNTS.colleges);
  assertEqual(`${label} branch profiles`, counts.branchProfiles, EXPECTED_PARITY_COUNTS.branchProfiles);
  assertEqual(`${label} search docs`, counts.searchDocs, EXPECTED_PARITY_COUNTS.searchDocs);
}

async function checkMissingAssetRepair() {
  const pool = await getDbPool({ requireConfigured: true });
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'jntustack-asset-repair-'));
  const sourceKey = 'test-asset-repair';
  const sourceUrl = 'https://example.edu/test/missing-asset.html';
  let sourceId = null;
  let assetId = null;

  try {
    await pool.execute('DELETE FROM discovery_sources WHERE source_key = ?', [sourceKey]);
    const [sourceResult] = await pool.execute(
      `INSERT INTO discovery_sources
        (source_key, name, base_url, source_kind, trust_level, enabled, crawl_enabled, parser_key, notes)
       VALUES (?, 'TEST Asset Repair Source', 'https://example.edu/', 'college_official', 'test', 1, 0, 'html-basic', 'TEST FIXTURE ONLY: missing source asset repair.')`,
      [sourceKey]
    );
    sourceId = sourceResult.insertId;
    const missingPath = `storage/source-assets/${sourceId}/missing/test-missing-asset.html`;
    const [assetResult] = await pool.execute(
      `INSERT INTO source_assets
        (discovery_source_id, source_url, url, original_filename, asset_kind, content_type,
         file_size, sha256_checksum, checksum, local_storage_path, storage_path,
         downloaded_at, fetched_at, download_status, status, metadata_json)
       VALUES (?, ?, ?, 'test-missing-asset.html', 'manual_fetch', 'text/html',
         13, REPEAT('0', 64), REPEAT('0', 64), ?, ?,
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'stored', 'fetched', JSON_OBJECT('test_fixture', true))`,
      [sourceId, sourceUrl, sourceUrl, missingPath, missingPath]
    );
    assetId = assetResult.insertId;

    const beforeAsset = await getAsset(assetId);
    if (await assetFileExists(tmpRoot, beforeAsset.localStoragePath)) {
      throw new Error('Missing-asset fixture unexpectedly exists before repair.');
    }

    const buffer = Buffer.from('<!doctype html><html><head><title>Recovered Asset</title></head><body><h1>Recovered syllabus evidence</h1></body></html>');
    const repair = await repairAssetRecordWithBuffer({
      root: tmpRoot,
      assetId,
      originalFilename: 'test-missing-asset.html',
      contentType: 'text/html',
      buffer,
      finalUrl: sourceUrl,
      actor: 'test:content-store',
      reason: 'test_missing_asset_repair',
    });

    assertEqual('repair reused existing asset row', repair.asset.id, assetId);
    assertEqual('repair file size', Number(repair.asset.fileSize), buffer.length);
    if (!await assetFileExists(tmpRoot, repair.asset.localStoragePath)) {
      throw new Error('Repaired asset file was not written to storage.');
    }
    const [sameUrlRows] = await pool.execute(
      'SELECT COUNT(*) AS count FROM source_assets WHERE discovery_source_id = ? AND source_url = ?',
      [sourceId, sourceUrl]
    );
    assertEqual('source URL row count after repair', Number(sameUrlRows[0].count), 1);

    const parseResult = await runParser({
      root: tmpRoot,
      assetId,
      parserKey: 'html-basic',
      actor: 'test:content-store',
    });
    assertEqual('repaired asset parser status', parseResult.status, 'success');
  } finally {
    if (sourceId) await pool.execute('DELETE FROM discovery_sources WHERE id = ?', [sourceId]);
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}

const defaultStore = createContentStore({ root: ROOT, env: {} });
if (defaultStore.name !== 'json') {
  throw new Error(`Default content store must be json, got ${defaultStore.name}`);
}

const jsonContent = await loadContent({ root: ROOT, env: { ...process.env, CONTENT_SOURCE: 'json' } });
const jsonCounts = count(jsonContent);
assertExpectedCounts('json adapter', jsonCounts);

console.log('Content store checks');
console.log('--------------------');
console.log(`Default store : ${defaultStore.name}`);
console.log(`JSON counts   : ${JSON.stringify(jsonCounts)}`);

const dbConfig = getDbConfig();
if (dbConfig.configured) {
  const previousSource = process.env.CONTENT_SOURCE;
  process.env.CONTENT_SOURCE = 'db';
  try {
    const dbContent = await loadContent({ root: ROOT });
    const dbCounts = count(dbContent);
    assertExpectedCounts('db adapter', dbCounts);
    await checkMissingAssetRepair();
    console.log(`DB counts     : ${JSON.stringify(dbCounts)}`);
    console.log('DB asset repair: ok');
  } finally {
    if (previousSource === undefined) delete process.env.CONTENT_SOURCE;
    else process.env.CONTENT_SOURCE = previousSource;
  }
} else {
  console.log(`DB counts     : skipped (${dbConfig.missing.join(', ')} missing)`);
}
