import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadMergedSubjects, loadMergedColleges } from '../lib/dataset.js';
import { buildSearchIndex, retrieve } from '../lib/retrieve.js';

// Self-test against the real datasets in this project. Moved out of
// lib/retrieve.js so that module stays free of Node imports and can be loaded
// directly in the browser. Behaviour is identical to the old inline self-test.
// Run with: npm run test:retrieve
const dataDir = fileURLToPath(new URL('../data', import.meta.url));
const { subjects } = loadMergedSubjects(dataDir);
const { branch_profiles } = JSON.parse(fs.readFileSync(new URL('../data/branch-guide-data.json', import.meta.url), 'utf-8'));
const { colleges } = loadMergedColleges(dataDir);

const index = buildSearchIndex({ subjects, branchProfiles: branch_profiles, colleges });
console.log(`Indexed ${index.length} verified documents (unverified content excluded from grounding).`);

const testQueries = [
  'what is K-means clustering used for',
  'should I choose ECE or EEE',
  'computer networks unit topics',
  'engineering colleges in Krishna district',
  'JNTUK constituent college Kakinada',
];
for (const q of testQueries) {
  const hits = retrieve(index, q);
  console.log(`\nQuery: "${q}"`);
  hits.forEach(h => console.log(`  -> [${h.type}] ${h.title}`));
  if (hits.length === 0) console.log('  -> no grounded match (assistant should say so, not guess)');
}
