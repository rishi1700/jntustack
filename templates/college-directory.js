import { escapeHtml } from './layout.js';

// Universities are the top-level grouping so it's never ambiguous which campus
// a college belongs to. Order is fixed (JNTUK, JNTU-GV, then JNTUH); a campus
// with no colleges in the data renders nothing.
const CAMPUSES = [
  {
    code: 'JNTUK',
    name: 'JNTU Kakinada (JNTUK)',
    blurb: 'Constituent, autonomous and regular-affiliated engineering colleges under Jawaharlal Nehru Technological University, Kakinada.',
  },
  {
    code: 'JNTUGV',
    name: 'JNTU-GV, Vizianagaram (JNTUGV)',
    blurb: 'Engineering colleges under Jawaharlal Nehru Technological University Gurajada, Vizianagaram -- the campus that split from JNTUK in 2022 (Vizianagaram, Visakhapatnam, Srikakulam, Parvathipuram Manyam, Alluri Sitharama Raju and Anakapalli districts).',
  },
  {
    code: 'JNTUH',
    name: 'JNTU Hyderabad (JNTUH)',
    blurb: "Constituent and regular-affiliated engineering colleges under Jawaharlal Nehru Technological University Hyderabad -- Telangana's main affiliating university, a separate institution from the Andhra Pradesh campuses above.",
  },
];

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

  const campusesHtml = CAMPUSES.map((c) => renderCampus(c, colleges)).join('\n');

  // Support one or many coverage notes (one per campus data file). Back-compat:
  // a bare string is still accepted.
  const notes = Array.isArray(coverageNotes)
    ? coverageNotes
    : coverageNotes ? [{ note: coverageNotes }] : [];
  const notesHtml = notes
    .map((n) => `<div class="disclaimer-box"><strong>Coverage note:</strong> ${escapeHtml(typeof n === 'string' ? n : n.note)}</div>`)
    .join('\n');

  return `
<h1 class="subject-title">College Directory</h1>
<p class="guide-intro">Every JNTUK and JNTU-GV constituent, autonomous and affiliated engineering college currently in our dataset, grouped by university and filterable by district. Just what's on record -- no rankings, no "best college" claims, nothing we can't point to a source for.</p>

${notesHtml}

<div class="ad-slot">ad slot &mdash; below intro</div>

<div class="district-filter" role="group" aria-label="Filter colleges by district">
    ${filterButtons}
</div>
<p class="college-count" id="collegeCount">Showing all ${colleges.length} colleges</p>

${campusesHtml}

<div class="disclaimer-box">Listings are sourced from the official JNTUK and JNTU-GV DAA / academics portals. This directory is informational only -- inclusion here is not an endorsement, and the order of listing carries no meaning.</div>
${filterScript()}
`;
}
