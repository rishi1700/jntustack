import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDbConfig } from '../lib/config.js';
import { createContentStore, loadContent } from '../lib/content-store/index.js';
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
    console.log(`DB counts     : ${JSON.stringify(dbCounts)}`);
  } finally {
    if (previousSource === undefined) delete process.env.CONTENT_SOURCE;
    else process.env.CONTENT_SOURCE = previousSource;
  }
} else {
  console.log(`DB counts     : skipped (${dbConfig.missing.join(', ')} missing)`);
}
