import { escapeHtml } from './layout.js';

export function renderSubjectPage(subject, { branch, regulation, legacySubject, branchHubPublished }) {
  const isVerified = subject.source.status === 'verified';
  const badgeClass = isVerified ? 'badge--verified' : 'badge--draft';
  const badgeLabel = isVerified ? 'Verified vs. published syllabus' : 'Needs verification';

  // Units as registry-style rows with a mono UNIT nn tag column.
  const unitsHtml = subject.units && subject.units.length > 0
    ? subject.units.map((u, i) => `
          <div class="unit-row">
            <div class="unit-tag">UNIT ${String(i + 1).padStart(2, '0')}</div>
            <div>
              <div class="unit-title">${escapeHtml(u.title)}</div>
              ${u.topics?.length ? `<div class="unit-topics">${escapeHtml(u.topics.join('; '))}</div>` : ''}
            </div>
          </div>`).join('')
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

  // Right rail: verification card (the redesign's signature element) when the
  // page is verified; the draft badge stays in the status row either way.
  // Tier-aware verify-card text. The strong tier (subject/credits/placement
  // cross-confirmed against JNTUK's own exam records) may say so; autonomous-only
  // sources must NOT imply an official JNTU document -- they are a published
  // syllabus from a JNTUK-affiliated college, as the caveat box states.
  const sourceNote = subject.source.college_source_note || '';
  const notCrossConfirmed = /not\s+(been\s+)?(independently\s+)?cross-confirmed/i.test(sourceNote);
  const crossConfirmed = /cross-confirmed against/i.test(sourceNote) && !notCrossConfirmed;
  const verifyCardText = crossConfirmed
    ? `Subject, credits and placement cross-checked against JNTUK&rsquo;s ${escapeHtml(subject.regulation)} exam records.`
    : `Checked against a published ${escapeHtml(subject.regulation)} syllabus from a JNTUK-affiliated source.`;
  const verifyCard = isVerified
    ? `<div class="verify-card">
        <div><span class="check" aria-hidden="true">&#10003;</span> <strong style="color:var(--accent);">Verified</strong></div>
        <p style="font-size:.82rem;line-height:1.55;color:var(--text-2);margin:.5rem 0;">${verifyCardText}</p>
        ${subject.source.retrieved_date ? `<div class="mono" style="font-size:.68rem;color:var(--muted);">Checked ${escapeHtml(subject.source.retrieved_date)}</div>` : ''}
      </div>`
    : '';

  // Back-link to the branch hub, but only when that hub was actually published
  // (i.e. the branch has at least one verified subject). Never link to a hub
  // URL that the verified-only gate didn't generate -- that would be a 404.
  const hubBreadcrumb = branchHubPublished && branch
    ? `<a class="crumb" href="/${escapeHtml(branch.code.toLowerCase())}/">&larr; All ${escapeHtml(branch.name || branch.code)} subjects</a>`
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

  return `
${hubBreadcrumb}
<div class="subject-grid">
  <div class="subject-main">
    <div class="form-strip">
      <span>Regulation: <b>${escapeHtml(subject.regulation)}</b></span>
      <span>Branch: <b>${escapeHtml(branch?.name || subject.branch)}</b></span>
      <span>Semester: <b>${escapeHtml(subject.year_sem_label)}</b></span>
      ${subject.subject_code ? `<span>Code: <b>${escapeHtml(subject.subject_code)}</b></span>` : ''}
    </div>

    <h1 class="subject-title">${escapeHtml(subject.name)}</h1>
    <div class="status-row">
      <span class="badge ${badgeClass}">${badgeLabel}</span>
      ${subject.source.retrieved_date ? `<span>Checked ${escapeHtml(subject.source.retrieved_date)}</span>` : ''}
    </div>

    ${sourceCaveatHtml}

    ${legacyHtml}

    <div class="ad-slot">ad slot &mdash; top, below intro</div>

    ${outcomesHtml}

    <section>
      <h2>Unit-wise syllabus</h2>
      ${unitsHtml}
    </section>
  </div>

  <aside class="subject-rail">
    ${verifyCard}
    <div class="rail-card">
      <h2 style="font-size:.95rem;margin-bottom:.7rem;">Download</h2>
      ${resourcesHtml}
    </div>
  </aside>
</div>

<div class="ad-slot">ad slot &mdash; bottom, below content, never adjacent to the download box above</div>
`;
}
