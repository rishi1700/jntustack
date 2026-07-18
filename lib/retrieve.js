/**
 * Deterministic, field-aware retrieval shared by Node and the browser.
 *
 * Keep this module free of Node-specific imports: build scripts, the Express
 * server and the public search bar intentionally execute the same matcher.
 */

const STOPWORDS = new Set([
  'a', 'an', 'about', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'but',
  'by', 'can', 'could', 'did', 'do', 'does', 'for', 'from', 'had', 'has',
  'have', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'may', 'my', 'not',
  'of', 'on', 'or', 'our', 'shall', 'should', 'that', 'the', 'their', 'these',
  'this', 'those', 'to', 'use', 'used', 'was', 'were', 'what', 'when', 'where',
  'which', 'who', 'whom', 'whose', 'why', 'will', 'with', 'would', 'you', 'your',
]);

const FIELD_WEIGHTS = Object.freeze({
  primary: 12,
  metadata: 6,
  headings: 4,
  body: 1,
});

const DEFAULT_BRANCHES = Object.freeze([
  {
    code: 'CSE',
    name: 'Computer Science and Engineering',
    aliases: ['computer science', 'computer science engineering'],
  },
  {
    code: 'IT',
    name: 'Information Technology',
    aliases: ['information technology'],
  },
  {
    code: 'ECE',
    name: 'Electronics and Communication Engineering',
    aliases: ['electronics communication', 'electronics and communication'],
  },
  {
    code: 'EEE',
    name: 'Electrical and Electronics Engineering',
    aliases: ['electrical electronics', 'electrical and electronics'],
  },
  {
    code: 'CE',
    name: 'Civil Engineering',
    aliases: ['civil', 'civil engineering'],
  },
  {
    code: 'MECH',
    name: 'Mechanical Engineering',
    aliases: ['mechanical', 'mechanical engineering'],
  },
]);

const GENERIC_QUERY_TOKENS = new Set([
  'affiliated', 'branch', 'campus', 'choose', 'college', 'compare',
  'constituent', 'course', 'district', 'elective', 'guide', 'overview',
  'pick', 'subject', 'syllabus', 'topic', 'unit', 'versus', 'vs',
]);

const DOC_TOKEN_CACHE = new WeakMap();
const CORPUS_CACHE = new WeakMap();

function textValue(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(textValue).join(' ');
  if (typeof value === 'object') return Object.values(value).map(textValue).join(' ');
  return '';
}

function singularize(token) {
  if (token === 'topics') return 'topic';
  if (token.length <= 3 || token.endsWith('ics') || token.endsWith('is') || token.endsWith('ss') || token.endsWith('us')) {
    return token;
  }
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
  if (/(?:sses|xes|ches|shes|zes)$/.test(token)) return token.slice(0, -2);
  if (token.endsWith('s')) return token.slice(0, -1);
  return token;
}

/**
 * Tokenize while retaining academic identifiers that the old matcher lost:
 * CE, IT, R23 and semester labels such as 1-2. Uppercase is significant only
 * for two-letter branch codes, so ordinary prose uses of "it" stay a stopword.
 */
export function tokenize(value) {
  const source = textValue(value)
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '');
  const lexemes = source.match(/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/g) || [];
  const tokens = [];

  for (const lexeme of lexemes) {
    const parts = /^\d-\d$/.test(lexeme) ? [lexeme] : lexeme.split('-');
    for (const raw of parts) {
      const academicCode = /^(?:CE|CSE|ECE|EEE|IT|MECH|R\d{2,3})$/.test(raw);
      const lower = raw.toLowerCase();
      if (STOPWORDS.has(lower) && !academicCode) continue;
      if (lower.length < 3 && !academicCode && !/^\d-\d$/.test(lower)) continue;
      tokens.push(singularize(lower));
    }
  }

  return tokens;
}

function normalizedPhrase(value) {
  return tokenize(value).join(' ');
}

function phraseContains(haystack, needle) {
  return Boolean(needle) && (` ${haystack} `).includes(` ${needle} `);
}

function unique(values) {
  return [...new Set(values.filter(value => value != null && value !== ''))];
}

function branchDefinitions(branches = []) {
  const suppliedByCode = new Map(
    branches
      .filter(branch => branch?.code)
      .map(branch => [String(branch.code).toUpperCase(), branch])
  );
  return DEFAULT_BRANCHES.map(fallback => {
    const supplied = suppliedByCode.get(fallback.code) || {};
    return {
      code: fallback.code,
      name: supplied.name || fallback.name,
      aliases: unique([...(fallback.aliases || []), ...(supplied.aliases || [])]),
    };
  });
}

function branchName(code, branches) {
  return branches.find(branch => branch.code === String(code || '').toUpperCase())?.name || code;
}

function branchCodesFrom(value) {
  if (Array.isArray(value?.branchCodes) && value.branchCodes.length) return value.branchCodes;
  if (Array.isArray(value?.branches) && value.branches.length) {
    return value.branches.map(branch => typeof branch === 'string' ? branch : branch?.code);
  }
  if (value?.branch) return [value.branch];
  return [];
}

function yearSemester(value, fallback = {}) {
  const label = value?.year_sem_label || value?.yearSem || value?.year_sem;
  if (label) return String(label).replace('/', '-');
  const year = value?.year ?? fallback.year;
  const semester = value?.semester ?? fallback.semester;
  return year && semester ? `${year}-${semester}` : '';
}

function subjectContexts(subject) {
  const offerings = Array.isArray(subject.offerings) && subject.offerings.length
    ? subject.offerings
    : [subject];
  const contexts = [];

  for (const offering of offerings) {
    const branches = branchCodesFrom(offering).length
      ? branchCodesFrom(offering)
      : branchCodesFrom(subject);
    const common = {
      regulation: String(offering.regulation || subject.regulation || '').toUpperCase(),
      yearSem: yearSemester(offering, subject),
    };
    for (const branch of branches) {
      if (!branch) continue;
      contexts.push({ ...common, branch: String(branch).toUpperCase() });
    }
    if (!branches.length) contexts.push(common);
  }

  return dedupeContexts(contexts);
}

function expandContexts(values = [], fallback = {}) {
  const result = [];
  for (const value of values) {
    const branches = branchCodesFrom(value);
    const common = {
      regulation: String(value?.regulation || fallback.regulation || '').toUpperCase(),
      yearSem: yearSemester(value, fallback),
      district: value?.district || fallback.district || '',
      city: value?.city || fallback.city || '',
      collegeType: value?.collegeType || value?.type || fallback.collegeType || '',
      affiliatedTo: value?.affiliatedTo || value?.affiliated_to || fallback.affiliatedTo || '',
    };
    if (branches.length) {
      for (const branch of branches) result.push({ ...common, branch: String(branch).toUpperCase() });
    } else {
      result.push({ ...common, branch: value?.branch ? String(value.branch).toUpperCase() : '' });
    }
  }
  return dedupeContexts(result);
}

function dedupeContexts(contexts) {
  const seen = new Set();
  return contexts.filter(context => {
    const key = JSON.stringify(context);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function subjectTitle(subject, contexts) {
  const placements = unique(contexts.map(context => [context.branch, context.yearSem].filter(Boolean).join(' ')));
  const placement = placements.join(' / ') || 'JNTUK';
  return `${subject.name} (${placement}${subject.regulation ? `, ${subject.regulation}` : ''})`;
}

function isVerified(item) {
  return item?.source?.status === 'verified';
}

function publicationMode(subject) {
  return subject?.publication?.mode || 'page';
}

function isInternshipListing(subject) {
  return publicationMode(subject) === 'listing_only'
    && (subject?.type === 'internship'
      || subject?.category === 'Internship'
      || /(?:internship|community service project|semester project)/i.test(subject?.name || ''));
}

function guideUrl(guide) {
  const explicit = guide?.url;
  if (explicit) return explicit.startsWith('/') ? explicit : `/${explicit}`;
  const slug = guide?.seo?.slug || guide?.slug || guide?.id;
  return slug ? `/${String(slug).replace(/^\/+|\/+$/g, '')}/` : '';
}

function guideMatchesListing(guide, listing) {
  const url = guideUrl(guide);
  const listingUrl = listing?.publication?.listing_url;
  if (listingUrl && url) return String(listingUrl).split('#')[0].replace(/\/+$/, '/') === url.replace(/\/+$/, '/');
  return /(?:internship|project)/i.test([
    guide?.id, guide?.slug, guide?.title, guide?.name, guide?.seo?.slug,
  ].filter(Boolean).join(' '));
}

/**
 * Build public search documents. Only verified page-mode subjects are indexed;
 * verified listing-only internship milestones contribute aliases and atomic
 * contexts to the single internship guide instead of creating duplicate hits.
 */
export function buildSearchIndex({
  subjects = [],
  branches = [],
  branchProfiles = [],
  colleges = [],
  guides = [],
} = {}) {
  const docs = [];
  const branchDefs = branchDefinitions(branches);
  const verifiedListings = subjects.filter(subject => isVerified(subject) && publicationMode(subject) === 'listing_only');

  for (const subject of subjects) {
    if (!isVerified(subject) || publicationMode(subject) !== 'page') continue;
    const contexts = subjectContexts(subject);
    const branchCodes = unique(contexts.map(context => context.branch));
    const branchMetadata = branchCodes.flatMap(code => [code, branchName(code, branchDefs)]);
    const semesterMetadata = unique(contexts.map(context => context.yearSem));
    const headings = (subject.units || []).map(unit => unit?.title);
    const body = [
      ...(subject.units || []).flatMap(unit => unit?.topics || []),
      ...(subject.course_outcomes || []),
      subject.notes,
    ];

    docs.push({
      type: 'subject',
      id: subject.id,
      url: `/${subject.seo?.slug || subject.id}/`,
      title: subjectTitle(subject, contexts),
      fields: {
        primary: subject.name,
        metadata: [
          subject.subject_code,
          subject.regulation,
          subject.category,
          subject.type,
          subject.specialization,
          subject.seo?.title,
          ...(subject.aliases || []),
          ...branchMetadata,
          ...semesterMetadata,
        ],
        headings,
        body,
      },
      contexts,
      summary: {
        regulation: subject.regulation,
        branches: branchCodes,
        offerings: contexts,
        units: subject.units,
        course_outcomes: subject.course_outcomes,
      },
    });
  }

  for (const profile of branchProfiles) {
    if (!isVerified(profile)) continue;
    const code = String(profile.branch || '').toUpperCase();
    const fullName = branchName(code, branchDefs);
    docs.push({
      type: 'branch_profile',
      id: `branch-${code}`,
      url: profile.url || '/branch-guide/',
      title: `${code} branch overview`,
      fields: {
        primary: [code, fullName],
        metadata: [profile.tagline, 'branch overview career guide', ...(profile.related_branches || [])],
        headings: profile.core_focus || [],
        body: [
          ...(profile.suits_students_who || []),
          ...(profile.less_good_fit_if || []),
          ...(profile.career_paths || []),
          ...(profile.further_study_paths || []),
        ],
      },
      contexts: [{ branch: code }],
      summary: profile,
    });
  }

  for (const college of colleges) {
    if (!isVerified(college)) continue;
    const context = {
      district: college.location?.district || '',
      city: college.location?.city || '',
      collegeType: college.type || '',
      affiliatedTo: college.affiliated_to || '',
    };
    docs.push({
      type: 'college',
      id: `college-${college.short_code}-${college.name}`,
      url: college.url || '/colleges/',
      title: college.name,
      fields: {
        primary: college.name,
        metadata: [
          college.short_code,
          college.affiliated_to,
          college.location?.city,
          college.location?.district,
          college.location?.state,
          college.type,
        ],
        headings: college.branches_offered || [],
        body: college.notes,
      },
      contexts: [context],
      summary: {
        affiliated_to: college.affiliated_to,
        location: college.location,
        type: college.type,
        official_website: college.official_website,
        note: college.branches_offered?.length === 0
          ? 'Specific branches offered at this college are not yet confirmed.'
          : undefined,
      },
    });
  }

  for (const guide of guides) {
    if (!isVerified(guide)) continue;
    const url = guideUrl(guide);
    if (!url) continue;
    const relatedListings = verifiedListings.filter(listing => isInternshipListing(listing) && guideMatchesListing(guide, listing));
    const directContexts = Array.isArray(guide.contexts) ? expandContexts(guide.contexts, guide) : [];
    const legacyContexts = directContexts.length
      ? []
      : expandContexts(branchCodesFrom(guide).length || guide.year || guide.semester ? [guide] : [], guide);
    const listingContexts = relatedListings.flatMap(subjectContexts);
    const contexts = dedupeContexts([...directContexts, ...legacyContexts, ...listingContexts]);
    const sections = guide.sections || [];
    const displayTitle = guide.title || guide.name || guide.seo?.title || guide.id;
    docs.push({
      type: 'guide',
      id: guide.id,
      url,
      title: displayTitle,
      fields: {
        primary: displayTitle,
        metadata: [
          guide.regulation,
          guide.category,
          ...(guide.tags || []),
          ...(guide.aliases || []),
          ...relatedListings.flatMap(listing => [listing.name, listing.category, listing.type, ...(listing.aliases || [])]),
        ],
        headings: sections.map(section => section?.title),
        body: sections.flatMap(section => [section?.body, section?.content, section?.paragraphs, section?.items]),
      },
      contexts,
      summary: {
        regulation: guide.regulation,
        sections,
        source: guide.source,
      },
    });
  }

  return docs;
}

function fieldsFor(doc) {
  if (DOC_TOKEN_CACHE.has(doc)) return DOC_TOKEN_CACHE.get(doc);
  const fields = {};
  for (const field of Object.keys(FIELD_WEIGHTS)) {
    const value = doc?.fields?.[field] ?? (field === 'body' ? doc?.text : '');
    fields[field] = new Set(tokenize(value));
  }
  DOC_TOKEN_CACHE.set(doc, fields);
  return fields;
}

function corpusFor(docs) {
  if (CORPUS_CACHE.has(docs)) return CORPUS_CACHE.get(docs);
  const documentFrequency = new Map();
  for (const doc of docs) {
    const allTokens = new Set(Object.values(fieldsFor(doc)).flatMap(tokens => [...tokens]));
    for (const token of allTokens) {
      documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
    }
  }
  const corpus = { size: docs.length, documentFrequency };
  CORPUS_CACHE.set(docs, corpus);
  return corpus;
}

function idf(corpus, token) {
  const df = corpus.documentFrequency.get(token) || 0;
  return Math.log(1 + ((corpus.size + 1) / (df + 1)));
}

/** Backward-compatible overlap helper retained for callers outside retrieve(). */
export function scoreDoc(queryTokens, docText) {
  const docTokens = new Set(tokenize(docText));
  return unique(queryTokens).reduce((score, token) => score + (docTokens.has(token) ? 1 : 0), 0);
}

function branchesInQuery(query) {
  const original = String(query || '');
  const normalized = original.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  const lowerItIsAcademic = /\bit\b/.test(normalized)
    && (/\bR\d{2,3}\b/i.test(original)
      || /\b[1-9]\s*[-/]\s*[1-9]\b/.test(original)
      || /\b(?:branch|course|subject|syllabus)\b/i.test(original));
  const result = [];
  for (const branch of DEFAULT_BRANCHES) {
    const codePattern = branch.code === 'IT'
      ? /\bIT\b/.test(original) || lowerItIsAcademic
      : new RegExp(`\\b${branch.code.toLowerCase()}\\b`).test(normalized);
    const aliasMatch = [branch.name, ...(branch.aliases || [])]
      .map(alias => alias.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
      .some(alias => phraseContains(normalized, alias));
    if (codePattern || aliasMatch) result.push(branch.code);
  }
  return result;
}

function contextValues(docs, key) {
  return unique(docs.flatMap(doc => (doc.contexts || []).map(context => context?.[key])));
}

function mentionedValues(query, values) {
  const normalized = normalizedPhrase(query);
  return values
    .map(value => ({ value, phrase: normalizedPhrase(value) }))
    .filter(item => item.phrase && phraseContains(normalized, item.phrase))
    .sort((a, b) => b.phrase.length - a.phrase.length)
    .map(item => item.value);
}

function queryFilters(docs, query) {
  const regulations = unique([...String(query || '').matchAll(/\bR\d{2,3}\b/gi)].map(match => match[0].toUpperCase()));
  const yearSems = unique([...String(query || '').matchAll(/\b([1-9])\s*[-/]\s*([1-9])\b/g)].map(match => `${match[1]}-${match[2]}`));
  return {
    branches: branchesInQuery(query),
    regulations,
    yearSems,
    districts: mentionedValues(query, contextValues(docs, 'district')),
    cities: mentionedValues(query, contextValues(docs, 'city')),
    collegeTypes: mentionedValues(query, contextValues(docs, 'collegeType')),
    affiliations: mentionedValues(query, contextValues(docs, 'affiliatedTo')),
  };
}

function queryIntent(query, filters) {
  const normalized = String(query || '').toLowerCase();
  if (/\binternship\b|\bcommunity service project\b|\bindustry mini project\b/.test(normalized)) return 'guide';
  if (/\bcolleges?\b|\bdistrict\b|\bconstituent\b|\baffiliated\b|\bcampus\b/.test(normalized)) return 'college';
  if (/\bchoose\b|\bcompare\b|\bversus\b|\bvs\.?\b|\bwhich branch\b|\bbranch overview\b|\bcareer paths?\b/.test(normalized)) return 'branch_profile';
  if (/\bsubjects?\b|\bsyllabus\b|\bcourses?\b|\bunits?\b|\btopics?\b|\blabs?\b|\belectives?\b/.test(normalized)
      || filters.regulations.length || filters.yearSems.length) return 'subject';
  return null;
}

function legacyContexts(doc) {
  if (Array.isArray(doc.contexts) && doc.contexts.length) return doc.contexts;
  if (doc.type === 'subject') {
    const branches = String(doc.summary?.branch || '').split('/').filter(Boolean);
    return branches.map(branch => ({
      branch: branch.toUpperCase(),
      regulation: String(doc.summary?.regulation || '').toUpperCase(),
      yearSem: doc.summary?.year_sem || '',
    }));
  }
  if (doc.type === 'branch_profile') return [{ branch: String(doc.summary?.branch || '').toUpperCase() }];
  if (doc.type === 'college') {
    return [{
      district: doc.summary?.location?.district || '',
      city: doc.summary?.location?.city || '',
      collegeType: doc.summary?.type || '',
      affiliatedTo: doc.summary?.affiliated_to || '',
    }];
  }
  return [];
}

function valueMatches(actual, requested, { upper = false } = {}) {
  if (!requested.length) return true;
  const candidate = upper ? String(actual || '').toUpperCase() : normalizedPhrase(actual);
  return requested.some(value => candidate === (upper ? String(value).toUpperCase() : normalizedPhrase(value)));
}

function matchesFilters(doc, filters) {
  const contexts = legacyContexts(doc);
  const academicFiltersPresent = filters.branches.length || filters.regulations.length || filters.yearSems.length;
  if (academicFiltersPresent) {
    if (!['subject', 'branch_profile', 'guide'].includes(doc.type)) return false;
    const atomicMatch = contexts.some(context =>
      valueMatches(context.branch, filters.branches, { upper: true })
      && valueMatches(context.regulation, filters.regulations, { upper: true })
      && valueMatches(context.yearSem, filters.yearSems)
    );
    if (!atomicMatch) return false;
  }

  const collegeFiltersPresent = filters.districts.length || filters.cities.length
    || filters.collegeTypes.length || filters.affiliations.length;
  if (collegeFiltersPresent) {
    if (doc.type !== 'college') return false;
    const collegeMatch = contexts.some(context =>
      valueMatches(context.district, filters.districts)
      && valueMatches(context.city, filters.cities)
      && valueMatches(context.collegeType, filters.collegeTypes)
      && valueMatches(context.affiliatedTo, filters.affiliations)
    );
    if (!collegeMatch) return false;
  }

  return true;
}

function coreQueryPhrase(query, filters) {
  const removal = new Set(GENERIC_QUERY_TOKENS);
  for (const value of [
    ...filters.branches,
    ...filters.regulations,
    ...filters.yearSems,
    ...filters.districts,
    ...filters.cities,
    ...filters.collegeTypes,
    ...filters.affiliations,
  ]) {
    for (const token of tokenize(value)) removal.add(token);
  }
  for (const code of filters.branches) {
    const branch = DEFAULT_BRANCHES.find(item => item.code === code);
    for (const token of tokenize([branch?.name, ...(branch?.aliases || [])])) removal.add(token);
  }
  return tokenize(query).filter(token => !removal.has(token)).join(' ');
}

function scoreDocument(doc, queryTokens, corePhrase, corpus) {
  const fields = fieldsFor(doc);
  let lexicalScore = 0;
  for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
    for (const token of queryTokens) {
      if (fields[field].has(token)) lexicalScore += weight * idf(corpus, token);
    }
  }
  if (lexicalScore <= 0) return 0;

  const primaryPhrase = normalizedPhrase(doc?.fields?.primary ?? doc?.title);
  let phraseBonus = 0;
  if (corePhrase && primaryPhrase === corePhrase) phraseBonus = 100;
  else if (corePhrase && phraseContains(primaryPhrase, corePhrase)) phraseBonus = 40;
  return lexicalScore + phraseBonus;
}

function compareStrings(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * Return the best matching documents. Stable ordering is score descending,
 * then title ascending, then ID ascending.
 */
export function retrieve(docs, query, topK = 3) {
  if (!Array.isArray(docs) || !String(query || '').trim() || topK <= 0) return [];
  const queryTokens = unique(tokenize(query));
  if (!queryTokens.length) return [];

  const filters = queryFilters(docs, query);
  const intent = queryIntent(query, filters);
  const corePhrase = coreQueryPhrase(query, filters);
  const corpus = corpusFor(docs);

  return docs
    .filter(doc => !intent || doc.type === intent)
    .filter(doc => matchesFilters(doc, filters))
    .map(doc => {
      const lexicalScore = scoreDocument(doc, queryTokens, corePhrase, corpus);
      return {
        doc,
        // When a subject query does not name a regulation, prefer the current
        // R23 result only as a sub-point tie breaker. Explicit R16/R23 filters
        // are handled above and the documented lexical weights remain dominant.
        score: lexicalScore > 0
          ? lexicalScore + (!filters.regulations.length && doc.type === 'subject' && doc.summary?.regulation === 'R23' ? 0.001 : 0)
          : 0,
      };
    })
    .filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score
      || compareStrings(a.doc.title, b.doc.title)
      || compareStrings(a.doc.id, b.doc.id))
    .slice(0, Math.floor(topK))
    .map(result => result.doc);
}
