function clean(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return clean(value);
  }
  return undefined;
}

function sourceFromParsed(parsed) {
  return {
    origin_url: parsed?.source_url || parsed?.source?.origin_url || null,
    retrieved_date: parsed?.source?.retrieved_date || null,
    status: 'needs_verification',
  };
}

export function extractCollegePayload({ parsedPayload = {}, entityKey = '', hints = {} }) {
  const parsed = parsedPayload?.parsed_payload && typeof parsedPayload.parsed_payload === 'object'
    ? parsedPayload.parsed_payload
    : parsedPayload || {};
  const location = parsed.location && typeof parsed.location === 'object' ? parsed.location : {};
  const name = firstText(parsed.name, parsed.college_name, parsed.title, parsed.headings?.[0], entityKey);
  const affiliatedTo = firstText(parsed.affiliated_to, parsed.university, hints.university);

  const payload = {
    name,
    short_code: parsed.short_code ?? null,
    affiliated_to: affiliatedTo ? affiliatedTo.toUpperCase() : undefined,
    location: {
      city: firstText(location.city, parsed.city),
      district: firstText(location.district, parsed.district),
      state: firstText(location.state, parsed.state),
    },
    type: parsed.type,
    branches_offered: Array.isArray(parsed.branches_offered) ? parsed.branches_offered : undefined,
    official_website: parsed.official_website || parsed.website || null,
    nirf_rank: parsed.nirf_rank ?? null,
    source: sourceFromParsed(parsed),
    notes: firstText(parsed.notes, 'Extracted candidate from parsed source evidence. Requires human verification.'),
  };

  return {
    payload,
    confidence: {
      extractor: 'college-basic',
      extraction_confidence: 'low',
      matched_fields: Object.entries(payload).filter(([, value]) => value !== undefined).map(([key]) => key),
      requires_human_review: true,
      no_auto_proposal: true,
    },
  };
}
