import { escapeHtml } from './layout.js';

// Two honest buckets, matching the only distinction the data actually makes:
// a university's own colleges vs. third-party autonomous colleges. No ranking,
// no "tier", no quality ordering -- those aren't in the data and never will be.
const TYPE_GROUPS = [
  { heading: 'Constituent colleges', match: (t) => t === 'Constituent' },
  { heading: 'Autonomous colleges', match: (t) => t !== 'Constituent' },
];

// Constituent = the university's own college; everything else in this dataset
// is an autonomous private college. We surface that label verbatim, nothing more.
function typeLabel(type) {
  return type === 'Constituent' ? 'Constituent' : 'Autonomous';
}

function renderCard(college) {
  const loc = college.location || {};
  const city = loc.city ? escapeHtml(loc.city) : '';
  const district = loc.district ? escapeHtml(loc.district) : '';
  const where = [city, district].filter(Boolean).join(', ');

  // short_code and official_website are both optional in the data -- only
  // render them when the record actually carries them.
  const codeHtml = college.short_code
    ? `<div class="college-codes mono">JNTUK affiliation code: ${escapeHtml(college.short_code)}</div>`
    : '';
  const linkHtml = college.official_website
    ? `<a class="college-link" href="${escapeHtml(college.official_website)}" target="_blank" rel="noopener noreferrer">Official website &nearr;</a>`
    : '';

  return `
      <article class="college-card" data-district="${district}">
        <h3>${escapeHtml(college.name)}</h3>
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
    <h2>${escapeHtml(group.heading)} <span class="group-count">(${inGroup.length})</span></h2>
    <div class="college-grid">
      ${inGroup.map(renderCard).join('')}
    </div>
  </section>`;
}

// Client-side district filter. Progressive enhancement: with no JS every card
// is already visible, so the page is fully usable -- the script only adds the
// ability to narrow by district, it isn't required to read the directory.
function filterScript() {
  return `
<script>
(function(){
  const buttons = document.querySelectorAll('.district-btn');
  const cards = document.querySelectorAll('.college-card');
  const groups = document.querySelectorAll('.college-type-group');
  const countEl = document.getElementById('collegeCount');
  const total = cards.length;

  function apply(district){
    let visible = 0;
    cards.forEach(card => {
      const match = district === 'all' || card.dataset.district === district;
      card.hidden = !match;
      if (match) visible++;
    });
    groups.forEach(group => {
      group.hidden = !group.querySelector('.college-card:not([hidden])');
    });
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

export function renderCollegeDirectoryPage(colleges, coverageNote) {
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

  const groupsHtml = TYPE_GROUPS.map((g) => renderGroup(g, colleges)).join('\n');

  return `
<h1 class="subject-title">JNTUK College Directory</h1>
<p class="guide-intro">Every JNTUK constituent and autonomous college currently in our dataset, grouped by type and filterable by district. Just what's on record -- no rankings, no "best college" claims, nothing we can't point to a source for.</p>

${coverageNote ? `<div class="disclaimer-box"><strong>Coverage note:</strong> ${escapeHtml(coverageNote)}</div>` : ''}

<div class="ad-slot">ad slot &mdash; below intro</div>

<div class="district-filter" role="group" aria-label="Filter colleges by district">
    ${filterButtons}
</div>
<p class="college-count" id="collegeCount">Showing all ${colleges.length} colleges</p>

${groupsHtml}

<div class="disclaimer-box">Listings are sourced from the official JNTUK DAA portal (jntukdaaportal.in). This directory is informational only -- inclusion here is not an endorsement, and the order of listing carries no meaning.</div>
${filterScript()}
`;
}
