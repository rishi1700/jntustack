import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSearchIndex } from '../lib/retrieve.js';
import {
  isListingOnlySubject,
  isPageSubject,
  loadGuides,
  loadMergedColleges,
  loadMergedSubjects,
  subjectBranchCodes,
  subjectOfferings,
} from '../lib/dataset.js';
import { TEMPORARY_REDIRECTS } from '../lib/temporary-redirects.js';
import { LEGACY_REDIRECTS } from '../lib/legacy-redirects.js';

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
const VERIFIED_RECORD_STALE_PATTERNS = [
  /\bneeds verification\b/i,
  /\bbefore (?:flipping|marking|promoting)[^.]*\bverified\b/i,
  /\bstatus\s*:\s*(?:draft|needs_verification)\b/i,
];
// These require table/heading syntax so legitimate topics such as "reference
// models" or "textbook concepts" do not look like PDF extraction artifacts.
const VERIFIED_TOPIC_ARTIFACT_PATTERNS = [
  {
    label: 'raw semester/course boundary header',
    pattern: /\b(?:I|II|III|IV|[1-4](?:st|nd|rd|th)?)\s+Year\s*[-–—]?\s*(?:I|II|[12](?:st|nd)?)\s+Semester\b/i,
  },
  {
    label: 'raw L-T-P-C table header',
    pattern: /\bL\s*(?:[-–—|]\s*)?T\s*(?:[-–—|]\s*)?P\s*(?:[-–—|]\s*)?C\b\s*[:=-]?\s*\d+(?:\.\d+)?(?:\s+\d+(?:\.\d+)?){3}\b/i,
  },
  {
    label: 'bibliography section label',
    pattern: /\b(?:text\s*books?|reference\s*books?)\b(?:\s*:|\s+(?=\d+\s*[.)]))/i,
  },
  {
    label: 'course outcomes section label',
    pattern: /\bcourse\s+outcomes?\b(?:\s*:|\s+(?=(?:at\s+the\s+end\b|CO\s*[-:]?\s*\d+\b|\d+\s*[.)])))/i,
  },
];
const PUBLIC_BRANCH_COUNT = 6;

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

function findVerifiedTopicArtifacts(subject) {
  const failures = [];
  for (const [unitIndex, unit] of (subject.units || []).entries()) {
    for (const [topicIndex, topic] of (unit?.topics || []).entries()) {
      if (typeof topic !== 'string') continue;
      const normalizedTopic = topic.replace(/\s+/g, ' ').trim();
      const matchedLabels = VERIFIED_TOPIC_ARTIFACT_PATTERNS
        .filter(({ pattern }) => pattern.test(normalizedTopic))
        .map(({ label }) => label);
      if (!matchedLabels.length) continue;
      const unitLabel = unit?.number ?? unitIndex + 1;
      failures.push(`${subject.id} unit ${unitLabel} topic ${topicIndex + 1} contains ${matchedLabels.join(' and ')}`);
    }
  }
  return failures;
}

function parseSitemapEntries() {
  const sitemapPath = path.join(DIST, 'sitemap.xml');
  if (!fs.existsSync(sitemapPath)) return null;
  const xml = fs.readFileSync(sitemapPath, 'utf-8');
  return [...xml.matchAll(/<url>\s*<loc>(.*?)<\/loc>(?:\s*<lastmod>(.*?)<\/lastmod>)?\s*<\/url>/g)]
    .map(match => ({ url: match[1].trim(), lastmod: match[2]?.trim() || '' }));
}

function parseSitemapUrls() {
  return parseSitemapEntries()?.map(entry => entry.url) || null;
}

function parseJsonLd(html) {
  const nodes = [];
  const errors = [];
  for (const match of html.matchAll(/<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1]);
      nodes.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch (error) {
      errors.push(error.message);
    }
  }
  return { nodes, errors };
}

function visibleTextLength(value = '') {
  return [...value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')].length;
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

function auditTemporaryRedirects() {
  const failures = [];
  const sitemapSet = new Set(parseSitemapUrls() || []);
  for (const [source, target] of Object.entries(TEMPORARY_REDIRECTS)) {
    if (!source.startsWith('/') || !target.startsWith('/')) {
      failures.push(`temporary redirect must use root-relative paths: ${source} -> ${target}`);
      continue;
    }
    if (sitemapSet.has(`${SITE_URL}${source}`)) failures.push(`temporary redirect source remains in sitemap: ${source}`);
    if (fs.existsSync(distTargetForPathname(source))) failures.push(`temporary redirect source remains published in dist: ${source}`);
    const targetPath = new URL(target, SITE_URL).pathname;
    if (!fs.existsSync(distTargetForPathname(targetPath))) failures.push(`temporary redirect target is missing: ${source} -> ${target}`);
  }
  return { ok: failures.length === 0, failures, count: Object.keys(TEMPORARY_REDIRECTS).length };
}

function auditLegacyRedirects() {
  const failures = [];
  const sitemapSet = new Set(parseSitemapUrls() || []);
  const redirects = new Map(Object.entries(LEGACY_REDIRECTS));
  for (const [source, target] of redirects) {
    if (!source.startsWith('/') || !source.endsWith('/') || !target.startsWith('/')) {
      failures.push(`legacy redirect must use root-relative page paths: ${source} -> ${target}`);
      continue;
    }
    if (source === new URL(target, SITE_URL).pathname) failures.push(`legacy redirect loops to itself: ${source}`);
    if (sitemapSet.has(`${SITE_URL}${source}`)) failures.push(`legacy redirect source remains in sitemap: ${source}`);
    if (fs.existsSync(distTargetForPathname(source))) failures.push(`legacy redirect source remains published in dist: ${source}`);
    const targetPath = new URL(target, SITE_URL).pathname;
    if (!fs.existsSync(distTargetForPathname(targetPath))) failures.push(`legacy redirect target is missing: ${source} -> ${target}`);
    if (redirects.has(targetPath)) failures.push(`legacy redirect chain detected: ${source} -> ${targetPath} -> ${redirects.get(targetPath)}`);
  }
  return { ok: failures.length === 0, failures, count: redirects.size };
}

function auditIndexingReadiness() {
  const failures = [];
  const warnings = [];
  const files = htmlFiles();
  const sitemapEntries = parseSitemapEntries();
  const sitemapUrls = sitemapEntries?.map(entry => entry.url) || null;
  const sitemapSet = new Set(sitemapUrls || []);
  const sitemapByUrl = new Map((sitemapEntries || []).map(entry => [entry.url, entry]));
  const canonicalUrls = new Set();
  const documentTitles = new Map();

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
    const h1Count = [...html.matchAll(/<h1\b/gi)].length;
    const jsonLd = parseJsonLd(html);
    const requiredSocialTags = [
      /<meta\s+property=["']og:title["']/i,
      /<meta\s+property=["']og:description["']/i,
      /<meta\s+property=["']og:url["']/i,
      /<meta\s+property=["']og:image["']/i,
      /<meta\s+name=["']twitter:card["']/i,
      /<meta\s+name=["']twitter:title["']/i,
      /<meta\s+name=["']twitter:description["']/i,
      /<meta\s+name=["']twitter:image["']/i,
    ];

    if (!title) failures.push(`${rel(file)} missing <title>`);
    if (title && visibleTextLength(title) > 60) failures.push(`${rel(file)} title exceeds 60 visible characters: ${title}`);
    if (title && documentTitles.has(title)) failures.push(`${rel(file)} duplicates the title from ${documentTitles.get(title)}: ${title}`);
    else if (title) documentTitles.set(title, rel(file));
    if (!description) failures.push(`${rel(file)} missing meta description`);
    if (!canonical) failures.push(`${rel(file)} missing canonical link`);
    if (canonical && canonical !== expectedUrl) failures.push(`${rel(file)} canonical ${canonical} does not match generated URL ${expectedUrl}`);
    if (canonical) canonicalUrls.add(canonical);
    if (noindex) failures.push(`${rel(file)} contains a robots noindex meta tag`);
    if (!mainHasContent) warnings.push(`${rel(file)} main content looks thin or missing`);
    if (h1Count !== 1) failures.push(`${rel(file)} has ${h1Count} H1 elements; expected exactly one`);
    if (!html.includes('class="skip-link"') || !html.includes('href="#main-content"')) failures.push(`${rel(file)} is missing the skip link`);
    if (!/<main\s+id=["']main-content["']/i.test(html)) failures.push(`${rel(file)} is missing the main-content target`);
    if (html.includes('class="ad-slot"')) failures.push(`${rel(file)} still contains a visible ad placeholder`);
    if (/Notes for this subject haven(?:'|&#39;)t been uploaded/i.test(html)) failures.push(`${rel(file)} still contains the empty download message`);
    if (requiredSocialTags.some(pattern => !pattern.test(html))) failures.push(`${rel(file)} is missing required Open Graph/Twitter metadata`);
    if (jsonLd.errors.length) failures.push(`${rel(file)} has invalid JSON-LD: ${jsonLd.errors.join('; ')}`);
    if (publicPath !== '/' && !/<nav\s+class=["']page-breadcrumb["']\s+aria-label=["']Breadcrumb["']/i.test(html)) {
      failures.push(`${rel(file)} is missing semantic breadcrumb navigation`);
    }
    if (publicPath !== '/' && !jsonLd.nodes.some(node => node?.['@type'] === 'BreadcrumbList')) {
      failures.push(`${rel(file)} is missing BreadcrumbList JSON-LD`);
    }
  }

  if (sitemapUrls) {
    for (const url of sitemapUrls) {
      if (!url.startsWith(`${SITE_URL}/`)) failures.push(`sitemap URL is outside ${SITE_URL}: ${url}`);
      const target = distTargetForPathname(new URL(url).pathname);
      if (!fs.existsSync(target)) failures.push(`sitemap URL has no generated dist target: ${url}`);
      if (!canonicalUrls.has(url)) failures.push(`sitemap URL has no matching page canonical: ${url}`);
      const lastmod = sitemapByUrl.get(url)?.lastmod || '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(lastmod)) failures.push(`sitemap URL is missing a valid lastmod date: ${url}`);
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
  const verifiedPageSubjects = verifiedSubjects.filter(isPageSubject);
  // A shared subject (branchCodes set) counts toward every branch it lists,
  // same resolution build.js uses for hub membership and nav counts.
  const verifiedBranches = new Set(verifiedSubjects.flatMap(subjectBranchCodes));

  for (const subject of subjects) {
    const canonicalPath = canonicalSubjectPath(subject);
    const canonicalUrl = `${SITE_URL}${canonicalPath}`;
    const entityPath = `/${subject.id}/`;

    if (subject.source?.status === 'needs_verification') {
      if (sitemapSet.has(canonicalUrl)) failures.push(`needs_verification subject appears in sitemap: ${subject.id} -> ${canonicalPath}`);
      if (searchSubjectUrls.has(canonicalPath)) failures.push(`needs_verification subject appears in search index: ${subject.id} -> ${canonicalPath}`);
      if (fs.existsSync(distTargetForPathname(canonicalPath))) failures.push(`needs_verification subject was rendered to dist: ${subject.id} -> ${canonicalPath}`);
    }

    if (isListingOnlySubject(subject)) {
      if (subject.source?.status !== 'verified') failures.push(`listing-only subject is not source-verified: ${subject.id}`);
      if (sitemapSet.has(canonicalUrl)) failures.push(`listing-only subject appears in sitemap: ${subject.id}`);
      if (searchSubjectUrls.has(canonicalPath)) failures.push(`listing-only subject appears as standalone search document: ${subject.id}`);
      if (fs.existsSync(distTargetForPathname(canonicalPath))) failures.push(`listing-only subject generated a detail page: ${subject.id}`);
      continue;
    }

    if (subject.source?.status === 'verified') {
      const metaDescription = subject.seo?.meta_description || '';
      const stalePattern = DRAFT_META_PATTERNS.find(pattern => pattern.test(metaDescription));
      if (stalePattern) failures.push(`verified subject has stale draft-style meta description: ${subject.id}`);
      const recordNotes = [subject.notes, subject.source?.college_source_note].filter(Boolean).join(' ');
      const staleRecordPattern = VERIFIED_RECORD_STALE_PATTERNS.find(pattern => pattern.test(recordNotes));
      if (staleRecordPattern) failures.push(`verified subject has stale draft-style record notes: ${subject.id}`);
      failures.push(...findVerifiedTopicArtifacts(subject));

      const target = distTargetForPathname(canonicalPath);
      const html = fs.existsSync(target) ? fs.readFileSync(target, 'utf-8') : '';
      const title = html.match(/<title>(.*?)<\/title>/is)?.[1] || '';
      const codes = subjectBranchCodes(subject);
      const branchScope = codes.length === PUBLIC_BRANCH_COUNT
        ? 'All'
        : codes.length > 2
          ? `${codes.length} Branches`
          : codes.join('/');
      const semesterScope = [...new Set(subjectOfferings(subject).map(offering => offering.year_sem_label))].join('/');
      if (!title.includes('Syllabus') || !title.includes('JNTUK') || !title.includes(subject.regulation) || !title.includes(branchScope) || !title.includes(semesterScope)) {
        failures.push(`${subject.id} title is missing Syllabus/JNTUK/regulation/branch/semester targeting: ${title}`);
      }
      if (!html.includes('class="source-docket"')) failures.push(`${subject.id} is missing the source docket`);
      if (!html.includes('<time datetime=')) failures.push(`${subject.id} is missing a semantic checked date`);
      const expectedSources = [
        subject.source?.origin_url,
        ...(subject.source?.additional_sources || []).map(source => typeof source === 'string' ? source : source?.origin_url),
      ].filter(Boolean);
      for (const sourceUrl of expectedSources) {
        if (!html.includes(sourceUrl.replaceAll('&', '&amp;'))) failures.push(`${subject.id} does not render source link: ${sourceUrl}`);
      }
      const hasResources = Object.values(subject.resources || {}).some(Boolean);
      if (!hasResources && /<h2[^>]*>Downloads<\/h2>/i.test(html)) failures.push(`${subject.id} renders a download rail without resources`);
      const jsonLd = parseJsonLd(html).nodes;
      const course = jsonLd.find(node => node?.['@type'] === 'Course');
      if (!course || course.url !== canonicalUrl || course.dateModified !== subject.source.retrieved_date) {
        failures.push(`${subject.id} Course JSON-LD is missing canonical url/dateModified`);
      }
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
      const hubJsonLd = parseJsonLd(hubHtml).nodes;
      if (!hubJsonLd.some(node => node?.['@type'] === 'CollectionPage')) failures.push(`${branchPath} is missing CollectionPage JSON-LD`);
      if (!hubJsonLd.some(node => node?.['@type'] === 'ItemList')) failures.push(`${branchPath} is missing subject ItemList JSON-LD`);
      const branchSubject = verifiedPageSubjects.find(subject => subjectBranchCodes(subject).includes(branch));
      if (branchSubject) {
        const subjectPath = canonicalSubjectPath(branchSubject);
        if (!hubHtml.includes(`href="${subjectPath}"`)) failures.push(`${branchPath} does not link a verified subject page: ${subjectPath}`);
      }
    }
  }

  if (!homeHtml.includes('href="/colleges/"')) failures.push('homepage/header does not link /colleges/');
  if (!homeHtml.includes('href="/branch-guide/"')) failures.push('homepage/header does not link /branch-guide/');

  const { guides } = loadGuides(DATA);
  const searchGuideUrls = new Set(searchDocs.filter(doc => doc.type === 'guide').map(doc => doc.url));
  for (const guide of guides) {
    const guidePath = `/${guide.seo?.slug || guide.id}/`;
    const guideUrl = `${SITE_URL}${guidePath}`;
    const target = distTargetForPathname(guidePath);
    if (guide.source?.status !== 'verified') {
      if (fs.existsSync(target) || sitemapSet.has(guideUrl) || searchGuideUrls.has(guidePath)) {
        failures.push(`unverified guide reached public output: ${guide.id}`);
      }
      continue;
    }
    if (!fs.existsSync(target)) failures.push(`verified guide page is missing: ${guide.id}`);
    if (!sitemapSet.has(guideUrl)) failures.push(`verified guide is missing from sitemap: ${guide.id}`);
    if (!searchGuideUrls.has(guidePath)) failures.push(`verified guide is missing from search: ${guide.id}`);
    if (fs.existsSync(target)) {
      const html = fs.readFileSync(target, 'utf-8');
      const nodes = parseJsonLd(html).nodes;
      if (!nodes.some(node => node?.['@type'] === 'Article')) failures.push(`${guide.id} is missing Article JSON-LD`);
      for (const section of guide.sections || []) {
        if (!html.includes(`id="${section.id}"`)) failures.push(`${guide.id} is missing section anchor #${section.id}`);
      }
    }
  }

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
  const { guides } = loadGuides(DATA);
  const { branches } = JSON.parse(fs.readFileSync(path.join(DATA, 'shared.json'), 'utf-8'));
  const { branch_profiles } = JSON.parse(fs.readFileSync(path.join(DATA, 'branch-guide-data.json'), 'utf-8'));
  const expectedDocs = buildSearchIndex({ subjects, branches, branchProfiles: branch_profiles, colleges, guides });
  const actualDocs = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));

  const expectedIds = new Set(expectedDocs.map(d => `${d.type}:${d.id}`));
  const actualIds = new Set(actualDocs.map(d => `${d.type}:${d.id}`));
  const missing = [...expectedIds].filter(id => !actualIds.has(id)).sort();
  const extra = [...actualIds].filter(id => !expectedIds.has(id)).sort();
  const expected = countByType(expectedDocs);
  const actual = countByType(actualDocs);
  const requiredTypes = ['subject', 'college', 'branch_profile', 'guide'];
  const requiredTypesPresent = requiredTypes.every(type => (actual[type] || 0) > 0);

  return {
    ok: missing.length === 0 && extra.length === 0 && requiredTypesPresent,
    message: requiredTypesPresent
      ? 'search-index coverage matches verified subject pages, colleges, branch profiles, and guides.'
      : 'search-index is missing at least one required document type.',
    expected,
    actual,
    missing,
    extra,
  };
}

function auditResponsiveShell() {
  const failures = [];
  const files = htmlFiles();
  const cssPath = path.join(DIST, 'teal-brand.css');
  const navScriptPath = path.join(DIST, 'mobile-nav.js');

  if (!fs.existsSync(cssPath)) failures.push('dist/teal-brand.css is missing');
  if (!fs.existsSync(navScriptPath)) failures.push('dist/mobile-nav.js is missing');

  for (const file of files) {
    const html = fs.readFileSync(file, 'utf-8');
    if (!/<meta\s+name="viewport"\s+content="width=device-width, initial-scale=1\.0">/i.test(html)) {
      failures.push(`${rel(file)} is missing the responsive viewport meta tag`);
    }
    if (!html.includes('src="/mobile-nav.js"')) failures.push(`${rel(file)} is missing mobile-nav.js`);
    if (!html.includes('id="mobileNavToggle"')) failures.push(`${rel(file)} is missing the mobile menu control`);
    if (!html.includes('id="topNav"')) failures.push(`${rel(file)} is missing the controlled navigation target`);
  }

  if (fs.existsSync(cssPath)) {
    const css = fs.readFileSync(cssPath, 'utf-8');
    if (!/@media\s*\(max-width:900px\)/.test(css)) failures.push('mobile breakpoint is missing from teal-brand.css');
    if (!/html\.js\s+\.top-nav:not\(\[data-open="true"\]\)\s*\{display:none;\}/.test(css)) {
      failures.push('mobile navigation collapse rule is missing from teal-brand.css');
    }
    if (!css.includes('scroll-snap-type:x proximity')) failures.push('touch-scroll rail rules are missing from teal-brand.css');
  }

  return { ok: failures.length === 0, failures, pageCount: files.length };
}

function auditReleaseMarker() {
  const markerPath = path.join(DIST, 'release.json');
  if (!fs.existsSync(markerPath)) return { ok: false, failures: ['dist/release.json is missing'] };
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
    const failures = [];
    if (marker.schema_version !== 1) failures.push(`unsupported release marker schema: ${marker.schema_version}`);
    const hasRelease = marker.release_id != null;
    const hasHash = marker.artifact_hash != null;
    if (hasRelease !== hasHash) failures.push('release marker must provide release_id and artifact_hash together');
    if (hasHash && !/^[a-f0-9]{64}$/.test(String(marker.artifact_hash))) failures.push('release marker artifact_hash is not SHA-256');
    return { ok: failures.length === 0, failures, marker };
  } catch (error) {
    return { ok: false, failures: [`dist/release.json is invalid JSON: ${error.message}`] };
  }
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
const responsive = auditResponsiveShell();
const temporaryRedirects = auditTemporaryRedirects();
const legacyRedirects = auditLegacyRedirects();
const releaseMarker = auditReleaseMarker();

console.log('Site audit');
console.log('----------');
console.log(`href="#" placeholders       : ${hashHrefHits.length}`);
console.log(`Missing internal links       : ${missingInternalLinks.length}`);
console.log(`Search index expected counts : ${JSON.stringify(coverage.expected)}`);
console.log(`Search index actual counts   : ${JSON.stringify(coverage.actual)}`);
console.log(`Sitemap URLs                 : ${indexing.sitemapCount}`);
console.log(`Canonical public pages       : ${indexing.canonicalCount}`);
console.log(`Indexing warnings            : ${indexing.warnings.length}`);
console.log(`Responsive shell pages       : ${responsive.pageCount}`);
console.log(`Temporary redirect checks    : ${temporaryRedirects.count}`);
console.log(`Legacy redirect checks       : ${legacyRedirects.count}`);
console.log(`Release marker               : ${releaseMarker.marker?.artifact_hash ? 'sealed' : 'local/unsealed'}`);

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
if (!responsive.ok) failures.push(['responsive shell', responsive.failures]);
if (!temporaryRedirects.ok) failures.push(['temporary redirects', temporaryRedirects.failures]);
if (!legacyRedirects.ok) failures.push(['legacy redirects', legacyRedirects.failures]);
if (!releaseMarker.ok) failures.push(['release marker', releaseMarker.failures]);

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
