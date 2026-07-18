import { escapeHtml } from './layout.js';
import { isListingOnlySubject, subjectOfferingForBranch } from '../lib/dataset.js';

// Group a branch's subjects by their year-semester label (e.g. "3-2"), sorted
// chronologically. Only verified subjects are ever passed in here -- the build
// gate upstream guarantees a hub is never generated for a branch with none.
function groupByYearSem(subjects, branchCode) {
  const groups = new Map();
  for (const s of subjects) {
    const offering = subjectOfferingForBranch(s, branchCode);
    if (!offering) continue;
    const key = offering.year_sem_label;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ subject: s, offering });
  }
  return [...groups.entries()].sort((a, b) => {
    const [ay, as] = a[0].split('-').map(Number);
    const [by, bs] = b[0].split('-').map(Number);
    return (ay - by) || (as - bs);
  });
}

// The full R23 semester run a branch hub can show. First year is shared/
// branch-neutral content (see subjectBranchCodes fan-out) but every branch
// hub still lists it, linking out to the one neutral URL -- so it belongs
// in the rail too. Used only to render the left rail so a not-yet-covered
// semester shows honestly as "soon" instead of just silently not existing.
const ALL_BRANCH_SEMESTERS = ['1-1', '1-2', '2-1', '2-2', '3-1', '3-2', '4-1', '4-2'];

function subjectCard({ subject }) {
  if (isListingOnlySubject(subject)) {
    const href = subject.publication?.listing_url || subject.source?.origin_url || null;
    const external = href && !href.startsWith('/');
    const inner = `<div>
      <div class="subject-card-title">${escapeHtml(subject.name)}</div>
      <div class="subject-card-meta">${escapeHtml(subject.regulation)} &middot; &#10003; OFFICIAL LISTING</div>
    </div>
    ${href ? '<span class="subject-card-arrow" aria-hidden="true">&rarr;</span>' : ''}`;
    return href
      ? `<a class="subject-card subject-card--listing" href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${inner}</a>`
      : `<div class="subject-card subject-card--listing" aria-label="Official listing without a detail page">${inner}</div>`;
  }
  const slug = subject.seo?.slug || subject.id;
  return `<a class="subject-card" href="/${escapeHtml(slug)}/">
    <div>
      <div class="subject-card-title">${escapeHtml(subject.name)}</div>
      <div class="subject-card-meta">${escapeHtml(subject.regulation)} &middot; &#10003; VERIFIED</div>
    </div>
    <span class="subject-card-arrow" aria-hidden="true">&rarr;</span>
  </a>`;
}

export function renderBranchHubPage(branch, subjects) {
  const groups = groupByYearSem(subjects, branch.code);
  const groupsByLabel = new Map(groups);
  const pageCount = subjects.filter(subject => !isListingOnlySubject(subject)).length;
  const listingCount = subjects.filter(isListingOnlySubject).length;

  // First semester with any verified content is the page's landing section,
  // so its rail item starts visually "active" -- no scroll-tracking JS needed.
  const firstAvailableLabel = groups[0]?.[0];
  const railHtml = ALL_BRANCH_SEMESTERS
    .map(label => {
      const list = groupsByLabel.get(label);
      if (!list) {
        return `<span class="hub-rail-item hub-rail-item--soon" aria-disabled="true">${escapeHtml(label)} <span class="mono">soon</span></span>`;
      }
      const activeClass = label === firstAvailableLabel ? ' hub-rail-item--active' : '';
      return `<a class="hub-rail-item${activeClass}" href="#sem-${escapeHtml(label)}">${escapeHtml(label)} <span class="mono">${list.length}</span></a>`;
    })
    .join('');

  const groupsHtml = groups
    .map(
      ([label, list]) => `
  <h2 class="hub-sem-label" id="sem-${escapeHtml(label)}">Year &amp; semester ${escapeHtml(label)}</h2>
  <div class="subject-card-grid">
    ${list.map(subjectCard).join('\n    ')}
  </div>`
    )
    .join('\n');

  return `
<nav class="page-breadcrumb" aria-label="Breadcrumb">
  <ol>
    <li><a href="/">Home</a></li>
    <li aria-current="page">${escapeHtml(branch.code)} subjects</li>
  </ol>
</nav>

<div class="hub-layout">
  <nav class="hub-rail" aria-label="Jump to semester">
    <div class="hub-rail-label">SEMESTERS</div>
    <div class="hub-rail-list">${railHtml}</div>
  </nav>

  <div style="min-width:0;flex:1;">
    <div class="hub-head-row">
      <div>
        <h1 class="subject-title">${escapeHtml(branch.name || branch.code)}</h1>
        <p class="guide-intro">Browse the JNTUK R23 ${escapeHtml(branch.code)} syllabus and available earlier-regulation pages by semester. Full syllabus pages and official course-structure milestones are clearly distinguished and linked to their published evidence.</p>
      </div>
      <div class="hub-stat-badge"><b>${pageCount}</b><span>SYLLABUS<br>PAGE${pageCount === 1 ? '' : 'S'}</span></div>
    </div>

    ${listingCount ? `<p class="hub-publication-summary"><strong>${pageCount}</strong> syllabus pages &middot; <strong>${listingCount}</strong> official listing${listingCount === 1 ? '' : 's'}/milestone${listingCount === 1 ? '' : 's'}</p>` : ''}

    ${groupsHtml}
  </div>
</div>

<div class="disclaimer-box">Only source-verified content appears here. “Official listing” means the course structure confirms the milestone but does not publish enough unit-level material for a standalone syllabus page.</div>
`;
}
