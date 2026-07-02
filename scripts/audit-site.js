import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSearchIndex } from '../lib/retrieve.js';
import { loadMergedColleges, loadMergedSubjects } from '../lib/dataset.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const DATA = path.join(ROOT, 'data');

function walk(dir, predicate = () => true) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, predicate));
    else if (predicate(full)) out.push(full);
  }
  return out;
}

function rel(file) {
  return path.relative(ROOT, file);
}

function lineCol(text, index) {
  const before = text.slice(0, index);
  const lines = before.split('\n');
  return { line: lines.length, col: lines[lines.length - 1].length + 1 };
}

function findHashHref(files) {
  const hits = [];
  const re = /href\s*=\s*(['"])#\1/g;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf-8');
    for (const match of text.matchAll(re)) {
      const pos = lineCol(text, match.index);
      hits.push(`${rel(file)}:${pos.line}:${pos.col}`);
    }
  }
  return hits;
}

function distTargetForPathname(pathname) {
  const clean = decodeURIComponent(pathname).replace(/^\/+/, '');
  if (!clean) return path.join(DIST, 'index.html');
  if (pathname.endsWith('/')) return path.join(DIST, clean, 'index.html');
  if (path.extname(clean)) return path.join(DIST, clean);
  return path.join(DIST, clean, 'index.html');
}

function isInternalHref(href) {
  return href.startsWith('/') && !href.startsWith('//');
}

function findMissingInternalLinks() {
  const htmlFiles = walk(DIST, f => f.endsWith('.html'));
  const missing = [];
  const anchorRe = /<a\b[^>]*\bhref\s*=\s*(['"])(.*?)\1/gi;

  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, 'utf-8');
    for (const match of html.matchAll(anchorRe)) {
      const href = match[2].trim();
      if (!isInternalHref(href)) continue;

      const url = new URL(href, 'https://jntustack.com');
      const target = distTargetForPathname(url.pathname);
      if (!fs.existsSync(target)) {
        const pos = lineCol(html, match.index);
        missing.push(`${rel(file)}:${pos.line}:${pos.col} -> ${href}`);
      }
    }
  }

  const indexPath = path.join(DIST, 'search-index.json');
  if (fs.existsSync(indexPath)) {
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    for (const doc of index) {
      if (!doc?.url || !isInternalHref(doc.url)) continue;
      const url = new URL(doc.url, 'https://jntustack.com');
      const target = distTargetForPathname(url.pathname);
      if (!fs.existsSync(target)) {
        missing.push(`dist/search-index.json -> ${doc.type}:${doc.id} -> ${doc.url}`);
      }
    }
  }

  return missing;
}

function countByType(docs) {
  return docs.reduce((acc, doc) => {
    acc[doc.type] = (acc[doc.type] || 0) + 1;
    return acc;
  }, {});
}

function auditSearchCoverage() {
  const indexPath = path.join(DIST, 'search-index.json');
  if (!fs.existsSync(indexPath)) {
    return {
      ok: false,
      message: 'dist/search-index.json is missing. Run npm run build before auditing.',
      actual: {},
      expected: {},
    };
  }

  const { subjects } = loadMergedSubjects(DATA);
  const { colleges } = loadMergedColleges(DATA);
  const { branch_profiles } = JSON.parse(fs.readFileSync(path.join(DATA, 'branch-guide-data.json'), 'utf-8'));
  const expectedDocs = buildSearchIndex({ subjects, branchProfiles: branch_profiles, colleges });
  const actualDocs = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));

  const expectedIds = new Set(expectedDocs.map(d => `${d.type}:${d.id}`));
  const actualIds = new Set(actualDocs.map(d => `${d.type}:${d.id}`));
  const missing = [...expectedIds].filter(id => !actualIds.has(id)).sort();
  const extra = [...actualIds].filter(id => !expectedIds.has(id)).sort();
  const expected = countByType(expectedDocs);
  const actual = countByType(actualDocs);
  const requiredTypes = ['subject', 'college', 'branch_profile'];
  const requiredTypesPresent = requiredTypes.every(type => (actual[type] || 0) > 0);

  return {
    ok: missing.length === 0 && extra.length === 0 && requiredTypesPresent,
    message: requiredTypesPresent
      ? 'search-index coverage matches merged verified subjects, colleges, and branch profiles.'
      : 'search-index is missing at least one required document type.',
    expected,
    actual,
    missing,
    extra,
  };
}

const sourceFiles = [
  ...walk(path.join(ROOT, 'templates'), f => /\.(js|html|css)$/.test(f)),
  ...walk(path.join(ROOT, 'public'), f => /\.(js|html|css)$/.test(f)),
  ...walk(DIST, f => /\.(js|html|css)$/.test(f)),
];

const hashHrefHits = findHashHref(sourceFiles);
const missingInternalLinks = findMissingInternalLinks();
const coverage = auditSearchCoverage();

console.log('Site audit');
console.log('----------');
console.log(`href="#" placeholders       : ${hashHrefHits.length}`);
console.log(`Missing internal links       : ${missingInternalLinks.length}`);
console.log(`Search index expected counts : ${JSON.stringify(coverage.expected)}`);
console.log(`Search index actual counts   : ${JSON.stringify(coverage.actual)}`);

const failures = [];
if (hashHrefHits.length) failures.push(['href="#" placeholders', hashHrefHits]);
if (missingInternalLinks.length) failures.push(['missing internal links', missingInternalLinks]);
if (!coverage.ok) {
  const details = [coverage.message];
  if (coverage.missing?.length) details.push(`Missing index docs: ${coverage.missing.join(', ')}`);
  if (coverage.extra?.length) details.push(`Extra index docs: ${coverage.extra.join(', ')}`);
  failures.push(['search-index coverage', details]);
}

if (failures.length) {
  for (const [label, items] of failures) {
    console.error(`\n${label}:`);
    for (const item of items) console.error(`  - ${item}`);
  }
  process.exitCode = 1;
} else {
  console.log('Audit passed.');
}
