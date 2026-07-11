import { escapeHtml } from './layout.js';

// Local storage-backed unit checklist: each subject gets its own key, so
// progress is per-device and never touches the server (no accounts, no PII).
// Inlined per-page (like search-bar.js's searchBarScript) since this only
// ever runs on subject pages.
function unitChecklistScript() {
  return `<script>
(function () {
  var card = document.querySelector('.checklist-card[data-subject-id]');
  if (!card) return;
  var key = 'ts-units-' + card.getAttribute('data-subject-id');
  var rows = Array.prototype.slice.call(card.querySelectorAll('.checklist-row'));
  var progressEl = card.querySelector('.checklist-progress');
  var covered;
  try { covered = new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch (e) { covered = new Set(); }

  function paint() {
    rows.forEach(function (row) {
      var unit = row.getAttribute('data-unit');
      var on = covered.has(unit);
      row.classList.toggle('is-covered', on);
      row.setAttribute('aria-pressed', on ? 'true' : 'false');
      row.querySelector('.checklist-check').textContent = on ? '\\u2713' : '';
    });
    if (progressEl) progressEl.textContent = covered.size + ' / ' + rows.length + ' COVERED';
  }

  rows.forEach(function (row) {
    row.addEventListener('click', function () {
      var unit = row.getAttribute('data-unit');
      if (covered.has(unit)) covered.delete(unit); else covered.add(unit);
      try { localStorage.setItem(key, JSON.stringify(Array.from(covered))); } catch (e) {}
      paint();
    });
  });

  paint();
})();
</script>`;
}

export function renderSubjectPage(subject, { branches = [], regulation, legacySubject, branchHubPublished }) {
  // branches is always an array: length 1 for an ordinary per-branch subject
  // (identical to the old single-branch behavior below), length 2+ for a
  // subject shared across branches and rendered once at a branch-neutral URL.
  const isShared = branches.length > 1;
  const branch = branches[0];
  const isVerified = subject.source.status === 'verified';
  const badgeClass = isVerified ? 'badge--verified' : 'badge--draft';
  const badgeLabel = isVerified ? 'Verified vs. published syllabus' : 'Needs verification';
  const hasUnits = subject.units && subject.units.length > 0;

  // Unit checklist: tick-off progress lives entirely in the visitor's
  // localStorage (see unitChecklistScript) -- server always renders the
  // unchecked "0 / N" state, then the inline script hydrates real counts on
  // load. No accounts, nothing sent anywhere, never varies the cached HTML.
  const checklistIntro = hasUnits
    ? `${subject.units.length} units, from ${escapeHtml(subject.units[0].title)} to ${escapeHtml(subject.units[subject.units.length - 1].title)}. Tick off units as you cover them &mdash; your progress stays on this device.`
    : '';
  const unitsHtml = hasUnits
    ? `<div class="checklist-card" data-subject-id="${escapeHtml(subject.id)}">
        <div class="checklist-head">
          <h2>Unit-wise syllabus</h2>
          <span class="checklist-progress mono">0 / ${subject.units.length} COVERED</span>
        </div>
        ${subject.units.map((u, i) => `
        <button type="button" class="checklist-row" data-unit="${i + 1}" aria-pressed="false">
          <span class="checklist-check" aria-hidden="true"></span>
          <span>
            <span class="checklist-unit-title">UNIT ${String(i + 1).padStart(2, '0')} &mdash; ${escapeHtml(u.title)}</span>
            ${u.topics?.length ? `<span class="checklist-unit-topics">${escapeHtml(u.topics.join(' · '))}</span>` : ''}
          </span>
        </button>`).join('')}
      </div>
      ${unitChecklistScript()}`
    : `<div class="empty-state">Unit-wise breakdown not published yet for this page. Source: ${subject.source.origin_url ? `<a href="${subject.source.origin_url}" rel="nofollow noopener" target="_blank">reference</a>` : 'not yet sourced'}.</div>`;

  const outcomesHtml = subject.course_outcomes?.length
    ? `<section>
        <h2>What you'll be able to do</h2>
        <ul>${subject.course_outcomes.map(o => `<li>${escapeHtml(o)}</li>`).join('')}</ul>
      </section>`
    : '';

  const resourceLinks = [
    subject.resources?.lecture_notes_pdf ? `<a class="download" href="${subject.resources.lecture_notes_pdf}">&darr; Download notes (PDF)</a>` : '',
    subject.resources?.previous_question_papers_pdf ? `<a class="download" href="${subject.resources.previous_question_papers_pdf}">&darr; Previous question papers</a>` : '',
    subject.resources?.lab_manual_pdf ? `<a class="download" href="${subject.resources.lab_manual_pdf}">&darr; Lab manual</a>` : '',
  ].filter(Boolean).join('');

  const resourcesHtml = resourceLinks
    ? resourceLinks
    : `<div class="empty-state">Notes for this subject haven't been uploaded yet. Check back soon.</div>`;

  // Right rail: the circular verified seal is the redesign's signature
  // element, replacing the old text verify-card (whose more detailed
  // cross-confirmed/not-cross-confirmed sentence still lives on the page,
  // in the source-caveat disclaimer box below). Tier-aware: the strong tier
  // (subject/credits/placement cross-confirmed against JNTUK's own exam
  // records) may say so; autonomous-only sources must NOT imply an official
  // JNTU document -- they are a published syllabus from a JNTUK-affiliated
  // college, as the caveat box states.
  const sourceNote = subject.source.college_source_note || '';
  const notCrossConfirmed = /not\s+(been\s+)?(independently\s+)?cross-confirmed/i.test(sourceNote);
  const crossConfirmed = /cross-confirmed against/i.test(sourceNote) && !notCrossConfirmed;

  // Circular seal: the same signature element the mockups lead with. Reuses
  // the exact crossConfirmed gating above -- the sub-line never claims an
  // exam-records cross-check it didn't get.
  const sealSub = crossConfirmed
    ? `VS. JNTUK ${escapeHtml(subject.regulation)} EXAM RECORDS`
    : `VS. PUBLISHED ${escapeHtml(subject.regulation)} SYLLABUS`;
  const verifySeal = isVerified
    ? `<div class="verify-seal-wrap">
        <div class="verify-seal">
          <div class="verify-seal-ring-outer"></div>
          <div class="verify-seal-ring-inner"></div>
          <div class="verify-seal-text">
            <span class="verify-seal-brand">JNTUSTACK</span>
            <span class="verify-seal-word">VERIFIED</span>
            <span class="verify-seal-sub">${sealSub}${subject.source.retrieved_date ? ` &middot; ${escapeHtml(subject.source.retrieved_date)}` : ''}</span>
          </div>
        </div>
      </div>`
    : '';

  // Back-link to the branch hub, but only when that hub was actually published
  // (i.e. the branch has at least one verified subject). Never link to a hub
  // URL that the verified-only gate didn't generate -- that would be a 404.
  // A shared subject has no single hub to point back to (it's listed on all
  // of them), so it gets no hub breadcrumb rather than an arbitrary one.
  const hubBreadcrumb = !isShared && branchHubPublished && branch
    ? `<a class="crumb" href="/${escapeHtml(branch.code.toLowerCase())}/">&larr; All ${escapeHtml(branch.name || branch.code)} subjects</a>`
    : '';

  // Reuses the same disclaimer-box styling as the source caveat below -- no
  // new UI, just another instance of the existing "why this page looks the
  // way it does" callout, for the other reason a page might need one.
  const sharedNoteHtml = isShared
    ? `<div class="disclaimer-box">Common to ${branches.map(b => escapeHtml(b?.code || '')).join(', ')} B.Tech first-year (R23) -- this page isn't branch-specific, which is why it isn't listed under a single branch hub.</div>`
    : '';

  const legacyHtml = legacySubject
    ? `<div class="legacy-callout">
        Studying under the older ${escapeHtml(legacySubject.regulation)} regulation (supply/backlog)?
        <a href="/${legacySubject.seo.slug}/">See the ${escapeHtml(legacySubject.regulation)} version of this subject &rarr;</a>
      </div>`
    : '';

  // Short, student-facing caveat about the source itself (e.g. autonomous-college
  // sourcing). Rendered only when present so it stays honest about the "Verified"
  // stamp instead of hiding the nuance in maintainer-only metadata.
  const sourceCaveatHtml = subject.source.college_source_note
    ? `<div class="disclaimer-box">${escapeHtml(subject.source.college_source_note)}</div>`
    : '';

  const subjectPath = isShared
    ? `<a href="/">HOME</a> / ${escapeHtml(subject.year_sem_label)}`
    : `<a href="/">HOME</a>${branchHubPublished && branch ? ` / <a href="/${escapeHtml(branch.code.toLowerCase())}/">${escapeHtml(branch.code)}</a>` : branch ? ` / ${escapeHtml(branch.code)}` : ''} / ${escapeHtml(subject.year_sem_label)}`;

  return `
${hubBreadcrumb}
<div class="subject-path mono">${subjectPath}</div>
<div class="subject-grid">
  <div class="subject-main">
    <div class="pill-row">
      <span class="pill">${escapeHtml(subject.regulation)}</span>
      ${isShared
        ? `<span class="pill">${branches.map(b => escapeHtml(b?.code || '')).join('/')} &middot; ${escapeHtml(subject.year_sem_label)}</span>`
        : `<span class="pill">${escapeHtml(branch?.code || subject.branch)} &middot; ${escapeHtml(subject.year_sem_label)}</span>`}
      ${subject.subject_code ? `<span class="pill">${escapeHtml(subject.subject_code)}</span>` : ''}
      <span class="pill ${isVerified ? 'pill--verified' : ''}">${isVerified ? '&#10003; ' : ''}${badgeLabel.toUpperCase()}${subject.source.retrieved_date ? ` ${escapeHtml(subject.source.retrieved_date)}` : ''}</span>
    </div>

    <h1 class="subject-title">${escapeHtml(subject.name)}</h1>
    <div class="status-row">
      <span class="badge ${badgeClass}">${badgeLabel}</span>
      ${subject.source.retrieved_date ? `<span>Checked ${escapeHtml(subject.source.retrieved_date)}</span>` : ''}
    </div>

    ${sharedNoteHtml}${sourceCaveatHtml}

    ${legacyHtml}

    <div class="ad-slot">ad slot &mdash; top, below intro</div>

    ${outcomesHtml}

    <section>
      ${hasUnits ? '' : '<h2>Unit-wise syllabus</h2>'}
      ${hasUnits ? `<p class="checklist-intro">${checklistIntro}</p>` : ''}
      ${unitsHtml}
    </section>
  </div>

  <aside class="subject-rail">
    ${verifySeal}
    <div class="rail-card">
      <h2 style="font-size:.95rem;margin-bottom:.7rem;">Download</h2>
      ${resourcesHtml}
    </div>
  </aside>
</div>

<div class="ad-slot">ad slot &mdash; bottom, below content, never adjacent to the download box above</div>
`;
}
