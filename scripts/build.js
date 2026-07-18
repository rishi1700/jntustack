import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateData } from '../lib/validate.js';
import { loadContent } from '../lib/content-store/index.js';
import {
  isListingOnlySubject,
  isPageSubject,
  subjectBranchCodes,
  subjectOfferings,
} from '../lib/dataset.js';
import { layout } from '../templates/layout.js';
import { renderSubjectPage } from '../templates/subject-page.js';
import { renderBranchGuidePage } from '../templates/branch-guide.js';
import { renderBranchHubPage } from '../templates/branch-hub.js';
import { renderCollegeDirectoryPage, collegeDirectoryUniversitySummary, campusesFromData } from '../templates/college-directory.js';
import { renderHomePage } from '../templates/home.js';
import { renderGuidePage } from '../templates/guide-page.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE_URL = 'https://jntustack.com';

// Dataset assembly: data/shared.json holds regulations + ALL branches; each
// data/subjects-<code>.json contributes its own subjects array. A new branch's
// syllabus is added by DROPPING IN a data/subjects-<code>.json file -- loadDataset
// globs them, so no filename is hardcoded here. The merged object is then
// validated against schema.json exactly as the single file was.
const dataDir = path.join(ROOT, 'data');
const content = await loadContent({ root: ROOT });
const data = validateData(path.join(dataDir, 'schema.json'), content.data);
console.log('Schema validation passed.');
console.log(`Content source: ${content.source}`);
console.log(`Merged ${content.subjectFiles.length} subject file(s): ${content.subjectFiles.join(', ')}`);

const branchByCode = Object.fromEntries(data.branches.map(b => [b.code, b]));
const regulationByCode = Object.fromEntries(data.regulations.map(r => [r.code, r]));
const subjectById = Object.fromEntries(data.subjects.map(s => [s.id, s]));

// Verified subjects are the only ones that get published pages, so they're also
// the only ones that count toward whether a branch hub is worth generating.
// A shared subject (branchCodes set) counts toward every branch it lists --
// subjectBranchCodes() resolves branch/branchCodes into one array either way.
const verifiedSubjects = data.subjects.filter(s => s.source.status === 'verified');
const verifiedPageSubjects = verifiedSubjects.filter(isPageSubject);
const verifiedListingSubjects = verifiedSubjects.filter(isListingOnlySubject);
const publishedBranchCodes = new Set(verifiedSubjects.flatMap(subjectBranchCodes));

// Single source of truth for the nav + homepage branch grid: ALL six branches,
// each annotated with whether its hub is published (has >=1 verified subject)
// and its verified-subject count. Computed up-front because EVERY page's nav
// needs it, and subject + branch-guide pages render before the hub loop below.
// Unpublished branches carry href:null and no count claim -- the templates render
// them as disabled (never a link), so a branch can be listed without a dead URL.
// The moment a branch gains a verified subject it flips to published automatically.
const verifiedCountByBranch = {};
const listingCountByBranch = {};
for (const s of verifiedSubjects) {
  for (const code of subjectBranchCodes(s)) {
    const target = isPageSubject(s) ? verifiedCountByBranch : listingCountByBranch;
    target[code] = (target[code] || 0) + 1;
  }
}
const navBranches = data.branches.map(b => {
  const verifiedCount = verifiedCountByBranch[b.code] || 0;
  const listingCount = listingCountByBranch[b.code] || 0;
  const published = verifiedCount + listingCount > 0;
  return {
    code: b.code,
    name: b.name,
    published,
    verifiedCount,
    listingCount,
    href: published ? `/${b.code.toLowerCase()}/` : null,
  };
});

const distDir = path.join(ROOT, 'dist');
const draftsDir = path.join(ROOT, 'drafts');
fs.rmSync(distDir, { recursive: true, force: true });
fs.rmSync(draftsDir, { recursive: true, force: true });

function latestRetrievedDate(records = []) {
  return records
    .map(record => record?.source?.retrieved_date)
    .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value || ''))
    .sort()
    .at(-1);
}

function breadcrumbJsonLd(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

function compactSubjectTitleBase(subject) {
  const raw = subject.seo?.title || subject.name;
  const suffixes = [
    /\s*-\s*(?:JNTUK\s+)?R\d+\s+(?:(?:CSE|IT|ECE|EEE|CE|MECH)(?:\/(?:CSE|IT|ECE|EEE|CE|MECH))?\s+)?\d-\d(?:\s+lecture notes)?$/i,
    /\s*-\s*(?:CSE|IT|ECE|EEE|CE|MECH)(?:\/(?:CSE|IT|ECE|EEE|CE|MECH))?\s+\d-\d$/i,
    /\s*-\s*(?:JNTUK\s+)?R\d+\s+\d-\d$/i,
    /\s*-\s*(?:JNTUK\s+)?R\d+$/i,
    /\s*-\s*\d-\d$/i,
  ];
  let base = raw;
  const separatorIndex = raw.lastIndexOf(' - ');
  const semesterLabels = subjectOfferings(subject).map(offering => offering.year_sem_label);
  if (separatorIndex > 0 && semesterLabels.some(label => raw.slice(separatorIndex + 3).includes(label))) {
    base = raw.slice(0, separatorIndex);
  }
  for (const pattern of suffixes) base = base.replace(pattern, '');
  base = base.replace(/\s+Notes$/i, '');

  const replacements = [
    [/Universal Human Values\s*[-\u2013]\s*Understanding Harmony and Ethical Human Conduct/gi, 'Universal Human Values'],
    [/Mechanics of Solids (?:and|&) Materials Science/gi, 'Solid Mechanics & Materials'],
    [/Fluid Mechanics (?:and|&) Hydraulic Machines/gi, 'Fluid & Hydraulic Machines'],
    [/NSS\/NCC\/Scouts (?:and|&) Guides\/Community Service/gi, 'NSS/NCC Community Service'],
    [/Numerical Techniques (?:and|&) Statistical Methods/gi, 'Numerical & Statistical Methods'],
    [/Numerical Methods (?:and|&) Transform Techniques/gi, 'Numerical & Transform Methods'],
    [/Computer Organization (?:and|&) Architecture/gi, 'Computer Org & Architecture'],
    [/Differential Equations (?:and|&) Vector Calculus/gi, 'Diff Equations & Vector Calculus'],
    [/Conventional (?:and|&) Futuristic Vehicle Technology/gi, 'Vehicle Technology'],
    [/Electrical (?:and|&) Electronics Engineering/gi, 'Electrical/Electronics'],
    [/Battery Management Systems (?:and|&) Charging Stations/gi, 'Battery Mgmt & Charging'],
    [/Managerial Economics (?:and|&) Financial Analysis/gi, 'MEFA'],
    [/Artificial Intelligence (?:and|&) Machine Learning/gi, 'AI & ML'],
    [/Augmented Reality (?:and|&) Virtual Reality/gi, 'AR & VR'],
    [/Human Resources (?:and|&) Project Management/gi, 'HR & Project Mgmt'],
    [/Geographical Information Systems/gi, 'GIS'],
    [/Object Oriented Programming/gi, 'OOP'],
    [/Electromagnetic/gi, 'EM'],
    [/\bLaboratory\b/gi, 'Lab'],
    [/\bEngineering\b/gi, 'Engg'],
    [/\bManagement\b/gi, 'Mgmt'],
    [/\bTechnology\b/gi, 'Tech'],
    [/\bIntroduction\b/gi, 'Intro'],
    [/\bCommunications\b/gi, 'Comms'],
    [/\bCommunication\b/gi, 'Comm'],
    [/\bInstrumentation\b/gi, 'Instrum'],
    [/\bMeasurements\b/gi, 'Meas'],
    [/\bApplications\b/gi, 'Apps'],
    [/\bStatistics\b/gi, 'Stats'],
    [/\band\b/gi, '&'],
  ];
  for (const [pattern, replacement] of replacements) base = base.replace(pattern, replacement);
  return base.replace(/\s+/g, ' ').trim();
}

function clipTitleBase(base, maxLength) {
  if ([...base].length <= maxLength) return base;

  // Keep a trailing Lab qualifier when shortening a long course name; it is
  // meaningful search intent and distinguishes theory from practical pages.
  const qualifier = /\sLab$/i.test(base) ? ' Lab' : '';
  const headSource = qualifier ? base.slice(0, -qualifier.length) : base;
  const headBudget = Math.max(8, maxLength - qualifier.length - 1);
  let head = [...headSource].slice(0, headBudget).join('').trimEnd();
  const boundary = head.lastIndexOf(' ');
  if (boundary >= Math.floor(headBudget * 0.65)) head = head.slice(0, boundary);
  head = head.replace(/[\s,:;&/\u2013\u2014-]+$/g, '');
  return `${head}\u2026${qualifier}`;
}

function subjectDocumentTitle(subject, branches) {
  const codes = branches.map(branch => branch?.code).filter(Boolean);
  const branchScope = codes.length === data.branches.length
    ? 'All'
    : codes.length > 2
      ? `${codes.length} Branches`
      : codes.join('/');
  const semesterScope = [...new Set(subjectOfferings(subject).map(offering => offering.year_sem_label))].join('/');
  const suffix = ` Syllabus | JNTUK ${subject.regulation} ${branchScope} ${semesterScope}`;
  const offeringQualifier = subject.category === 'OpenElective' ? ' OE' : '';
  const compactBase = compactSubjectTitleBase(subject)
    .replace(/\s*(?:\(Open Elective\)|Open Elective|OE)$/i, '')
    .trim();
  const titleBase = clipTitleBase(compactBase, 60 - [...suffix].length - [...offeringQualifier].length);
  return `${titleBase}${offeringQualifier}${suffix}`;
}

function courseJsonLd(subject, branches, canonical) {
  // No `provider` is claimed: JNTUStack is an independent resource that
  // describes these courses, not the institution that offers/teaches them, and
  // the site is explicitly not affiliated with JNTU. `publisher` accurately
  // credits JNTUStack for the page itself without implying it provides the course.
  // `branches` is always an array (length 1 for an ordinary per-branch subject,
  // 2+ for a shared subject rendered at one branch-neutral URL) so this reads
  // the same either way instead of special-casing the shared case.
  const offerings = subjectOfferings(subject);
  const levelLabel = offerings.map(offering => {
    const names = offering.branchCodes.map(code => branchByCode[code]?.name || code).join(', ');
    return `${names} - ${offering.year_sem_label}`;
  }).join('; ');
  const citations = [
    subject.source.origin_url,
    ...(subject.source.additional_sources || []).map(source => typeof source === 'string' ? source : source?.origin_url),
  ].filter(Boolean);
  const course = {
    '@context': 'https://schema.org',
    '@type': 'Course',
    '@id': `${canonical}#course`,
    name: subject.name,
    description: subject.seo.meta_description,
    url: canonical,
    mainEntityOfPage: canonical,
    dateModified: subject.source.retrieved_date || undefined,
    citation: citations.length === 1 ? citations[0] : citations,
    publisher: { '@id': `${SITE_URL}/#organization` },
    courseCode: subject.subject_code || undefined,
    educationalLevel: levelLabel,
    inLanguage: 'en',
  };
  const breadcrumbItems = [{ name: 'Home', url: `${SITE_URL}/` }];
  if (branches.length === 1 && publishedBranchCodes.has(branches[0]?.code)) {
    breadcrumbItems.push({ name: `${branches[0].code} subjects`, url: `${SITE_URL}/${branches[0].code.toLowerCase()}/` });
  }
  breadcrumbItems.push({ name: subject.name, url: canonical });
  return [course, breadcrumbJsonLd(breadcrumbItems)];
}

// Homepage structured data: Organization + WebSite. No SearchAction is emitted
// because the site search is client-side and has no server-rendered results URL
// -- claiming one would be a structured-data overclaim.
function homeJsonLd() {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: 'JNTUStack',
      url: `${SITE_URL}/`,
      logo: `${SITE_URL}/icon-512.png`,
      description: 'Independent, verified study-resource directory for the four JNTU universities in Andhra Pradesh and Telangana.',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      name: 'JNTUStack',
      url: `${SITE_URL}/`,
      publisher: { '@id': `${SITE_URL}/#organization` },
    },
  ];
}

function collectionPageJsonLd({ name, description, canonical, dateModified, items = [] }) {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      '@id': `${canonical}#page`,
      name,
      description,
      url: canonical,
      inLanguage: 'en',
      dateModified,
      isPartOf: { '@id': `${SITE_URL}/#website` },
      mainEntity: items.length ? { '@id': `${canonical}#items` } : undefined,
    },
    ...(items.length ? [{
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      '@id': `${canonical}#items`,
      name,
      numberOfItems: items.length,
      itemListElement: items.map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: item.name,
        url: item.url,
      })),
    }] : []),
    breadcrumbJsonLd([
      { name: 'Home', url: `${SITE_URL}/` },
      { name, url: canonical },
    ]),
  ];
}

// /colleges/ ItemList: the directory's actual content as a structured list.
function collegesJsonLd(colleges, canonical, dateModified) {
  const name = 'JNTU engineering college directory';
  return [{
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': `${canonical}#page`,
    name,
    url: canonical,
    dateModified,
    inLanguage: 'en',
    isPartOf: { '@id': `${SITE_URL}/#website` },
    mainEntity: { '@id': `${canonical}#colleges` },
  }, {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    '@id': `${canonical}#colleges`,
    name: 'JNTU-affiliated engineering colleges',
    numberOfItems: colleges.length,
    itemListElement: colleges.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'CollegeOrUniversity',
        '@id': c.official_website || `${canonical}#college-${i + 1}`,
        name: c.name,
        ...(c.official_website ? { url: c.official_website } : {}),
        ...(c.location?.city || c.location?.district ? {
          address: {
            '@type': 'PostalAddress',
            ...(c.location.city ? { addressLocality: c.location.city } : {}),
            ...(c.location.district ? { addressRegion: c.location.district } : {}),
            addressCountry: 'IN',
          },
        } : {}),
      },
    })),
  }, breadcrumbJsonLd([
    { name: 'Home', url: `${SITE_URL}/` },
    { name: 'College directory', url: canonical },
  ])];
}

function guideJsonLd(guide, canonical) {
  return [{
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': `${canonical}#article`,
    headline: guide.name,
    description: guide.seo.meta_description,
    url: canonical,
    mainEntityOfPage: canonical,
    dateModified: guide.source.retrieved_date,
    citation: guide.source.origin_url || undefined,
    publisher: { '@id': `${SITE_URL}/#organization` },
    inLanguage: 'en',
  }, breadcrumbJsonLd([
    { name: 'Home', url: `${SITE_URL}/` },
    { name: guide.name, url: canonical },
  ])];
}

let published = 0, listed = 0, drafted = 0, skipped = 0;
const sitemapEntries = [];

for (const subject of data.subjects) {
  if (isListingOnlySubject(subject)) {
    if (subject.source.status === 'verified') listed++;
    else skipped++;
    continue;
  }
  const branches = subjectBranchCodes(subject).map(code => branchByCode[code]);
  const regulation = regulationByCode[subject.regulation];
  const legacySubject = subject.legacy_equivalent_id ? subjectById[subject.legacy_equivalent_id] : null;
  const slug = subject.seo.slug || subject.id;
  const canonical = `${SITE_URL}/${slug}/`;

  const html = layout({
    title: subjectDocumentTitle(subject, branches),
    description: subject.seo.meta_description || '',
    canonical,
    jsonLd: courseJsonLd(subject, branches, canonical),
    bodyHtml: renderSubjectPage(subject, {
      branches,
      offerings: subjectOfferings(subject).map(offering => ({
        ...offering,
        branches: offering.branchCodes.map(code => branchByCode[code]).filter(Boolean),
      })),
      regulation,
      legacySubject,
      branchHubPublished: branches.length === 1 && publishedBranchCodes.has(branches[0]?.code),
    }),
    navBranches,
    stamp: subject.source.status,
    socialImageAlt: `${subject.name} ${subject.regulation} syllabus on JNTUStack`,
  });

  if (subject.source.status === 'verified') {
    const outDir = path.join(distDir, slug);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), html);
    sitemapEntries.push({ url: canonical, lastmod: subject.source.retrieved_date });
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
  const branch_profiles = content.branchProfiles;
  const verifiedProfiles = branch_profiles.filter(b => b.source.status === 'verified');
  if (verifiedProfiles.length === branch_profiles.length && verifiedProfiles.length > 0) {
    const canonical = `${SITE_URL}/branch-guide/`;
    const title = 'Choosing an Engineering Branch - Six-Way Guide | JNTUStack';
    const description = 'Compare CSE, IT, ECE, EEE, Civil and Mechanical Engineering by core focus and fit signals, with an optional five-question branch quiz.';
    const lastmod = latestRetrievedDate(verifiedProfiles);
    const html = layout({
      title,
      description,
      canonical,
      jsonLd: collectionPageJsonLd({ name: 'Choosing an engineering branch', description, canonical, dateModified: lastmod }),
      bodyHtml: renderBranchGuidePage(verifiedProfiles, navBranches),
      navBranches,
      stamp: 'verified',
    });
    const outDir = path.join(distDir, 'branch-guide');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), html);
    branchGuidePublished = verifiedProfiles.length;
    sitemapEntries.push({ url: canonical, lastmod });
  } else {
    console.warn(`Branch guide skipped: ${branch_profiles.length - verifiedProfiles.length} profile(s) not yet verified.`);
  }
}

// Verified editorial guides are data-backed public destinations. Listing-only
// milestones may point at section anchors here without creating thin pages.
let guidesPublished = 0;
for (const guide of data.guides || []) {
  if (guide.source?.status !== 'verified') continue;
  const slug = guide.seo.slug || guide.id;
  const canonical = `${SITE_URL}/${slug}/`;
  const html = layout({
    title: guide.seo.title,
    description: guide.seo.meta_description,
    canonical,
    jsonLd: guideJsonLd(guide, canonical),
    bodyHtml: renderGuidePage(guide),
    navBranches,
    stamp: 'verified',
    socialImageAlt: `${guide.name} on JNTUStack`,
  });
  const outDir = path.join(distDir, slug);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  sitemapEntries.push({ url: canonical, lastmod: guide.source.retrieved_date });
  guidesPublished++;
}

// College directory: colleges across every JNTU campus present in the merged
// data, same verified-only discipline as the branch guide -- the page is
// generated only if every record is verified, so an unverified college can
// never reach dist/.
let collegesPublished = 0;
// collegeUniversitySummary feeds the homepage teaser too, so that copy can
// never go stale relative to what /colleges/ actually covers (see home.js).
let collegeUniversitySummary = null;
// Merged across every data/colleges-*.json -- drop in a new campus file and it
// auto-loads, same glob convention as subjects-*.json (see lib/dataset.js).
const { colleges: allColleges, coverageNotes } = content;
if (allColleges.length > 0) {
  const verifiedColleges = allColleges.filter(c => c.source.status === 'verified');
  if (verifiedColleges.length === allColleges.length && verifiedColleges.length > 0) {
    collegeUniversitySummary = collegeDirectoryUniversitySummary(verifiedColleges);
    const campusCount = campusesFromData(verifiedColleges).length;
    const canonical = `${SITE_URL}/colleges/`;
    const lastmod = latestRetrievedDate(verifiedColleges);
    const html = layout({
      title: `JNTU Engineering College Directory - ${campusCount} Campuses - JNTUStack`,
      description: `A directory of ${collegeUniversitySummary} constituent, autonomous and affiliated engineering colleges, grouped by university and filterable by district.`,
      canonical,
      jsonLd: collegesJsonLd(verifiedColleges, canonical, lastmod),
      bodyHtml: renderCollegeDirectoryPage(verifiedColleges, coverageNotes),
      navBranches,
      stamp: 'verified',
    });
    const outDir = path.join(distDir, 'colleges');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), html);
    collegesPublished = verifiedColleges.length;
    sitemapEntries.push({ url: canonical, lastmod });
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
  const branchVerified = verifiedSubjects.filter(s => subjectBranchCodes(s).includes(branch.code));
  if (branchVerified.length === 0) {
    branchHubsSkipped++;
    continue;
  }
  const code = branch.code.toLowerCase();
  const canonical = `${SITE_URL}/${code}/`;
  const title = `${branch.code} JNTUK R23 Syllabus & Subjects | JNTUStack`;
  const description = `JNTUK R23 ${branch.name} (${branch.code}) subjects and unit-wise syllabus, plus available earlier-regulation pages, grouped by semester and checked against published sources.`;
  const lastmod = latestRetrievedDate(branchVerified);
  const html = layout({
    title,
    description,
    canonical,
    jsonLd: collectionPageJsonLd({
      name: `${branch.code} JNTUK syllabus and subjects`,
      description,
      canonical,
      dateModified: lastmod,
      items: branchVerified.filter(isPageSubject).map(subject => ({
        name: subject.name,
        url: `${SITE_URL}/${subject.seo?.slug || subject.id}/`,
      })),
    }),
    bodyHtml: renderBranchHubPage(branch, branchVerified),
    navBranches,
    stamp: 'verified',
  });
  const outDir = path.join(distDir, code);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  sitemapEntries.push({ url: canonical, lastmod });
  branchHubsPublished++;
}

// Homepage -- the most basic requirement of a live site, generated last so
// it can honestly reflect what actually got published above.
const homeHtml = layout({
  title: 'JNTUStack - JNTUK R23 Syllabus & Subject Directory',
  description: 'Verified JNTUK subject syllabi led by R23, with unit breakdowns by branch and semester, an engineering college directory and a branch-choice guide.',
  canonical: `${SITE_URL}/`,
  jsonLd: homeJsonLd(),
  bodyHtml: renderHomePage({ branches: navBranches, collegeUniversitySummary, verifiedSubjectCount: verifiedPageSubjects.length, verifiedCollegeCount: collegesPublished }),
  navBranches,
  stamp: null,
});
fs.writeFileSync(path.join(distDir, 'index.html'), homeHtml);
const homeLastmod = latestRetrievedDate([
  ...verifiedSubjects,
  ...(data.guides || []).filter(guide => guide.source?.status === 'verified'),
  ...content.branchProfiles.filter(profile => profile.source?.status === 'verified'),
  ...allColleges.filter(college => college.source?.status === 'verified'),
]);
sitemapEntries.unshift({ url: `${SITE_URL}/`, lastmod: homeLastmod });

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries.map(entry => `  <url><loc>${entry.url}</loc>${entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
fs.writeFileSync(path.join(distDir, 'sitemap.xml'), sitemap);

// Deployment attestation is intentionally independent of git metadata because
// Hostinger receives the built artifact. The GitHub publisher supplies these
// values for reviewed releases; ordinary local builds remain explicit nulls.
let reviewedReleaseMarker = {};
const reviewedReleaseMarkerPath = path.join(dataDir, 'release.json');
const hasReviewedReleaseMarker = fs.existsSync(reviewedReleaseMarkerPath);
if (hasReviewedReleaseMarker) {
  reviewedReleaseMarker = JSON.parse(fs.readFileSync(reviewedReleaseMarkerPath, 'utf-8'));
}
fs.writeFileSync(path.join(distDir, 'release.json'), `${JSON.stringify({
  schema_version: reviewedReleaseMarker.schema_version || 1,
  // Once a reviewed marker is committed, it is the only deployment identity.
  // Environment overrides remain available solely for pre-marker legacy builds.
  release_id: hasReviewedReleaseMarker
    ? reviewedReleaseMarker.release_id || null
    : process.env.RELEASE_ID || null,
  artifact_hash: hasReviewedReleaseMarker
    ? reviewedReleaseMarker.artifact_hash || null
    : process.env.RELEASE_ARTIFACT_HASH || null,
  content: {
    subject_pages: published,
    listing_only_records: listed,
    guides: guidesPublished,
    sitemap_urls: sitemapEntries.length,
  },
}, null, 2)}\n`);

console.log('');
console.log('Build summary');
console.log('-------------');
console.log(`Published (verified)         : ${published}  -> dist/   (these are deployable)`);
console.log(`Listing-only (verified)       : ${listed}  -> branch hubs (no standalone page)`);
console.log(`Drafted (needs_verification) : ${drafted}  -> drafts/ (watermarked preview, NOT deployed)`);
console.log(`Skipped (placeholder)        : ${skipped}  -> not rendered at all`);
console.log(`Sitemap entries               : ${sitemapEntries.length}`);
console.log(`Branch guide                  : ${branchGuidePublished > 0 ? `published (${branchGuidePublished} branches)` : 'not published'}`);
console.log(`Editorial guides              : ${guidesPublished} published`);
console.log(`College directory             : ${collegesPublished > 0 ? `published (${collegesPublished} colleges)` : 'not published'}`);
console.log(`Branch hubs                   : ${branchHubsPublished} published, ${branchHubsSkipped} skipped (no verified subjects)`);
