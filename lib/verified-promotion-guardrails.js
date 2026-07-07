export const STALE_DRAFT_COPY_WARNING_CODE = 'stale_draft_copy_in_verified_promotion';
export const ELECTIVE_OPTION_REVIEW_WARNING_CODE = 'elective_option_review_required';

const STALE_DRAFT_PATTERNS = [
  { label: 'NEEDS VERIFICATION', pattern: /\bneeds\s+verification\b/i },
  { label: 'before publishing', pattern: /\bbefore\s+publishing\b/i },
  { label: 'draft', pattern: /\bdraft\b/i },
  { label: 'unverified', pattern: /\bunverified\b/i },
  { label: 'content-light stub', pattern: /\bcontent[-\s]+light\s+stub\b/i },
  { label: 'content-less stub', pattern: /\bcontent[-\s]+less\s+stub\b/i },
  { label: 'before flipping to verified', pattern: /\bbefore\s+flipping\s+to\s+verified\b/i },
];

function stringEntries(value, prefix = '') {
  if (typeof value === 'string') return [[prefix || '/', value]];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => stringEntries(item, `${prefix}/${index}`));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => stringEntries(child, `${prefix}/${key}`));
  }
  return [];
}

function publicCopyForPayload(payload = {}) {
  return {
    notes: payload.notes || '',
    seo: {
      title: payload.seo?.title || '',
      meta_description: payload.seo?.meta_description || '',
    },
    source: {
      college_source_note: payload.source?.college_source_note || '',
    },
    units: payload.units || [],
    course_outcomes: payload.course_outcomes || [],
  };
}

export function staleDraftCopyFindings(payload = {}) {
  const findings = [];
  for (const [path, value] of stringEntries(publicCopyForPayload(payload))) {
    for (const { label, pattern } of STALE_DRAFT_PATTERNS) {
      if (pattern.test(value)) {
        findings.push({ path, phrase: label });
      }
    }
  }
  return findings;
}

export function removeStaleVerifiedPromotionNotes(payload = {}) {
  const next = JSON.parse(JSON.stringify(payload));
  if (next.notes && staleDraftCopyFindings({ notes: next.notes }).length) {
    delete next.notes;
  }
  if (next.seo?.meta_description && staleDraftCopyFindings({ seo: { meta_description: next.seo.meta_description } }).length) {
    const yearSem = next.year_sem_label || [next.year, next.semester].filter(Boolean).join('-');
    const credits = next.credits?.C ?? next.credits?.total;
    next.seo.meta_description = [
      next.name,
      [next.regulation, next.branch, yearSem].filter(Boolean).join(' '),
      credits !== undefined && credits !== null && credits !== '' ? `${credits} credits` : '',
      'source-reviewed course metadata',
    ].filter(Boolean).join(' - ');
  }
  if (next.seo?.title && staleDraftCopyFindings({ seo: { title: next.seo.title } }).length) {
    next.seo.title = next.name || next.seo.title;
  }
  return next;
}

export function hasElectiveOptionAmbiguity(payload = {}, workflow = {}) {
  const combined = [
    payload.name,
    payload.category,
    payload.type,
    payload.notes,
    payload.seo?.title,
    payload.seo?.meta_description,
    workflow?.reviewer_note,
  ].filter(Boolean).join(' ');
  return /\bOR\b/.test(combined)
    || /\belective[-\s]+option\b/i.test(combined)
    || /\balternative\b/i.test(combined);
}

export function hasElectiveOptionReviewNote(note = '') {
  const text = String(note || '').trim();
  return text.length >= 80
    && /\belective\b/i.test(text)
    && /\bstandalone\b/i.test(text)
    && (
      /\bnot\s+mandatory\b/i.test(text)
      || /\bnot\s+required\b/i.test(text)
      || /\bdoes\s+not\s+imply\b/i.test(text)
      || /\bwithout\s+implying\b/i.test(text)
    );
}
