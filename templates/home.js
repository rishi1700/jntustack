import { escapeHtml } from './layout.js';

export function renderHomePage({ publishedSubjects = [] }) {
  const subjectLinks = publishedSubjects.length
    ? `<ul class="fit-list">${publishedSubjects.map(s => `<li><a href="/${s.slug}/">${escapeHtml(s.title)}</a></li>`).join('')}</ul>`
    : `<div class="empty-state">No subject pages published yet.</div>`;

  return `
<h1 class="subject-title">JNTUStack</h1>
<p class="guide-intro">A clean, fast resource for JNTU Kakinada, Hyderabad, Anantapur, and GV students -- course materials, a branch-choice guide, and (soon) a real college directory. Built page by page, verified before it goes live, not scraped together.</p>

<div class="ad-slot">ad slot &mdash; below intro</div>

<section>
  <h2>Start here</h2>
  <div class="branch-compare-card">
    <h3>Not sure which branch to pick?</h3>
    <p class="tagline">A 5-question quiz plus an honest comparison of all six branches -- no fabricated placement stats, no "best college" rankings invented out of thin air.</p>
    <a class="download" href="/branch-guide/">Open the branch guide &rarr;</a>
  </div>
</section>

<section>
  <h2>Available course materials</h2>
  <p class="guide-intro">This is genuinely all that's verified and live right now -- more is being added page by page, not dumped in unverified.</p>
  ${subjectLinks}
</section>

<div class="disclaimer-box">JNTUStack is an independent student resource, not affiliated with JNTU Kakinada, Hyderabad, Anantapur, or GV. New content is added only after it's checked against an official source -- see the "Verified" stamp on each page.</div>
`;
}
