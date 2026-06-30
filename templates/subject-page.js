import { escapeHtml } from './layout.js';

export function renderSubjectPage(subject, { branch, regulation, legacySubject, branchHubPublished }) {
  const isVerified = subject.source.status === 'verified';
  const badgeClass = isVerified ? 'badge--verified' : 'badge--draft';
  const badgeLabel = isVerified ? 'Verified vs. official syllabus' : 'Needs verification';

  const unitsHtml = subject.units && subject.units.length > 0
    ? `<ul class="units-list">
        ${subject.units.map(u => `
          <li>
            <div class="unit-title">${escapeHtml(u.title)}</div>
            ${u.topics?.length ? `<div class="unit-topics">${escapeHtml(u.topics.join('; '))}</div>` : ''}
          </li>`).join('')}
      </ul>`
    : `<div class="empty-state">Unit-wise breakdown not published yet for this page. Source: ${subject.source.origin_url ? `<a href="${subject.source.origin_url}" rel="nofollow noopener" target="_blank">reference</a>` : 'not yet sourced'}.</div>`;

  const outcomesHtml = subject.course_outcomes?.length
    ? `<section>
        <h2>What you'll be able to do</h2>
        <ul>${subject.course_outcomes.map(o => `<li>${escapeHtml(o)}</li>`).join('')}</ul>
      </section>`
    : '';

  const resourceLinks = [
    subject.resources?.lecture_notes_pdf ? `<a class="download" href="${subject.resources.lecture_notes_pdf}">Download notes (PDF)</a>` : '',
    subject.resources?.previous_question_papers_pdf ? `<a class="download" href="${subject.resources.previous_question_papers_pdf}">Previous question papers</a>` : '',
    subject.resources?.lab_manual_pdf ? `<a class="download" href="${subject.resources.lab_manual_pdf}">Lab manual</a>` : '',
  ].filter(Boolean).join('');

  const resourcesHtml = resourceLinks
    ? `<div class="resources-box">${resourceLinks}</div>`
    : `<div class="empty-state">Notes for this subject haven't been uploaded yet. Check back soon or use the Telegram channel link below to ask.</div>`;

  // Back-link to the branch hub, but only when that hub was actually published
  // (i.e. the branch has at least one verified subject). Never link to a hub
  // URL that the verified-only gate didn't generate -- that would be a 404.
  const hubBreadcrumb = branchHubPublished && branch
    ? `<a class="hub-breadcrumb" href="/${escapeHtml(branch.code.toLowerCase())}/">&larr; All ${escapeHtml(branch.name || branch.code)} subjects</a>`
    : '';

  const legacyHtml = legacySubject
    ? `<div class="legacy-callout">
        Studying under the older ${escapeHtml(legacySubject.regulation)} regulation (supply/backlog)?
        <a href="/${legacySubject.seo.slug}/">See the ${escapeHtml(legacySubject.regulation)} version of this subject &rarr;</a>
      </div>`
    : '';

  return `
${hubBreadcrumb}
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

${legacyHtml}

<div class="ad-slot">ad slot &mdash; top, below intro</div>

${outcomesHtml}

<section>
  <h2>Unit-wise syllabus</h2>
  ${unitsHtml}
</section>

<section>
  <h2>Download</h2>
  ${resourcesHtml}
</section>

<div class="ad-slot">ad slot &mdash; bottom, below content, never adjacent to the download box above</div>
`;
}
