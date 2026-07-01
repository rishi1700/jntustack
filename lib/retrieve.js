/**
 * Deliberately simple: score documents by overlapping keywords with the
 * query. At a few hundred subjects this beats the complexity (and cost) of
 * embeddings + a vector DB. Revisit only if the corpus grows by an order of
 * magnitude or recall quality actually suffers in practice.
 *
 * No Node-specific imports: this module is pure string/array logic so the SAME
 * file can be imported unchanged in the browser (templates/search-bar.js) and
 * in Node (scripts/build-search-index.js, scripts/retrieve-test.js). Keeping a
 * single copy of the matching logic is deliberate -- the in-page search box and
 * the build-time index must never drift into two different rankings. The Node
 * self-test that used to live here now lives in scripts/retrieve-test.js.
 */
const STOPWORDS = new Set([
  'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'why', 'how',
  'the', 'and', 'for', 'are', 'was', 'were', 'with', 'this', 'that', 'these', 'those',
  'used', 'use', 'does', 'do', 'is', 'are', 'can', 'could', 'should', 'would',
  'about', 'into', 'from', 'have', 'has', 'had', 'will', 'shall', 'not',
]);

export function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

export function scoreDoc(queryTokens, docText) {
  const docTokens = new Set(tokenize(docText));
  let hits = 0;
  for (const t of queryTokens) if (docTokens.has(t)) hits++;
  return hits;
}

const MIN_SCORE = 1; // stopword filtering above is what actually fixes spurious matches; a single overlap on a distinctive term (e.g. a branch code) is legitimate signal

export function buildSearchIndex({ subjects = [], branchProfiles = [], colleges = [] }) {
  const docs = [];

  for (const s of subjects) {
    if (s.source?.status !== 'verified') continue; // never ground answers on unverified content
    const text = [
      s.name, s.branch, s.year_sem_label, s.category,
      ...(s.units || []).flatMap(u => [u.title, ...(u.topics || [])]),
      ...(s.course_outcomes || []),
    ].join(' ');
    docs.push({
      type: 'subject',
      id: s.id,
      url: `/${s.seo?.slug || s.id}/`,
      title: `${s.name} (${s.branch} ${s.year_sem_label}, ${s.regulation})`,
      text,
      summary: {
        regulation: s.regulation, branch: s.branch, year_sem: s.year_sem_label,
        units: s.units, course_outcomes: s.course_outcomes,
      },
    });
  }

  for (const b of branchProfiles) {
    if (b.source?.status !== 'verified') continue;
    const text = [b.branch, b.tagline, ...b.core_focus, ...b.suits_students_who, ...b.career_paths].join(' ');
    docs.push({
      type: 'branch_profile',
      id: `branch-${b.branch}`,
      url: '/branch-guide/',
      title: `${b.branch} branch overview`,
      text,
      summary: b,
    });
  }

  for (const c of colleges) {
    if (c.source?.status !== 'verified') continue;
    const text = [c.name, c.affiliated_to, c.location.city, c.location.district, c.type].join(' ');
    docs.push({
      type: 'college',
      id: `college-${c.short_code}-${c.name}`,
      url: '/colleges/',
      title: c.name,
      text,
      summary: {
        affiliated_to: c.affiliated_to, location: c.location, type: c.type,
        official_website: c.official_website,
        note: c.branches_offered.length === 0 ? 'Specific branches offered at this college are not yet confirmed.' : undefined,
      },
    });
  }

  return docs;
}

export function retrieve(docs, query, topK = 3) {
  const queryTokens = tokenize(query);
  const scored = docs
    .map(d => ({ doc: d, score: scoreDoc(queryTokens, d.text) }))
    .filter(x => x.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
  return scored.map(x => x.doc);
}
