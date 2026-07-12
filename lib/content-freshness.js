const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_CONTENT_REVIEW_DAYS = 180;

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function dateValue(value) {
  const raw = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const timestamp = Date.parse(`${raw}T00:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function reviewWindowDays(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 30 && parsed <= 730
    ? parsed
    : DEFAULT_CONTENT_REVIEW_DAYS;
}

function sourceLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Source URL missing';
  }
}

export function buildContentFreshness(subjects = [], {
  now = new Date(),
  reviewDays = process.env.CONTENT_REVIEW_DAYS,
} = {}) {
  const thresholdDays = reviewWindowDays(reviewDays);
  const nowTimestamp = now instanceof Date ? now.getTime() : Date.parse(now);
  const groups = new Map();

  for (const subject of subjects) {
    const url = clean(subject?.source?.origin_url);
    const key = url || `missing:${subject?.id || groups.size}`;
    const retrievedDate = clean(subject?.source?.retrieved_date);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        url,
        host: sourceLabel(url),
        retrievedDates: [],
        subjectCount: 0,
        verifiedCount: 0,
        draftCount: 0,
        examples: [],
      });
    }
    const group = groups.get(key);
    group.subjectCount += 1;
    if (subject?.source?.status === 'verified') group.verifiedCount += 1;
    if (subject?.source?.status === 'needs_verification') group.draftCount += 1;
    if (retrievedDate) group.retrievedDates.push(retrievedDate);
    if (group.examples.length < 3) {
      group.examples.push({
        id: subject?.id || '',
        name: subject?.name || subject?.id || 'Untitled subject',
        branch: subject?.branch || '',
        semester: subject?.year_sem_label || '',
      });
    }
  }

  const sources = [...groups.values()].map(group => {
    const reviewedAt = group.retrievedDates.sort().at(0) || '';
    const reviewedTimestamp = dateValue(reviewedAt);
    const ageDays = reviewedTimestamp == null || !Number.isFinite(nowTimestamp)
      ? null
      : Math.max(0, Math.floor((nowTimestamp - reviewedTimestamp) / DAY_MS));
    const status = !group.url || reviewedTimestamp == null
      ? 'missing'
      : ageDays > thresholdDays
        ? 'due'
        : 'current';
    return {
      ...group,
      reviewedAt,
      ageDays,
      status,
    };
  }).sort((a, b) => {
    const priority = { missing: 0, due: 1, current: 2 };
    return (priority[a.status] - priority[b.status])
      || (b.ageDays ?? Number.MAX_SAFE_INTEGER) - (a.ageDays ?? Number.MAX_SAFE_INTEGER)
      || a.host.localeCompare(b.host);
  });

  return {
    generatedAt: new Date(nowTimestamp).toISOString(),
    reviewDays: thresholdDays,
    totalSources: sources.length,
    current: sources.filter(source => source.status === 'current').length,
    due: sources.filter(source => source.status === 'due').length,
    missing: sources.filter(source => source.status === 'missing').length,
    sources,
  };
}
