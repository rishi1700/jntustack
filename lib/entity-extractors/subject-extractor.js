function clean(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return clean(value);
  }
  return undefined;
}

function numeric(value) {
  if (value == null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function sourceFromParsed(parsed) {
  return {
    origin_url: parsed?.source_url || parsed?.source?.origin_url || null,
    retrieved_date: parsed?.source?.retrieved_date || null,
    status: 'needs_verification',
  };
}

function candidateFromParsed(parsedPayload, candidateIndex) {
  const candidates = Array.isArray(parsedPayload?.candidates) ? parsedPayload.candidates : [];
  if (candidateIndex == null || candidateIndex === '') return null;
  const parsedIndex = Number(candidateIndex);
  if (!Number.isInteger(parsedIndex) || parsedIndex < 0 || parsedIndex >= candidates.length) {
    throw new Error(`Candidate index is out of range: ${candidateIndex}`);
  }
  return candidates[parsedIndex] || null;
}

export function extractSubjectPayload({ parsedPayload = {}, entityKey = '', hints = {}, candidateIndex = null }) {
  const parsed = parsedPayload?.parsed_payload && typeof parsedPayload.parsed_payload === 'object'
    ? parsedPayload.parsed_payload
    : parsedPayload || {};
  const candidate = candidateFromParsed(parsed, candidateIndex);
  const source = candidate || parsed;
  const name = firstText(parsed.name, parsed.subject_name, parsed.title, parsed.headings?.[0], entityKey);
  const candidateName = firstText(source.name, source.subject_name);
  const subjectName = firstText(candidateName, name);
  const regulation = firstText(source.regulation, parsed.regulation, hints.regulation);
  const branch = firstText(source.branch, parsed.branch, hints.branch);
  const year = numeric(source.year ?? parsed.year ?? hints.year);
  const semester = numeric(source.semester ?? parsed.semester ?? hints.semester);
  const yearSemLabel = firstText(source.year_sem_label, parsed.year_sem_label, year && semester ? `${year}-${semester}` : '');
  const slug = firstText(source.seo?.slug, parsed.seo?.slug, entityKey, subjectName ? [
    subjectName,
    'jntuk',
    regulation,
    branch,
    yearSemLabel,
  ].filter(Boolean).join(' ') : '');

  const fallbackId = firstText(source.id, parsed.id, slug ? slugify([
    regulation,
    branch,
    yearSemLabel,
    subjectName,
  ].filter(Boolean).join(' ')) : '');

  const payload = {
    id: fallbackId,
    regulation: regulation ? regulation.toUpperCase() : undefined,
    branch: branch ? branch.toUpperCase() : undefined,
    specialization: source.specialization || parsed.specialization || null,
    year,
    semester,
    year_sem_label: yearSemLabel,
    subject_code: source.subject_code ?? parsed.subject_code ?? null,
    name: subjectName,
    category: source.category || parsed.category,
    credits: source.credits ?? parsed.credits ?? null,
    type: source.type || parsed.type,
    units: Array.isArray(parsed.units) ? parsed.units : undefined,
    course_outcomes: Array.isArray(parsed.course_outcomes) ? parsed.course_outcomes : [],
    resources: parsed.resources || {
      lecture_notes_pdf: null,
      previous_question_papers_pdf: null,
      lab_manual_pdf: null,
    },
    seo: {
      slug: slug ? slugify(slug) : undefined,
      title: source.seo?.title || parsed.seo?.title || subjectName,
      meta_description: source.seo?.meta_description || parsed.seo?.meta_description || (subjectName ? `${subjectName} extracted candidate. Needs human verification before publishing.` : undefined),
    },
    legacy_equivalent_id: parsed.legacy_equivalent_id ?? null,
    source: sourceFromParsed(parsed),
    notes: firstText(parsed.notes, 'Extracted candidate from parsed source evidence. Requires human verification.'),
  };

  return {
    payload,
    confidence: {
      extractor: 'subject-basic',
      extraction_confidence: 'low',
      candidate_index: candidate?.candidate_index ?? candidateIndex ?? null,
      matched_fields: Object.entries(payload).filter(([, value]) => value !== undefined).map(([key]) => key),
      requires_human_review: true,
      no_auto_proposal: true,
    },
  };
}
