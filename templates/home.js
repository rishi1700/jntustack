import { escapeHtml } from './layout.js';

export function renderHomePage({ branches = [], collegeUniversitySummary = null, verifiedSubjectCount = 0, verifiedCollegeCount = 0 }) {
  // Hero: light-first, loud teal. Copy keeps the honest framing -- verified
  // before it ships, no scraped dumps. Paired with the same circular seal
  // used on subject pages (bigger variant) -- the redesign's signature
  // element, now the very first thing a visitor sees.
  const collegeDirectoryPhrase = collegeUniversitySummary
    ? `a college directory covering ${collegeUniversitySummary}`
    : 'a college directory';
  const hero = `
<div class="home-hero-grid">
  <section class="home-hero">
    <span class="hero-badge">&#10003; Every page checked against a real syllabus</span>
    <h1 class="hero-title">Your semester, sorted <span class="text-brand">&mdash; and verified.</span></h1>
    <p class="hero-sub">Syllabus, unit breakdowns, and honest branch advice for JNTU Kakinada, Hyderabad, Anantapur, and GV students -- verified subject pages, a branch-choice guide, and ${escapeHtml(collegeDirectoryPhrase)}. No scraped dumps, no fake placement stats -- if it's on the page, we checked it.</p>
    <div class="btn-row">
      <a class="btn-primary" href="/branch-guide/">Find my subjects &rarr;</a>
      <a class="btn-secondary" href="/colleges/">Browse colleges</a>
    </div>
  </section>
  <div class="home-hero-seal">
    <div class="verify-seal verify-seal--lg">
      <div class="verify-seal-ring-outer"></div>
      <div class="verify-seal-ring-inner"></div>
      <div class="verify-seal-text">
        <span class="verify-seal-brand">JNTUSTACK</span>
        <span class="verify-seal-word">VERIFIED</span>
        <span class="verify-seal-sub">VS. PUBLISHED SYLLABUS &middot; ${verifiedSubjectCount} PAGES LIVE</span>
      </div>
    </div>
  </div>
</div>`;

  // Semester shortcut strip: a quick-scan tile per branch, same published/
  // not-yet-available honesty rule as the registry rows below (never a dead
  // link) -- just a faster way to jump straight in for repeat visitors.
  const semesterTiles = branches.map(b => b.published
    ? `<a class="semester-tile" href="${escapeHtml(b.href)}">
        <div class="semester-tile-code">${escapeHtml(b.code)}</div>
        <div class="semester-tile-count mono">${b.verifiedCount} page${b.verifiedCount === 1 ? '' : 's'}${b.listingCount ? ` + ${b.listingCount} listings` : ''}</div>
      </a>`
    : `<div class="semester-tile semester-tile--disabled" aria-disabled="true">
        <div class="semester-tile-code">${escapeHtml(b.code)}</div>
        <div class="semester-tile-soon">soon</div>
      </div>`
  ).join('');
  const semesterStrip = `
<div class="semester-strip">
  <div class="semester-strip-head">
    <h2>Jump straight to your semester</h2>
    <span class="semester-strip-tag">R23</span>
  </div>
  <div class="semester-tiles">${semesterTiles}</div>
</div>`;

  // The verification pipeline is the brand differentiator, promoted to its own
  // strip right under the hero. Static copy -- it describes the process, not data.
  const pipeline = `
<section class="pipeline" aria-label="How a page ships">
  <div class="pipeline-step">
    <div class="pipeline-num">STEP 01</div>
    <h3>Sourced</h3>
    <p>Every page starts from a published, JNTUK-affiliated syllabus document.</p>
  </div>
  <div class="pipeline-step">
    <div class="pipeline-num">STEP 02</div>
    <h3>Cross-checked</h3>
    <p>Content is verified against that source before publishing.</p>
  </div>
  <div class="pipeline-step pipeline-step--live">
    <div class="pipeline-num">STEP 03</div>
    <h3>Live, with citation</h3>
    <p>Only then it ships &mdash; no fabricated placement or salary stats, ever.</p>
  </div>
</section>`;

  // Branch registry rows replace the old tile grid. Published branches link to
  // their hub with a real count; unpublished are listed but unlinked -- same
  // honesty rule as before, new registry-row presentation.
  const branchRows = branches.map(b => b.published
    ? `<a class="registry-row registry-row--live" href="${escapeHtml(b.href)}">
        <span class="registry-code">${escapeHtml(b.code)}</span>
        <span class="registry-name">${escapeHtml(b.name)}</span>
        <span class="registry-status">${b.verifiedCount} syllabus page${b.verifiedCount === 1 ? '' : 's'}${b.listingCount ? ` + ${b.listingCount} official listings` : ''} &rarr;</span>
      </a>`
    : `<div class="registry-row" aria-disabled="true">
        <span class="registry-code">${escapeHtml(b.code)}</span>
        <span class="registry-name">${escapeHtml(b.name)}</span>
        <span class="registry-status">not yet available</span>
      </div>`
  ).join('');

  // Three entry points, now inside the mist "tools band". "Ask JNTUStack" stays
  // visibly Soon and deliberately NOT a link.
  const toolsBand = `
<section class="tools-band">
  <h2>Not sure where to start?</h2>
  <div class="home-cta-row">
    <a class="home-cta-card home-cta-card--featured" href="/branch-guide/">
      <h3>Confused about branches?</h3>
      <p class="tagline">A 5-question quiz and an honest comparison of all six -- no fabricated placement stats, no invented rankings.</p>
      <span class="home-cta-go">Take the quiz &rarr;</span>
    </a>
    <a class="home-cta-card" href="/colleges/">
      <h3>${verifiedCollegeCount ? `${verifiedCollegeCount} colleges, on record` : 'College directory'}</h3>
      <p class="tagline">Filter by district across${collegeUniversitySummary ? ` ${escapeHtml(collegeUniversitySummary)}` : ' every covered university'}. No &ldquo;best college&rdquo; claims.</p>
      <span class="home-cta-go">Open the directory &rarr;</span>
    </a>
    <div class="home-cta-card home-cta-card--soon" aria-disabled="true">
      <h3>Ask JNTUStack <span class="badge badge--soon">Soon</span></h3>
      <p class="tagline">Answers grounded only in verified pages -- ships once it can cite a source every time.</p>
      <span class="home-cta-go home-cta-go--muted">Coming soon</span>
    </div>
  </div>
</section>`;

  return `
${hero}

${semesterStrip}

${toolsBand}

${pipeline}

<section>
  <h2>Browse by branch</h2>
  <p class="guide-intro">Published branches link to every verified syllabus page and clearly labelled official milestone in one place. Branches without verified content are marked not-yet-available -- never a dead link.</p>
  <div class="registry">${branchRows}</div>
</section>

<div class="disclaimer-box">JNTUStack is an independent student resource, not affiliated with JNTU Kakinada, Hyderabad, Anantapur, or GV. New content is added only after it's checked against a published source -- see the "Verified" stamp on each page.</div>
`;
}
