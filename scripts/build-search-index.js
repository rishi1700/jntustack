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
const { subjects } = content.data;
const branch_profiles = content.branchProfiles;
const { colleges } = content;

const index = buildSearchIndex({ subjects, branchProfiles: branch_profiles, colleges });

const outDir = path.join(ROOT, 'dist');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'search-index.json'), JSON.stringify(index));

console.log(`Wrote search-index.json with ${index.length} grounded documents from ${content.source} -> dist/search-index.json`);
