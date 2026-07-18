import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSearchIndex } from '../lib/retrieve.js';
import { loadContent } from '../lib/content-store/index.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Same glob-based discovery as build.js -- subjects come from every
// data/subjects-*.json file, never a hardcoded filename, so the search index
// stays in sync the moment a new branch file is dropped in.
const content = await loadContent({ root: ROOT });
const { subjects, branches = [] } = content.data;
const branch_profiles = content.branchProfiles;
const { colleges } = content;
const guides = content.guides || content.data.guides || [];

const index = buildSearchIndex({
  subjects,
  branches,
  branchProfiles: branch_profiles,
  colleges,
  guides,
});

const outDir = path.join(ROOT, 'dist');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'search-index.json'), JSON.stringify(index));

const counts = index.reduce((result, doc) => {
  result[doc.type] = (result[doc.type] || 0) + 1;
  return result;
}, {});
console.log(`Wrote search-index.json with ${index.length} grounded documents from ${content.source} (${Object.entries(counts).map(([type, count]) => `${type}: ${count}`).join(', ')}) -> dist/search-index.json`);
