import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateData } from '../lib/validate.js';
import { loadDataset, loadMergedColleges } from '../lib/dataset.js';
import { layout } from '../templates/layout.js';
import { renderSubjectPage } from '../templates/subject-page.js';
import { renderBranchGuidePage } from '../templates/branch-guide.js';
import { renderBranchHubPage } from '../templates/branch-hub.js';
import { renderCollegeDirectoryPage } from '../templates/college-directory.js';
import { renderHomePage } from '../templates/home.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE_URL = 'https://jntustack.com';

// Dataset assembly: data/shared.json holds regulations + ALL branches; each
// data/subjects-<code>.json contributes its own subjects array. A new branch's
// syllabus is added by DROPPING IN a data/subjects-<code>.json file -- loadDataset
// globs them, so no filename is hardcoded here. The merged object is then
// validated against schema.json exactly as the single file was.
const dataDir = path.join(ROOT, 'data');
const { files: subjectFiles, data: mergedData } = loadDataset(dataDir);
const data = validateData(path.join(dataDir, 'schema.json'), mergedData);
console.log('Schema validation passed.');
console.log(`Merged ${subjectFiles.length} subject file(s): ${subjectFiles.join(', ')}`);

const branchByCode = Object.fromEntries(data.branches.map(b => [b.code, b]));
const regulationByCode = Object.fromEntries(data.regulations.map(r => [r.code, r]));
const subjectById = Object.fromEntries(data.subjects.map(s => [s.id, s]));

// Verified subjects are the only ones that get published pages, so they're also
// the only ones that count toward whether a branch hub is worth generating.
const verifiedSubjects = data.subjects.filter(s => s.source.status === 'verified');
const publishedBranchCodes = new Set(verifiedSubjects.map(s => s.branch));

// Single source of truth for the nav + homepage branch grid: ALL six branches,
// each annotated with whether its hub is published (has >=1 verified subject)
// and its verified-subject count. Computed up-front because EVERY page's nav
// needs it, and subject + branch-guide pages render before the hub loop below.
// Unpublished branches carry href:null and no count claim -- the templates render
// them as disabled (never a link), so a branch can be listed without a dead URL.
// The moment a branch gains a verified subject it flips to published automatically.
const verifiedCountByBranch = {};
for (const s of verifiedSubjects) {
  verifiedCountByBranch[s.branch] = (verifiedCountByBranch[s.branch] || 0) + 1;
}
const navBranches = data.branches.map(b => {
  const verifiedCount = verifiedCountByBranch[b.code] || 0;
  const published = verifiedCount > 0;
  return {
    code: b.code,
    name: b.name,
    published,
    verifiedCount,
    href: published ? `/${b.code.toLowerCase()}/` : null,
  };
});

const distDir = path.join(ROOT, 'dist');
const draftsDir = path.join(ROOT, 'drafts');
fs.rmSync(distDir, { recursive: true, force: true });
fs.rmSync(draftsDir, { recursive: true, force: true });

function courseJsonLd(subject, branch, regulation) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Course',
    name: subject.name,
    description: subject.seo.meta_description,
    provider: { '@type': 'Organization', name: 'JNTUStack', sameAs: SITE_URL },
    courseCode: subject.subject_code || undefined,
    educationalLevel: `${branch?.name || subject.branch} - ${subject.year_sem_label}`,
    inLanguage: 'en',
  };
}

let published = 0, drafted = 0, skipped = 0;
const sitemapUrls = [];

for (const subject of data.subjects) {
  const branch = branchByCode[subject.branch];
  const regulation = regulationByCode[subject.regulation];
  const legacySubject = subject.legacy_equivalent_id ? subjectById[subject.legacy_equivalent_id] : null;
  const slug = subject.seo.slug || subject.id;

  const html = layout({
    title: subject.seo.title || subject.name,
    description: subject.seo.meta_description || '',
    canonical: `${SITE_URL}/${slug}/`,
    jsonLd: courseJsonLd(subject, branch, regulation),
    bodyHtml: renderSubjectPage(subject, { branch, regulation, legacySubject, branchHubPublished: publishedBranchCodes.has(subject.branch) }),
    navBranches,
    stamp: subject.source.status,
  });

  if (subject.source.status === 'verified') {
    const outDir = path.join(distDir, slug);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), html);
    sitemapUrls.push(`${SITE_URL}/${slug}/`);
    published++;
  } else if (subject.source.status === 'needs_verification') {
    const outDir = path.join(draftsDir, subject.id);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), html);
    drafted++;
  } else {
    skipped++; // placeholder -- not even rendered to drafts
  }
}

fs.mkdirSync(distDir, { recursive: true });

// Ship the matching module to the browser: the in-page search box imports this
// exact file (/retrieve.js) so its ranking can never drift from the build-time
// search index, which is generated from the same module. lib/retrieve.js is
// pure, Node-import-free ESM specifically so it loads unchanged in the browser.
fs.copyFileSync(path.join(ROOT, 'lib/retrieve.js'), path.join(distDir, 'retrieve.js'));

// Copy every static asset in public/ (favicon.ico, icon PNGs, logo SVGs) into
// dist/ on EVERY build. dist/ is wiped and regenerated each run (see rmSync
// above), so this MUST live in the build -- a one-time manual copy would work
// once and then silently vanish on the next deploy.
const publicDir = path.join(ROOT, 'public');
if (fs.existsSync(publicDir)) {
  fs.cpSync(publicDir, distDir, { recursive: true });
}

// Branch guide: a separate dataset (not regulation-bound), same verified-only discipline.
let branchGuidePublished = 0;
const branchGuidePath = path.join(ROOT, 'data/branch-guide-data.json');
if (fs.existsSync(branchGuidePath)) {
  const { branch_profiles } = JSON.parse(fs.readFileSync(branchGuidePath, 'utf-8'));
  const verifiedProfiles = branch_profiles.filter(b => b.source.status === 'verified');
  if (verifiedProfiles.length === branch_profiles.length && verifiedProfiles.length > 0) {
    const html = layout({
      title: 'Choosing a Branch? CSE vs ECE vs EEE vs Civil vs Mechanical vs IT - JNTUStack',
      description: 'An honest, no-fabricated-stats guide to picking an engineering branch -- core focus, real fit signals, and an optional 5-question narrowing quiz.',
      canonical: `${SITE_URL}/branch-guide/`,
      jsonLd: null,
      bodyHtml: renderBranchGuidePage(verifiedProfiles, navBranches),
      navBranches,
      stamp: 'verified',
    });
    const outDir = path.join(distDir, 'branch-guide');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), html);
    branchGuidePublished = verifiedProfiles.length;
    sitemapUrls.push(`${SITE_URL}/branch-guide/`);
  } else {
    console.warn(`Branch guide skipped: ${branch_profiles.length - verifiedProfiles.length} profile(s) not yet verified.`);
  }
}

// College directory: JNTUK colleges, a separate dataset, same verified-only
// discipline as the branch guide -- the page is generated only if every record
// is verified, so an unverified college can never reach dist/.
let collegesPublished = 0;
// Merged across every data/colleges-*.json -- drop in a new campus file and it
// auto-loads, same glob convention as subjects-*.json (see lib/dataset.js).
const { colleges: allColleges, coverageNotes } = loadMergedColleges(dataDir);
if (allColleges.length > 0) {
  const verifiedColleges = allColleges.filter(c => c.source.status === 'verified');
  if (verifiedColleges.length === allColleges.length && verifiedColleges.length > 0) {
    const html = layout({
      title: 'JNTUK & JNTU-GV College Directory - Engineering Colleges - JNTUStack',
      description: 'A directory of JNTUK and JNTU-GV constituent, autonomous and affiliated engineering colleges, grouped by university and filterable by district.',
      canonical: `${SITE_URL}/colleges/`,
      jsonLd: null,
      bodyHtml: renderCollegeDirectoryPage(verifiedColleges, coverageNotes),
      navBranches,
      stamp: 'verified',
    });
    const outDir = path.join(distDir, 'colleges');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), html);
    collegesPublished = verifiedColleges.length;
    sitemapUrls.push(`${SITE_URL}/colleges/`);
  } else {
    console.warn(`College directory skipped: ${allColleges.length - verifiedColleges.length} record(s) not yet verified.`);
  }
}

// Branch hubs: one page per branch, gated on the same verified-only discipline.
// A hub is generated ONLY if the branch has at least one verified (published)
// subject -- an empty hub is worse than no page, so a branch with zero verified
// subjects is skipped entirely and its /<code>/ URL simply 404s.
let branchHubsPublished = 0;
let branchHubsSkipped = 0;
for (const branch of data.branches) {
  const branchVerified = verifiedSubjects.filter(s => s.branch === branch.code);
  if (branchVerified.length === 0) {
    branchHubsSkipped++;
    continue;
  }
  const code = branch.code.toLowerCase();
  const html = layout({
    title: `${branch.name} (${branch.code}) Notes & Materials - JNTUK - JNTUStack`,
    description: `Verified JNTUK ${branch.code} subject notes and previous question papers, grouped by year and semester.`,
    canonical: `${SITE_URL}/${code}/`,
    jsonLd: null,
    bodyHtml: renderBranchHubPage(branch, branchVerified),
    navBranches,
    stamp: 'verified',
  });
  const outDir = path.join(distDir, code);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  sitemapUrls.push(`${SITE_URL}/${code}/`);
  branchHubsPublished++;
}

// Homepage -- the most basic requirement of a live site, generated last so
// it can honestly reflect what actually got published above.
const homeHtml = layout({
  title: 'JNTUStack - JNTU Materials, Branch Guide & College Directory',
  description: 'A clean, fast, verified resource for JNTU Kakinada, Hyderabad, Anantapur, and GV students.',
  canonical: `${SITE_URL}/`,
  jsonLd: null,
  bodyHtml: renderHomePage({ branches: navBranches }),
  navBranches,
  stamp: null,
});
fs.writeFileSync(path.join(distDir, 'index.html'), homeHtml);
sitemapUrls.unshift(`${SITE_URL}/`);

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map(u => `  <url><loc>${u}</loc></url>`).join('\n')}
</urlset>
`;
fs.writeFileSync(path.join(distDir, 'sitemap.xml'), sitemap);

console.log('');
console.log('Build summary');
console.log('-------------');
console.log(`Published (verified)         : ${published}  -> dist/   (these are deployable)`);
console.log(`Drafted (needs_verification) : ${drafted}  -> drafts/ (watermarked preview, NOT deployed)`);
console.log(`Skipped (placeholder)        : ${skipped}  -> not rendered at all`);
console.log(`Sitemap entries               : ${sitemapUrls.length}`);
console.log(`Branch guide                  : ${branchGuidePublished > 0 ? `published (${branchGuidePublished} branches)` : 'not published'}`);
console.log(`College directory             : ${collegesPublished > 0 ? `published (${collegesPublished} colleges)` : 'not published'}`);
console.log(`Branch hubs                   : ${branchHubsPublished} published, ${branchHubsSkipped} skipped (no verified subjects)`);
