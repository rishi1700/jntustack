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

const CATEGORY_LABELS = {
  BasicScience: 'basic science course',
  EngineeringScience: 'engineering science course',
  HSMC: 'humanities and management course',
  Lab: 'laboratory course',
  MandatoryNonCredit: 'mandatory non-credit course',
  OpenElective: 'open elective',
  ProfessionalCore: 'professional core course',
  ProfessionalElective: 'professional elective',
  SkillEnhancement: 'skill-enhancement course',
};

function displayDate(value = '') {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  const [, year, month, day] = match;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(day)} ${monthNames[Number(month) - 1]} ${year}`;
}

function sourceHost(url = '') {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function sourcePageEvidence(subject) {
  const note = subject.notes || '';
  const pageMatch = note.match(/\b(?:pages?|pp?\.)\s*\d+(?:\s*[\u2013\u2014-]\s*\d+)?/i);
  const evidence = [];
  if (subject.subject_code) evidence.push(`Course ${subject.subject_code}`);
  if (pageMatch) evidence.push(pageMatch[0].replace(/^./, c => c.toUpperCase()));
  if (subject.units?.length) evidence.push(`${subject.units.length} published ${subject.units.length === 1 ? 'section' : 'units'}`);
  return evidence.join(' \u00b7 ') || 'Published course record';
}

function subjectIntro(subject, branches, offerings) {
  const branchScope = branches.length === 1
    ? `${branches[0]?.name || branches[0]?.code || subject.branch} (${branches[0]?.code || subject.branch})`
    : branches.length === 2
      ? branches.map(branch => branch?.code).filter(Boolean).join(' and ')
      : 'all listed engineering branches';
  const category = CATEGORY_LABELS[subject.category] || 'course';
  const totalCredits = offerings.length === 1
    ? offerings[0].credits?.C ?? offerings[0].credits?.total
    : null;
  const creditText = typeof totalCredits === 'number'
    ? totalCredits === 0
      ? 'It is a non-credit requirement.'
      : `It carries ${totalCredits} ${totalCredits === 1 ? 'credit' : 'credits'}.`
    : '';
  const units = subject.units || [];
  let coverageText = 'A unit-wise breakdown is not yet available on this page.';
  if (units.length === 1) {
    const activityCount = units[0].topics?.length || 0;
    coverageText = activityCount > 1
      ? `Its published ${units[0].title} section lists ${activityCount} activities or topic groups.`
      : `Its published coverage is grouped under ${units[0].title}.`;
  } else if (units.length > 1) {
    coverageText = `The published coverage runs across ${units.length} units, from ${units[0].title} through ${units[units.length - 1].title}.`;
  }
  const semesters = [...new Set(offerings.map(offering => offering.year_sem_label))].join(' and ');
  const placementText = offerings.length > 1
    ? `Its official branch and semester placements (${semesters}) are listed below.`
    : `It is listed in semester ${semesters}.`;
  return `This JNTUK ${subject.regulation} ${category} is listed for ${branchScope}. ${placementText} ${creditText} ${coverageText}`.replace(/\s+/g, ' ').trim();
}

function creditCell(credits, key) {
  const value = credits?.[key];
  return value == null ? '—' : escapeHtml(value);
}

function offeringsTable(offerings) {
  if (!offerings.length) return '';
  return `<section class="offering-table-wrap" aria-labelledby="offered-in-title">
    <h2 id="offered-in-title">Offered in</h2>
    <div class="table-scroll"><table class="offering-table">
      <thead><tr><th>Branches</th><th>Semester</th><th>L</th><th>T</th><th>P</th><th>C</th></tr></thead>
      <tbody>${offerings.map(offering => `<tr>
        <td>${offering.branches.map(branch => escapeHtml(branch.code)).join(', ')}</td>
        <td>${escapeHtml(offering.year_sem_label)}</td>
        <td>${creditCell(offering.credits, 'L')}</td><td>${creditCell(offering.credits, 'T')}</td>
        <td>${creditCell(offering.credits, 'P')}</td><td>${creditCell(offering.credits, 'C')}</td>
      </tr>`).join('')}</tbody>
    </table></div>
  </section>`;
}

function sourceDocket(subject, isVerified) {
  const primaryUrl = subject.source.origin_url || '';
  const sources = [
    ...(primaryUrl ? [{ origin_url: primaryUrl, label: sourceHost(primaryUrl).endsWith('jntuk.edu.in') ? 'Official JNTUK syllabus' : 'Published syllabus reference' }] : []),
    ...((subject.source.additional_sources || []).map(source => typeof source === 'string'
      ? { origin_url: source, label: 'Additional published source' }
      : source)),
  ].filter(source => source?.origin_url);
  const uniqueSources = [...new Map(sources.map(source => [source.origin_url, source])).values()];
  const linksHtml = uniqueSources.length
    ? `<ul class="source-docket-links">${uniqueSources.map((source, index) => {
        const host = sourceHost(source.origin_url);
        return `<li>
          <a href="${escapeHtml(source.origin_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.label || (index === 0 ? 'Published syllabus source' : 'Additional published source'))} <span aria-hidden="true">\u2197</span></a>
          ${host ? `<span class="source-docket-host mono">${escapeHtml(host)}</span>` : ''}
        </li>`;
      }).join('')}</ul>`
    : '<span>Source URL not recorded</span>';
  const checked = subject.source.retrieved_date
    ? `<time datetime="${escapeHtml(subject.source.retrieved_date)}">${escapeHtml(displayDate(subject.source.retrieved_date))}</time>`
    : 'Date not recorded';
  const verificationScope = subject.source.college_source_note
    || 'The page is linked to the published course reference shown above.';

  return `<section class="source-docket" aria-labelledby="source-docket-title">
    <div class="source-docket-head">
      <div>
        <span class="source-docket-kicker mono">SOURCE DOCKET</span>
        <h2 id="source-docket-title">Published evidence</h2>
      </div>
      <span class="source-docket-status${isVerified ? '' : ' source-docket-status--draft'}">${isVerified ? '\u2713 Verified' : 'Needs verification'}</span>
    </div>
    <dl class="source-docket-grid">
      <div><dt>Source</dt><dd>${linksHtml}</dd></div>
      <div><dt>Checked</dt><dd>${checked}</dd></div>
      <div><dt>Record</dt><dd>${escapeHtml(sourcePageEvidence(subject))}</dd></div>
    </dl>
    <p class="source-docket-scope"><strong>Verification scope</strong>${escapeHtml(verificationScope)}</p>
  </section>`;
}

export function renderSubjectPage(subject, { branches = [], offerings = [], regulation, legacySubject, branchHubPublished }) {
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
    ? subject.units.length === 1
      ? `Published practical or activity coverage: ${escapeHtml(subject.units[0].title)}. Tick it off as you cover it &mdash; your progress stays on this device.`
      : `${subject.units.length} units, from ${escapeHtml(subject.units[0].title)} to ${escapeHtml(subject.units[subject.units.length - 1].title)}. Tick off units as you cover them &mdash; your progress stays on this device.`
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
    ? `<div class="rail-card">
        <h2 style="font-size:.95rem;margin-bottom:.7rem;">Downloads</h2>
        ${resourceLinks}
      </div>`
    : '';

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

  // Reuses the same disclaimer-box styling as the source caveat below -- no
  // new UI, just another instance of the existing "why this page looks the
  // way it does" callout, for the other reason a page might need one.
  const semesterScope = [...new Set(offerings.map(offering => offering.year_sem_label))].join('/');
  const sharedNoteHtml = isShared
    ? `<div class="disclaimer-box">This official syllabus is shared across ${branches.map(b => escapeHtml(b?.code || '')).join(', ')}. One neutral page keeps the syllabus and source evidence together while the table below preserves each exact branch/semester placement.</div>`
    : '';

  const legacyHtml = legacySubject
    ? `<div class="legacy-callout">
        Studying under the older ${escapeHtml(legacySubject.regulation)} regulation (supply/backlog)?
        <a href="/${legacySubject.seo.slug}/">See the ${escapeHtml(legacySubject.regulation)} version of this subject &rarr;</a>
      </div>`
    : '';

  const branchScopeLabel = isShared
    ? branches.map(item => item?.code).filter(Boolean).join('/')
    : branch?.code || subject.branch;
  const pageKind = hasUnits ? 'syllabus' : 'study notes';
  const breadcrumbBranch = !isShared && branchHubPublished && branch
    ? `<li><a href="/${escapeHtml(branch.code.toLowerCase())}/">${escapeHtml(branch.code)} subjects</a></li>`
    : '';
  const breadcrumbHtml = `<nav class="page-breadcrumb" aria-label="Breadcrumb">
    <ol>
      <li><a href="/">Home</a></li>
      ${breadcrumbBranch}
      <li aria-current="page">${escapeHtml(subject.name)}</li>
    </ol>
  </nav>`;
  const offeringCategories = (subject.offering_categories || []).filter(Boolean);
  const offeringHtml = offeringCategories.length
    ? `<div class="offering-categories" aria-label="Official offering categories">
        <span class="mono">OFFICIALLY OFFERED AS</span>
        ${offeringCategories.map(category => `<span class="offering-category">${escapeHtml((CATEGORY_LABELS[category] || category).replace(/ course$/, ''))}</span>`).join('')}
      </div>`
    : '';

  return `
${breadcrumbHtml}
<div class="subject-grid">
  <div class="subject-main">
    <div class="pill-row">
      <span class="pill">${escapeHtml(subject.regulation)}</span>
      ${isShared
        ? `<span class="pill">${branches.map(b => escapeHtml(b?.code || '')).join('/')} &middot; ${escapeHtml(semesterScope)}</span>`
        : `<span class="pill">${escapeHtml(branch?.code || subject.branch)} &middot; ${escapeHtml(semesterScope)}</span>`}
      ${subject.subject_code ? `<span class="pill">${escapeHtml(subject.subject_code)}</span>` : ''}
      <span class="pill ${isVerified ? 'pill--verified' : ''}">${isVerified ? '&#10003; ' : ''}${badgeLabel.toUpperCase()}${subject.source.retrieved_date ? ` ${escapeHtml(subject.source.retrieved_date)}` : ''}</span>
    </div>

    <h1 class="subject-title subject-title--contextual">
      <span>${escapeHtml(subject.name)}</span>
      <span class="subject-title-context">JNTUK ${escapeHtml(subject.regulation)} &middot; ${escapeHtml(branchScopeLabel)} &middot; semester ${escapeHtml(semesterScope)} &middot; ${pageKind}</span>
    </h1>
    ${offeringHtml}
    <p class="subject-intro">${escapeHtml(subjectIntro(subject, branches, offerings))}</p>
    <div class="status-row">
      <span class="badge ${badgeClass}">${badgeLabel}</span>
      ${subject.source.retrieved_date ? `<span>Checked <time datetime="${escapeHtml(subject.source.retrieved_date)}">${escapeHtml(displayDate(subject.source.retrieved_date))}</time></span>` : ''}
    </div>

    ${sharedNoteHtml}

    ${offeringsTable(offerings)}

    ${sourceDocket(subject, isVerified)}

    ${legacyHtml}

    ${outcomesHtml}

    <section>
      ${hasUnits ? '' : '<h2>Unit-wise syllabus</h2>'}
      ${hasUnits ? `<p class="checklist-intro">${checklistIntro}</p>` : ''}
      ${unitsHtml}
    </section>
  </div>

  <aside class="subject-rail">
    ${verifySeal}
    ${resourcesHtml}
  </aside>
</div>
`;
}
