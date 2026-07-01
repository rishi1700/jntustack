import { escapeHtml } from './layout.js';

export function renderHomePage({ branches = [] }) {
  // Three primary entry points. Branch guide + college directory are live links;
  // "Ask JNTUStack" is visibly marked Soon and intentionally NOT a link -- honest
  // about not being ready rather than hidden or a dead click.
  const ctaRow = `
<section class="home-cta-row">
  <a class="home-cta-card" href="/branch-guide/">
    <h3>Choosing a branch?</h3>
    <p class="tagline">A 5-question quiz plus an honest comparison of all six branches -- no fabricated placement stats, no invented rankings.</p>
    <span class="home-cta-go">Open the branch guide &rarr;</span>
  </a>
  <a class="home-cta-card" href="/colleges/">
    <h3>JNTUK college directory</h3>
    <p class="tagline">Constituent and autonomous colleges, grouped by type and filterable by district. Just the facts on record.</p>
    <span class="home-cta-go">Open the directory &rarr;</span>
  </a>
  <div class="home-cta-card home-cta-card--soon" aria-disabled="true">
    <h3>Ask JNTUStack <span class="badge badge--soon">Soon</span></h3>
    <p class="tagline">Ask a question, get an answer grounded only in verified pages. Not live yet -- it ships once it can cite a real source every time.</p>
    <span class="home-cta-go home-cta-go--muted">Coming soon</span>
  </div>
</section>`;

  // Branch grid: all six branches, same annotated data as the nav dropdown.
  // Published branches link to their hub and show a real verified-subject count;
  // unpublished branches are dimmed, unlinked, and make no "0 subjects" claim.
  const branchTiles = branches.map(b => b.published
    ? `<a class="branch-tile" href="${escapeHtml(b.href)}">
        <span class="branch-tile-code">${escapeHtml(b.code)}</span>
        <span class="branch-tile-name">${escapeHtml(b.name)}</span>
        <span class="branch-tile-count">${b.verifiedCount} verified subject${b.verifiedCount === 1 ? '' : 's'}</span>
      </a>`
    : `<div class="branch-tile branch-tile--disabled" aria-disabled="true">
        <span class="branch-tile-code">${escapeHtml(b.code)}</span>
        <span class="branch-tile-name">${escapeHtml(b.name)}</span>
        <span class="branch-tile-soon">not yet available</span>
      </div>`
  ).join('');

  return `
<h1 class="subject-title">JNTUStack</h1>
<p class="guide-intro">A clean, fast resource for JNTU Kakinada, Hyderabad, Anantapur, and GV students -- course materials, a branch-choice guide, and a JNTUK college directory. Built page by page, verified before it goes live, not scraped together.</p>

<div class="ad-slot">ad slot &mdash; below intro</div>

${ctaRow}

<section>
  <h2>Browse by branch</h2>
  <p class="guide-intro">Published branches link to every verified subject in one place. Branches without a verified subject yet are listed but marked not-yet-available -- never a dead link.</p>
  <div class="branch-grid">${branchTiles}</div>
</section>

<div class="disclaimer-box">JNTUStack is an independent student resource, not affiliated with JNTU Kakinada, Hyderabad, Anantapur, or GV. New content is added only after it's checked against an official source -- see the "Verified" stamp on each page.</div>
`;
}
