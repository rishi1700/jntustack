import { escapeHtml } from './layout.js';

export function renderHomePage({ branches = [] }) {
  // Hero: light-first, loud teal. Copy keeps the honest framing -- verified
  // before it ships, no scraped dumps.
  const hero = `
<section class="home-hero">
  <span class="hero-badge">&#9679; Verified before it ships</span>
  <h1 class="hero-title">Course material you can <span class="text-brand">actually trust</span>.</h1>
  <p class="hero-sub">A clean, fast resource for JNTU Kakinada, Hyderabad, Anantapur, and GV students -- course materials, a branch-choice guide, and a JNTUK college directory. Built page by page, verified before it goes live, not scraped together.</p>
  <div class="btn-row">
    <a class="btn-primary" href="/branch-guide/">Open the branch guide</a>
    <a class="btn-secondary" href="/colleges/">Browse colleges</a>
  </div>
</section>`;

  // The verification pipeline is the brand differentiator, promoted to its own
  // strip right under the hero. Static copy -- it describes the process, not data.
  const pipeline = `
<section class="pipeline" aria-label="How a page ships">
  <div class="pipeline-step">
    <div class="pipeline-num">STEP 01</div>
    <h3>Sourced</h3>
    <p>Every page starts from an official JNTUK syllabus document.</p>
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
        <span class="registry-status">${b.verifiedCount} verified subject${b.verifiedCount === 1 ? '' : 's'} &rarr;</span>
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
    <a class="home-cta-card" href="/branch-guide/">
      <h3>Choosing a branch?</h3>
      <p class="tagline">A 5-question quiz plus an honest comparison of all six branches -- no fabricated placement stats, no invented rankings.</p>
      <span class="home-cta-go">Open the branch guide &rarr;</span>
    </a>
    <a class="home-cta-card" href="/colleges/">
      <h3>College directory</h3>
      <p class="tagline">Constituent, autonomous, and affiliated colleges across JNTUK, JNTU-GV, and JNTUH, grouped by university and filterable by district.</p>
      <span class="home-cta-go">Open the directory &rarr;</span>
    </a>
    <div class="home-cta-card home-cta-card--soon" aria-disabled="true">
      <h3>Ask JNTUStack <span class="badge badge--soon">Soon</span></h3>
      <p class="tagline">Ask a question, get an answer grounded only in verified pages. Not live yet -- it ships once it can cite a real source every time.</p>
      <span class="home-cta-go home-cta-go--muted">Coming soon</span>
    </div>
  </div>
</section>`;

  return `
${hero}

<div class="ad-slot">ad slot &mdash; below intro</div>

${pipeline}

<section>
  <h2>Browse by branch</h2>
  <p class="guide-intro">Published branches link to every verified subject in one place. Branches without a verified subject yet are listed but marked not-yet-available -- never a dead link.</p>
  <div class="registry">${branchRows}</div>
</section>

${toolsBand}

<div class="disclaimer-box">JNTUStack is an independent student resource, not affiliated with JNTU Kakinada, Hyderabad, Anantapur, or GV. New content is added only after it's checked against an official source -- see the "Verified" stamp on each page.</div>
`;
}
