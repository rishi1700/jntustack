import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSearchIndex } from '../lib/retrieve.js';
import { loadMergedColleges, loadMergedSubjects } from '../lib/dataset.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const DATA = path.join(ROOT, 'data');
const SITE_URL = 'https://jntustack.com';
const DRAFT_META_PATTERNS = [
  /needs human verification/i,
  /before publishing/i,
  /\bdraft\b/i,
  /\bunverified\b/i,
];

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

function htmlFiles() {
  return walk(DIST, f => f.endsWith('.html'));
}

function pathForHtmlFile(file) {
  const relative = path.relative(DIST, file).replaceAll(path.sep, '/');
  if (relative === 'index.html') return '/';
  if (relative.endsWith('/index.html')) return `/${relative.slice(0, -'index.html'.length)}`;
  return `/${relative}`;
}

function canonicalSubjectPath(subject) {
  return `/${subject.seo?.slug || subject.id}/`;
}

function parseSitemapUrls() {
  const sitemapPath = path.join(DIST, 'sitemap.xml');
  if (!fs.existsSync(sitemapPath)) return null;
  const xml = fs.readFileSync(sitemapPath, 'utf-8');
  return [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1].trim());
}

function collectInternalHrefs() {
  const hrefs = new Set();
  const anchorRe = /<a\b[^>]*\bhref\s*=\s*(['"])(.*?)\1/gi;
  for (const file of htmlFiles()) {
    const html = fs.readFileSync(file, 'utf-8');
    for (const match of html.matchAll(anchorRe)) {
      const href = match[2].trim();
      if (!isInternalHref(href)) continue;
      hrefs.add(new URL(href, SITE_URL).pathname);
    }
  }
  return hrefs;
}

function findMissingInternalLinks() {
  const missing = [];
  const anchorRe = /<a\b[^>]*\bhref\s*=\s*(['"])(.*?)\1/gi;

  for (const file of htmlFiles()) {
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

function auditIndexingReadiness() {
  const failures = [];
  const warnings = [];
  const files = htmlFiles();
  const sitemapUrls = parseSitemapUrls();
  const sitemapSet = new Set(sitemapUrls || []);
  const canonicalUrls = new Set();

  if (!sitemapUrls) {
    failures.push('dist/sitemap.xml is missing. Run npm run build before auditing.');
  }

  for (const file of files) {
    const html = fs.readFileSync(file, 'utf-8');
    const publicPath = pathForHtmlFile(file);
    const expectedUrl = `${SITE_URL}${publicPath}`;
    const title = html.match(/<title>(.*?)<\/title>/is)?.[1]?.trim();
    const description = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i)?.[1]?.trim();
    const canonical = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i)?.[1]?.trim();
    const noindex = /<meta\s+[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);
    const mainHasContent = /<main\b[\s\S]*?<\/main>/i.test(html) && html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length > 300;

    if (!title) failures.push(`${rel(file)} missing <title>`);
    if (!description) failures.push(`${rel(file)} missing meta description`);
    if (!canonical) failures.push(`${rel(file)} missing canonical link`);
    if (canonical && canonical !== expectedUrl) failures.push(`${rel(file)} canonical ${canonical} does not match generated URL ${expectedUrl}`);
    if (canonical) canonicalUrls.add(canonical);
    if (noindex) failures.push(`${rel(file)} contains a robots noindex meta tag`);
    if (!mainHasContent) warnings.push(`${rel(file)} main content looks thin or missing`);
  }

  if (sitemapUrls) {
    for (const url of sitemapUrls) {
      if (!url.startsWith(`${SITE_URL}/`)) failures.push(`sitemap URL is outside ${SITE_URL}: ${url}`);
      const target = distTargetForPathname(new URL(url).pathname);
      if (!fs.existsSync(target)) failures.push(`sitemap URL has no generated dist target: ${url}`);
      if (!canonicalUrls.has(url)) failures.push(`sitemap URL has no matching page canonical: ${url}`);
    }
    for (const canonical of canonicalUrls) {
      if (!sitemapSet.has(canonical)) failures.push(`canonical URL missing from sitemap: ${canonical}`);
    }
  }

  const { subjects } = loadMergedSubjects(DATA);
  const searchIndexPath = path.join(DIST, 'search-index.json');
  const searchDocs = fs.existsSync(searchIndexPath)
    ? JSON.parse(fs.readFileSync(searchIndexPath, 'utf-8'))
    : [];
  const searchSubjectUrls = new Set(searchDocs.filter(doc => doc.type === 'subject').map(doc => doc.url));
  const internalHrefs = collectInternalHrefs();
  const homeHtml = fs.existsSync(path.join(DIST, 'index.html'))
    ? fs.readFileSync(path.join(DIST, 'index.html'), 'utf-8')
    : '';
  const branchGuideHtml = fs.existsSync(path.join(DIST, 'branch-guide/index.html'))
    ? fs.readFileSync(path.join(DIST, 'branch-guide/index.html'), 'utf-8')
    : '';

  const verifiedSubjects = subjects.filter(subject => subject.source?.status === 'verified');
  const verifiedBranches = new Set(verifiedSubjects.map(subject => subject.branch));

  for (const subject of subjects) {
    const canonicalPath = canonicalSubjectPath(subject);
    const canonicalUrl = `${SITE_URL}${canonicalPath}`;
    const entityPath = `/${subject.id}/`;

    if (subject.source?.status === 'needs_verification') {
      if (sitemapSet.has(canonicalUrl)) failures.push(`needs_verification subject appears in sitemap: ${subject.id} -> ${canonicalPath}`);
      if (searchSubjectUrls.has(canonicalPath)) failures.push(`needs_verification subject appears in search index: ${subject.id} -> ${canonicalPath}`);
      if (fs.existsSync(distTargetForPathname(canonicalPath))) failures.push(`needs_verification subject was rendered to dist: ${subject.id} -> ${canonicalPath}`);
    }

    if (subject.source?.status === 'verified') {
      const metaDescription = subject.seo?.meta_description || '';
      const stalePattern = DRAFT_META_PATTERNS.find(pattern => pattern.test(metaDescription));
      if (stalePattern) failures.push(`verified subject has stale draft-style meta description: ${subject.id}`);
    }

    if (subject.source?.status === 'verified' && subject.seo?.slug && subject.seo.slug !== subject.id) {
      if (sitemapSet.has(`${SITE_URL}${entityPath}`)) failures.push(`sitemap uses entity-key URL instead of seo.slug: ${subject.id}`);
      if (searchSubjectUrls.has(entityPath)) failures.push(`search index uses entity-key URL instead of seo.slug: ${subject.id}`);
      if (internalHrefs.has(entityPath)) failures.push(`internal link uses entity-key URL instead of seo.slug: ${subject.id}`);
    }
  }

  for (const branch of verifiedBranches) {
    const branchPath = `/${String(branch).toLowerCase()}/`;
    if (!homeHtml.includes(`href="${branchPath}"`)) failures.push(`homepage does not link verified branch hub: ${branchPath}`);
    if (!branchGuideHtml.includes(`href="${branchPath}"`)) failures.push(`branch guide does not link verified branch hub: ${branchPath}`);

    const hubPath = path.join(DIST, String(branch).toLowerCase(), 'index.html');
    if (fs.existsSync(hubPath)) {
      const hubHtml = fs.readFileSync(hubPath, 'utf-8');
      const branchSubject = verifiedSubjects.find(subject => subject.branch === branch);
      const subjectPath = canonicalSubjectPath(branchSubject);
      if (!hubHtml.includes(`href="${subjectPath}"`)) failures.push(`${branchPath} does not link a verified subject page: ${subjectPath}`);
    }
  }

  if (!homeHtml.includes('href="/colleges/"')) failures.push('homepage/header does not link /colleges/');
  if (!homeHtml.includes('href="/branch-guide/"')) failures.push('homepage/header does not link /branch-guide/');

  return {
    ok: failures.length === 0,
    failures,
    warnings,
    sitemapCount: sitemapUrls?.length || 0,
    canonicalCount: canonicalUrls.size,
  };
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
const indexing = auditIndexingReadiness();

console.log('Site audit');
console.log('----------');
console.log(`href="#" placeholders       : ${hashHrefHits.length}`);
console.log(`Missing internal links       : ${missingInternalLinks.length}`);
console.log(`Search index expected counts : ${JSON.stringify(coverage.expected)}`);
console.log(`Search index actual counts   : ${JSON.stringify(coverage.actual)}`);
console.log(`Sitemap URLs                 : ${indexing.sitemapCount}`);
console.log(`Canonical public pages       : ${indexing.canonicalCount}`);
console.log(`Indexing warnings            : ${indexing.warnings.length}`);

const failures = [];
if (hashHrefHits.length) failures.push(['href="#" placeholders', hashHrefHits]);
if (missingInternalLinks.length) failures.push(['missing internal links', missingInternalLinks]);
if (!coverage.ok) {
  const details = [coverage.message];
  if (coverage.missing?.length) details.push(`Missing index docs: ${coverage.missing.join(', ')}`);
  if (coverage.extra?.length) details.push(`Extra index docs: ${coverage.extra.join(', ')}`);
  failures.push(['search-index coverage', details]);
}
if (!indexing.ok) failures.push(['indexing readiness', indexing.failures]);

if (failures.length) {
  for (const [label, items] of failures) {
    console.error(`\n${label}:`);
    for (const item of items) console.error(`  - ${item}`);
  }
  process.exitCode = 1;
} else {
  if (indexing.warnings.length) {
    console.warn('\nindexing warnings:');
    for (const item of indexing.warnings) console.warn(`  - ${item}`);
  }
  console.log('Audit passed.');
}
