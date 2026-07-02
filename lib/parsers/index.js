function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripTags(value) {
  return cleanText(String(value || '').replace(/<[^>]+>/g, ' '));
}

function textMatches(html, pattern) {
  const matches = [];
  for (const match of html.matchAll(pattern)) {
    const text = stripTags(match[1]);
    if (text) matches.push(text);
  }
  return matches;
}

const registry = new Map();

export function registerParser(parser) {
  if (!parser?.key) throw new Error('Parser key is required.');
  registry.set(parser.key, parser);
}

export function getParser(parserKey) {
  return registry.get(parserKey) || null;
}

export function listParsers() {
  return [...registry.values()].map(parser => ({
    key: parser.key,
    label: parser.label,
    version: parser.version,
    description: parser.description,
    available: parser.available !== false,
    unavailableReason: parser.unavailableReason || '',
    supports: parser.supports || [],
    sourceSpecific: Boolean(parser.sourceSpecific),
  }));
}

export function listParsersForAsset(asset) {
  const contentType = String(asset?.contentType || '').toLowerCase();
  const filename = String(asset?.originalFilename || '').toLowerCase();
  const suggestedKey = String(asset?.discoverySourceParserKey || '').trim();
  return listParsers().filter(parser => {
    if (!parser.supports?.length) return true;
    return parser.supports.some(support => {
      if (support.endsWith('/')) return contentType.startsWith(support);
      if (support.startsWith('.')) return filename.endsWith(support);
      return contentType === support;
    });
  }).map(parser => ({
    ...parser,
    suggested: Boolean(suggestedKey && parser.key === suggestedKey),
  })).sort((a, b) => {
    if (a.suggested !== b.suggested) return a.suggested ? -1 : 1;
    return a.key.localeCompare(b.key);
  });
}

const CATEGORY_LABELS = [
  ['professional elective', 'ProfessionalElective'],
  ['professional core', 'ProfessionalCore'],
  ['open elective', 'OpenElective'],
  ['basic science', 'BasicScience'],
  ['engineering science', 'EngineeringScience'],
  ['skill enhancement', 'SkillEnhancement'],
  ['ability enhancement', 'AbilityEnhancement'],
  ['mandatory non credit', 'MandatoryNonCredit'],
  ['mandatory', 'MandatoryNonCredit'],
  ['honors', 'Honors'],
  ['minor', 'Minor'],
  ['project', 'Project'],
  ['internship', 'Internship'],
  ['lab', 'Lab'],
  ['hsmc', 'HSMC'],
];

function categoryFromText(value) {
  const text = cleanText(value).toLowerCase();
  for (const [label, category] of CATEGORY_LABELS) {
    if (text.includes(label)) return category;
  }
  return undefined;
}

function typeFromText(value) {
  const text = cleanText(value).toLowerCase();
  if (/\b(theory\s*(cum|and|&)\s*lab|integrated\s*lab)\b/.test(text)) return 'theory_cum_lab';
  if (/\b(project)\b/.test(text)) return 'project';
  if (/\b(internship)\b/.test(text)) return 'internship';
  if (/\b(seminar)\b/.test(text)) return 'seminar';
  if (/\b(lab|laboratory|practical)\b/.test(text)) return 'lab';
  if (/\b(theory)\b/.test(text)) return 'theory';
  return undefined;
}

function extractSingle(pattern, text) {
  const match = text.match(pattern);
  return match ? cleanText(match[1]) : undefined;
}

function extractContextValue(text, label) {
  return extractSingle(new RegExp(`\\b${escapeRegex(label)}\\b\\s*[:\\-]\\s*([A-Za-z0-9 ./&_-]{1,80})`, 'i'), text);
}

function extractGlobalContext(text) {
  const regulation = extractContextValue(text, 'Regulation') || extractSingle(/\b(R\d{2})\b/i, text);
  const branch = extractContextValue(text, 'Branch') || extractContextValue(text, 'Department') || extractSingle(/\b(CSE|IT|ECE|EEE|CE|MECH)\b/i, text);
  const yearSem = text.match(/\b([1-4])\s*[-/]\s*([12])\b/);
  const year = extractContextValue(text, 'Year') || yearSem?.[1];
  const semester = extractContextValue(text, 'Semester') || yearSem?.[2];
  return {
    regulation,
    branch,
    year,
    semester,
  };
}

function splitRowsFromHtml(html) {
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(match => textMatches(match[1], /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi))
    .filter(cells => cells.length >= 2);
  if (rows.length) return rows;

  return stripTags(html)
    .split(/\n|\r| {2,}/)
    .map(line => cleanText(line))
    .filter(Boolean)
    .map(line => line.split(/\s{2,}|\t|\|/).map(cleanText).filter(Boolean))
    .filter(cells => cells.length >= 2);
}

function looksLikeSubjectName(value) {
  const text = cleanText(value);
  if (text.length < 4 || text.length > 140) return false;
  if (/^(s\.?no|serial|code|credits?|l|t|p|c|year|semester|branch|regulation)$/i.test(text)) return false;
  if (/^\d+(\.\d+)?$/.test(text)) return false;
  return /[A-Za-z]/.test(text);
}

function candidateFromCells(cells, context, index) {
  const joined = cells.join(' | ');
  const headerLike = cells.filter(cell => /^(s\.?no|serial|code|subject|subject name|category|type|credits?|l|t|p|c)$/i.test(cell)).length;
  if (headerLike >= Math.min(3, cells.length)) return null;
  const subjectName = cells.find(cell => looksLikeSubjectName(cell) && !/^[A-Z]{2,5}\d{2,}/.test(cell));
  if (!subjectName) return null;
  const category = categoryFromText(joined);
  const subjectType = typeFromText(joined);
  const code = cells.find(cell => /^[A-Z]{2,8}[- ]?\d{2,}[A-Z0-9-]*$/i.test(cell));
  return {
    candidate_index: index,
    subject_code: code || null,
    name: subjectName,
    regulation: context.regulation,
    branch: context.branch,
    year: context.year ? Number.parseInt(context.year, 10) : undefined,
    semester: context.semester ? Number.parseInt(context.semester, 10) : undefined,
    year_sem_label: context.year && context.semester ? `${Number.parseInt(context.year, 10)}-${Number.parseInt(context.semester, 10)}` : undefined,
    category,
    type: subjectType,
    evidence: {
      row_text: joined,
      cells,
    },
  };
}

function parseSourceSpecificSubjectIndex({ asset, buffer, parserKey, parserVersion }) {
  const html = buffer.toString('utf-8');
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const text = stripTags(withoutScripts);
  const context = extractGlobalContext(text);
  const rows = splitRowsFromHtml(withoutScripts);
  const candidates = rows
    .map((cells, index) => candidateFromCells(cells, context, index))
    .filter(Boolean)
    .slice(0, 200);

  return {
    parsedPayload: {
      evidence_type: 'source_specific_subject_index',
      evidence_status: 'needs_review',
      source_url: asset.sourceUrl,
      parser_version: parserVersion,
      candidates,
    },
    confidence: {
      parser: parserKey,
      extraction: 'source_specific_subject_index',
      candidate_count: candidates.length,
      requires_human_review: true,
      no_auto_proposal: true,
    },
  };
}

registerParser({
  key: 'html-basic',
  label: 'HTML basic',
  version: '1.0.0',
  description: 'Extracts basic title, headings, links, and text preview from stored HTML.',
  supports: ['text/html', '.html', '.htm'],
  async parse({ asset, buffer }) {
    const html = buffer.toString('utf-8');
    const withoutScripts = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ');
    const title = textMatches(withoutScripts, /<title[^>]*>([\s\S]*?)<\/title>/gi)[0] || '';
    const headings = textMatches(withoutScripts, /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi).slice(0, 50);
    const links = [...withoutScripts.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
      .slice(0, 100)
      .map(match => ({
        href: cleanText(match[1]),
        text: stripTags(match[2]),
      }))
      .filter(link => link.href);
    const text = stripTags(withoutScripts);

    return {
      parsedPayload: {
        evidence_status: 'needs_review',
        asset_id: asset.id,
        source_url: asset.sourceUrl,
        title,
        headings,
        links,
        text_preview: text.slice(0, 5000),
      },
      confidence: {
        parser: 'html-basic',
        extraction: 'basic_markup',
        requires_human_review: true,
      },
    };
  },
});

registerParser({
  key: 'tirumala-syllabus-html',
  label: 'Tirumala syllabus HTML',
  version: '0.1.0',
  description: 'Conservatively extracts subject-index candidates from uploaded Tirumala syllabus HTML/text evidence.',
  supports: ['text/html', '.html', '.htm'],
  sourceSpecific: true,
  async parse({ asset, buffer }) {
    return parseSourceSpecificSubjectIndex({
      asset,
      buffer,
      parserKey: 'tirumala-syllabus-html',
      parserVersion: '0.1.0',
    });
  },
});

registerParser({
  key: 'lbrce-syllabus-html',
  label: 'LBRCE syllabus HTML',
  version: '0.1.0',
  description: 'Source-specific parser interface placeholder for uploaded LBRCE syllabus HTML/text evidence.',
  supports: ['text/html', '.html', '.htm'],
  sourceSpecific: true,
  available: false,
  unavailableReason: 'LBRCE source-specific parsing rules are not implemented yet; parser key is registered for source configuration only.',
  async parse() {
    throw new Error('lbrce-syllabus-html is registered but not implemented yet.');
  },
});

registerParser({
  key: 'pdf-text-basic',
  label: 'PDF text basic',
  version: '0.1.0',
  description: 'PDF parser interface placeholder. No PDF text dependency is installed yet.',
  supports: ['application/pdf', '.pdf'],
  available: false,
  unavailableReason: 'PDF text extraction dependency is not installed; parser is registered for future use only.',
  async parse() {
    throw new Error('pdf-text-basic is registered but unavailable because no PDF text extraction dependency is installed.');
  },
});
