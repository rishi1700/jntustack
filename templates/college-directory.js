import { escapeHtml } from './layout.js';

// Display metadata for every affiliated_to enum value in schema.json
// (#/definitions/College/properties/affiliated_to). This is presentation-only:
// which campus SECTIONS actually render is derived from the distinct
// affiliated_to values present in the merged college data passed into
// renderCollegeDirectoryPage, not from this object -- so dropping in a new
// data/colleges-<code>.json for a university already listed here needs zero
// template edits. CAMPUS_ORDER fixes the reading order (not alphabetical);
// a code missing from either map still renders, using the code itself as a
// fallback name, so an unanticipated enum value can never crash the build.
const CAMPUS_META = {
  JNTUK: {
    name: 'JNTU Kakinada (JNTUK)',
    blurb: 'Constituent, autonomous and regular-affiliated engineering colleges under Jawaharlal Nehru Technological University, Kakinada.',
  },
  JNTUGV: {
    name: 'JNTU-GV, Vizianagaram (JNTUGV)',
    blurb: 'Engineering colleges under Jawaharlal Nehru Technological University Gurajada, Vizianagaram -- the campus that split from JNTUK in 2022 (Vizianagaram, Visakhapatnam, Srikakulam, Parvathipuram Manyam, Alluri Sitharama Raju and Anakapalli districts).',
  },
  JNTUH: {
    name: 'JNTU Hyderabad (JNTUH)',
    blurb: "Constituent and regular-affiliated engineering colleges under Jawaharlal Nehru Technological University Hyderabad -- Telangana's main affiliating university, a separate institution from the Andhra Pradesh campuses above.",
  },
  JNTUA: {
    name: 'JNTU Anantapur (JNTUA)',
    blurb: "Constituent and regular-affiliated engineering colleges under Jawaharlal Nehru Technological University Anantapur -- covering Rayalaseema and Nellore, the Andhra Pradesh districts not covered by JNTUK or JNTU-GV.",
  },
};
const CAMPUS_ORDER = ['JNTUK', 'JNTUGV', 'JNTUH', 'JNTUA'];

export function campusesFromData(colleges) {
  const present = new Set(colleges.map((c) => c.affiliated_to));
  const ordered = CAMPUS_ORDER.filter((code) => present.has(code));
  // Any enum value present in the data but missing from CAMPUS_ORDER (should
  // not happen given the closed schema enum, but keeps this genuinely data-driven
  // rather than silently dropping a campus) is appended in first-seen order.
  for (const code of colleges.map((c) => c.affiliated_to)) {
    if (!ordered.includes(code)) ordered.push(code);
  }
  return ordered.map((code) => ({ code, ...(CAMPUS_META[code] || { name: code, blurb: '' }) }));
}

// Short label for naming universities in running prose (title, meta description,
// intro, disclaimer) -- distinct from CAMPUS_META.name, which is the full section
// heading. Same fallback discipline: an unlisted code just uses itself.
const CAMPUS_SHORT_LABEL = { JNTUK: 'JNTUK', JNTUGV: 'JNTU-GV', JNTUH: 'JNTUH', JNTUA: 'JNTUA' };

function joinNatural(items) {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// Single source of truth for "which universities does this directory cover" prose,
// used by the page copy below AND by build.js for the <title>/meta description --
// so neither can go stale the way "JNTUK & JNTU-GV" did after JNTUH and now JNTUA
// were added without anyone updating the hardcoded copy.
export function collegeDirectoryUniversitySummary(colleges) {
  return joinNatural(campusesFromData(colleges).map((c) => CAMPUS_SHORT_LABEL[c.code] || c.code));
}

// Three honest buckets, matching the only distinction the data actually makes.
// No ranking, no "tier", no quality ordering -- those aren't in the data.
const TYPE_GROUPS = [
  { heading: 'Constituent colleges', match: (t) => t === 'Constituent' },
  { heading: 'Autonomous colleges', match: (t) => t === 'Autonomous-Private' },
  { heading: 'Affiliated colleges', match: (t) => t === 'Private' },
];

function typeLabel(type) {
  if (type === 'Constituent') return 'Constituent';
  if (type === 'Autonomous-Private') return 'Autonomous';
  return 'Affiliated';
}

function renderCard(college) {
  const loc = college.location || {};
  const city = loc.city ? escapeHtml(loc.city) : '';
  const district = loc.district ? escapeHtml(loc.district) : '';
  const where = [city, district].filter(Boolean).join(', ');

  // short_code and official_website are both optional -- render only when present.
  const codeHtml = college.short_code
    ? `<div class="college-codes mono">${escapeHtml(college.affiliated_to)} affiliation code: ${escapeHtml(college.short_code)}</div>`
    : '';
  const linkHtml = college.official_website
    ? `<a class="college-link" href="${escapeHtml(college.official_website)}" target="_blank" rel="noopener noreferrer">Official website &nearr;</a>`
    : '';

  return `
        <article class="college-card" data-district="${district}">
          <h4>${escapeHtml(college.name)}</h4>
          <div class="college-meta">
            <span class="college-type-badge">${escapeHtml(typeLabel(college.type))}</span>
            ${where ? `<span class="college-district">${where}</span>` : ''}
          </div>
          ${codeHtml}
          ${linkHtml}
        </article>`;
}

function renderGroup(group, colleges) {
  const inGroup = colleges.filter((c) => group.match(c.type));
  if (!inGroup.length) return '';
  return `
    <section class="college-type-group">
      <h3>${escapeHtml(group.heading)} <span class="group-count">(${inGroup.length})</span></h3>
      <div class="college-grid">
        ${inGroup.map(renderCard).join('')}
      </div>
    </section>`;
}

function renderCampus(campus, colleges) {
  const inCampus = colleges.filter((c) => c.affiliated_to === campus.code);
  if (!inCampus.length) return '';
  const groupsHtml = TYPE_GROUPS.map((g) => renderGroup(g, inCampus)).join('');
  return `
  <section class="campus-group" data-campus="${escapeHtml(campus.code)}">
    <h2 class="campus-heading">${escapeHtml(campus.name)} <span class="group-count">(${inCampus.length})</span></h2>
    <p class="campus-sub">${escapeHtml(campus.blurb)}</p>
    ${groupsHtml}
  </section>`;
}

// Client-side district filter. Progressive enhancement: with no JS every card
// is already visible, so the page is fully usable -- the script only narrows by
// district. It also hides any campus/type section left empty by the filter.
function filterScript() {
  return `
<script>
(function(){
  const buttons = document.querySelectorAll('.district-btn');
  const cards = document.querySelectorAll('.college-card');
  const typeGroups = document.querySelectorAll('.college-type-group');
  const campusGroups = document.querySelectorAll('.campus-group');
  const countEl = document.getElementById('collegeCount');
  const total = cards.length;

  function apply(district){
    let visible = 0;
    cards.forEach(card => {
      const match = district === 'all' || card.dataset.district === district;
      card.hidden = !match;
      if (match) visible++;
    });
    typeGroups.forEach(g => { g.hidden = !g.querySelector('.college-card:not([hidden])'); });
    campusGroups.forEach(g => { g.hidden = !g.querySelector('.college-card:not([hidden])'); });
    countEl.textContent = district === 'all'
      ? 'Showing all ' + total + ' colleges'
      : 'Showing ' + visible + ' of ' + total + ' colleges in ' + district;
  }

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
      apply(btn.dataset.district);
    });
  });
})();
</script>`;
}

export function renderCollegeDirectoryPage(colleges, coverageNotes = []) {
  const districts = [
    ...new Set(colleges.map((c) => c.location?.district).filter(Boolean)),
  ].sort();

  const filterButtons = [
    `<button class="district-btn" type="button" data-district="all" aria-pressed="true">All districts</button>`,
    ...districts.map(
      (d) =>
        `<button class="district-btn" type="button" data-district="${escapeHtml(d)}" aria-pressed="false">${escapeHtml(d)}</button>`
    ),
  ].join('\n    ');

  const campusesHtml = campusesFromData(colleges).map((c) => renderCampus(c, colleges)).join('\n');
  const universitySummary = collegeDirectoryUniversitySummary(colleges);

  // Support one or many coverage notes (one per campus data file). Back-compat:
  // a bare string is still accepted.
  const notes = Array.isArray(coverageNotes)
    ? coverageNotes
    : coverageNotes ? [{ note: coverageNotes }] : [];
  // These are dense sourcing/methodology notes (one per university) -- valuable
  // for traceability but far too long to sit above the actual directory. Collapse
  // them into a single expandable disclosure so the filter and college list are
  // immediately visible; anyone who wants the provenance can open it.
  const notesHtml = notes.length
    ? `<details class="coverage-notes" style="margin:1rem 0 1.25rem;border:1px solid var(--line);border-radius:8px;padding:.4rem .9rem;">
    <summary style="cursor:pointer;font-weight:600;color:var(--text-2);padding:.35rem 0;">How this directory was compiled &mdash; sourcing &amp; coverage notes per university</summary>
    <div style="margin-top:.6rem;">
      ${notes.map((n) => `<div class="disclaimer-box"><strong>Coverage note:</strong> ${escapeHtml(typeof n === 'string' ? n : n.note)}</div>`).join('\n      ')}
    </div>
  </details>`
    : '';

  return `
<h1 class="subject-title">College Directory</h1>
<p class="guide-intro">Every ${escapeHtml(universitySummary)} constituent, autonomous and affiliated engineering college currently in our dataset, grouped by university and filterable by district. Just what's on record -- no rankings, no "best college" claims, nothing we can't point to a source for.</p>

${notesHtml}

<div class="ad-slot">ad slot &mdash; below intro</div>

<div class="district-filter" role="group" aria-label="Filter colleges by district">
    ${filterButtons}
</div>
<p class="college-count" id="collegeCount">Showing all ${colleges.length} colleges</p>

${campusesHtml}

<div class="disclaimer-box">Listings are sourced from each university's own official DAA / academics / affiliated-colleges portal (${escapeHtml(universitySummary)}). This directory is informational only -- inclusion here is not an endorsement, and the order of listing carries no meaning.</div>
${filterScript()}
`;
}
