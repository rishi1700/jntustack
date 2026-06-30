import { escapeHtml } from './layout.js';

// Group a branch's subjects by their year-semester label (e.g. "3-2"), sorted
// chronologically. Only verified subjects are ever passed in here -- the build
// gate upstream guarantees a hub is never generated for a branch with none.
function groupByYearSem(subjects) {
  const groups = new Map();
  for (const s of subjects) {
    const key = s.year_sem_label || `${s.year}-${s.semester}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  return [...groups.entries()].sort((a, b) => {
    const [ay, as] = a[0].split('-').map(Number);
    const [by, bs] = b[0].split('-').map(Number);
    return (ay - by) || (as - bs);
  });
}

function subjectItem(subject) {
  const slug = subject.seo?.slug || subject.id;
  const reg = subject.regulation
    ? `<span class="hub-reg mono">${escapeHtml(subject.regulation)}</span>`
    : '';
  return `<li><a href="/${escapeHtml(slug)}/">${escapeHtml(subject.name)}</a>${reg}</li>`;
}

export function renderBranchHubPage(branch, subjects) {
  const groups = groupByYearSem(subjects);
  const count = subjects.length;

  const groupsHtml = groups
    .map(
      ([label, list]) => `
  <section class="hub-sem-group">
    <h2>Year &amp; semester ${escapeHtml(label)}</h2>
    <ul class="hub-subject-list">
      ${list.map(subjectItem).join('\n      ')}
    </ul>
  </section>`
    )
    .join('\n');

  return `
<h1 class="subject-title">${escapeHtml(branch.name || branch.code)}</h1>
<p class="guide-intro">Every verified JNTUK ${escapeHtml(branch.code)} subject currently live on JNTUStack, grouped by year and semester. This hub lists only pages that have been checked against an official source -- ${count} so far, with more added page by page, never dumped in unverified.</p>

<div class="ad-slot">ad slot &mdash; below intro</div>

${groupsHtml}

<div class="disclaimer-box">Only verified subject pages appear here. If a subject you're studying isn't listed yet, it hasn't cleared verification -- not that it's been forgotten. Studying under an older regulation? Open any listed subject to find its cross-linked legacy version.</div>
`;
}
