import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSearchIndex } from '../lib/retrieve.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const { subjects } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/cse-r23-sample.json'), 'utf-8'));
const { branch_profiles } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/branch-guide-data.json'), 'utf-8'));

const index = buildSearchIndex({ subjects, branchProfiles: branch_profiles });

const outDir = path.join(ROOT, 'dist');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'search-index.json'), JSON.stringify(index));

console.log(`Wrote search-index.json with ${index.length} grounded documents -> dist/search-index.json`);
