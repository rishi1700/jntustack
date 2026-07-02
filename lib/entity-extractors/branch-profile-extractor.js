function clean(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return clean(value);
  }
  return undefined;
}

function arrayFrom(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  return undefined;
}

function sourceFromParsed(parsed) {
  return {
    origin_url: parsed?.source_url || parsed?.source?.origin_url || null,
    retrieved_date: parsed?.source?.retrieved_date || null,
    status: 'needs_verification',
  };
}

export function extractBranchProfilePayload({ parsedPayload = {}, entityKey = '', hints = {} }) {
  const parsed = parsedPayload?.parsed_payload && typeof parsedPayload.parsed_payload === 'object'
    ? parsedPayload.parsed_payload
    : parsedPayload || {};
  const branch = firstText(parsed.branch, hints.branch, entityKey);

  const payload = {
    branch: branch ? branch.toUpperCase() : undefined,
    tagline: firstText(parsed.tagline, parsed.title, parsed.headings?.[0]),
    core_focus: arrayFrom(parsed.core_focus),
    suits_students_who: arrayFrom(parsed.suits_students_who),
    less_good_fit_if: arrayFrom(parsed.less_good_fit_if),
    career_paths: arrayFrom(parsed.career_paths),
    further_study_paths: arrayFrom(parsed.further_study_paths),
    related_branches: arrayFrom(parsed.related_branches),
    data_disclaimer: firstText(parsed.data_disclaimer),
    source: sourceFromParsed(parsed),
  };

  return {
    payload,
    confidence: {
      extractor: 'branch-profile-basic',
      extraction_confidence: 'low',
      matched_fields: Object.entries(payload).filter(([, value]) => value !== undefined).map(([key]) => key),
      requires_human_review: true,
      no_auto_proposal: true,
    },
  };
}
