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

const MAX_PDF_BYTES = 30 * 1024 * 1024;

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

function rowsFromHtml(html) {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(match => textMatches(match[1], /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi))
    .filter(cells => cells.length >= 2);
}

function splitRowsFromText(html) {
  return stripTags(html)
    .split(/\n|\r| {2,}/)
    .map(line => cleanText(line))
    .filter(Boolean)
    .map(line => line.split(/\s{2,}|\t|\|/).map(cleanText).filter(Boolean))
    .filter(cells => cells.length >= 2);
}

function extractTables(html) {
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)]
    .map((match, tableIndex) => ({
      tableIndex,
      rows: rowsFromHtml(match[1]),
      text: stripTags(match[1]),
    }))
    .filter(table => table.rows.length);
  if (tables.length) return tables;
  const rows = splitRowsFromText(html);
  return rows.length ? [{ tableIndex: 0, rows, text: stripTags(html), textFallback: true }] : [];
}

const IGNORE_TABLE_PATTERNS = [
  /\b(contact|address|phone|mobile|email|fax|enquiry|location|map)\b/i,
  /\b(staff|faculty|designation|qualification|experience|profile|hod|principal)\b/i,
  /\b(menu|navigation|quick links|important links|copyright|login|search)\b/i,
  /\b(admission|placement|gallery|alumni|about us|vision|mission)\b/i,
];

const SUBJECT_HEADER_PATTERNS = [
  /\b(subject|subject name|course title|course name|paper title)\b/i,
  /\b(subject code|course code|paper code|code)\b/i,
  /\b(category|course category)\b/i,
  /\b(type|course type)\b/i,
  /\b(credits?|l\s*t\s*p\s*c|ltpc)\b/i,
  /\b(year|semester|sem)\b/i,
  /\b(regulation|scheme|syllabus)\b/i,
];

function headerKind(cell) {
  const text = cleanText(cell).toLowerCase();
  if (/^(s\.?no|serial|sl\.? ?no\.?|#)$/.test(text)) return 'serial';
  if (/^(subject|subject name|course title|course name|paper title)$/.test(text)) return 'subject';
  if (/^(subject code|course code|paper code|code)$/.test(text)) return 'code';
  if (/^(category|course category)$/.test(text)) return 'category';
  if (/^(type|course type)$/.test(text)) return 'type';
  if (/^(credits?|c)$/.test(text)) return 'credits';
  if (/^(l|t|p|ltpc|l\/t\/p\/c)$/.test(text)) return 'ltpc';
  if (/^(year)$/.test(text)) return 'year';
  if (/^(semester|sem)$/.test(text)) return 'semester';
  return null;
}

function headerScore(cells) {
  return cells.reduce((score, cell) => score + (headerKind(cell) ? 1 : 0), 0);
}

function buildHeaderMap(rows) {
  let headerRowIndex = -1;
  let bestScore = 0;
  rows.slice(0, 3).forEach((cells, index) => {
    const score = headerScore(cells);
    if (score > bestScore) {
      bestScore = score;
      headerRowIndex = index;
    }
  });
  if (bestScore < 2) return { headerRowIndex: -1, indexes: {}, score: bestScore };

  const indexes = {};
  rows[headerRowIndex].forEach((cell, index) => {
    const kind = headerKind(cell);
    if (kind && indexes[kind] == null) indexes[kind] = index;
  });
  return { headerRowIndex, indexes, score: bestScore };
}

function tableSignals(table, headerMap) {
  const text = cleanText(table.text);
  const signals = [];
  for (const pattern of SUBJECT_HEADER_PATTERNS) {
    if (pattern.test(text)) signals.push(pattern.source);
  }
  const ignoreSignals = IGNORE_TABLE_PATTERNS
    .filter(pattern => pattern.test(text))
    .map(pattern => pattern.source);
  return {
    subjectSignals: signals,
    ignoreSignals,
    hasSubjectHeader: headerMap.indexes.subject != null,
    hasCodeHeader: headerMap.indexes.code != null,
    hasCategoryOrTypeHeader: headerMap.indexes.category != null || headerMap.indexes.type != null,
    hasCreditHeader: headerMap.indexes.credits != null || headerMap.indexes.ltpc != null,
  };
}

function classifyTable(table, headerMap) {
  const signals = tableSignals(table, headerMap);
  const strongSubjectStructure = signals.hasSubjectHeader && (
    signals.hasCodeHeader || signals.hasCategoryOrTypeHeader || signals.hasCreditHeader || headerMap.score >= 3
  );
  if (strongSubjectStructure) {
    return {
      kind: 'subject_like',
      reason: 'Table headers clearly include subject/course data columns.',
      signals,
    };
  }
  if (signals.ignoreSignals.length && signals.subjectSignals.length < 2) {
    return {
      kind: 'ignored',
      reason: 'Table looks like contact, staff, navigation, or general site information rather than syllabus data.',
      signals,
    };
  }
  if (signals.subjectSignals.length >= 2 && !table.textFallback) {
    return {
      kind: 'low_confidence',
      reason: 'Table mentions syllabus-like terms but does not expose clear subject/course columns.',
      signals,
    };
  }
  return {
    kind: 'ignored',
    reason: table.textFallback
      ? 'Text rows were not inside a clear subject table.'
      : 'Table does not clearly match subject syllabus data.',
    signals,
  };
}

function looksLikeSubjectName(value) {
  const text = cleanText(value);
  if (text.length < 4 || text.length > 140) return false;
  if (/^(s\.?no|serial|code|credits?|l|t|p|c|year|semester|branch|regulation)$/i.test(text)) return false;
  if (IGNORE_TABLE_PATTERNS.some(pattern => pattern.test(text))) return false;
  if (/^\d+(\.\d+)?$/.test(text)) return false;
  return /[A-Za-z]/.test(text);
}

function cellAt(cells, index) {
  if (index == null) return undefined;
  return cells[index];
}

function subjectNameFromCells(cells, headerMap) {
  const headerSubject = cellAt(cells, headerMap.indexes.subject);
  if (looksLikeSubjectName(headerSubject)) return headerSubject;
  return cells.find(cell => looksLikeSubjectName(cell) && !/^[A-Z]{2,8}[- ]?\d{2,}[A-Z0-9-]*$/i.test(cell));
}

function hasCreditsOrLtpc(cells, headerMap) {
  const creditCell = cellAt(cells, headerMap.indexes.credits);
  if (creditCell && /^\d+(\.\d+)?$/.test(cleanText(creditCell))) return true;
  if (headerMap.indexes.ltpc != null) return true;
  return false;
}

function candidateFromCells(cells, context, index, table, headerMap) {
  const joined = cells.join(' | ');
  const headerLike = cells.filter(cell => headerKind(cell)).length;
  if (headerLike >= Math.min(3, cells.length)) return null;
  if (IGNORE_TABLE_PATTERNS.some(pattern => pattern.test(joined)) && headerMap.indexes.subject == null) return null;
  const subjectName = subjectNameFromCells(cells, headerMap);
  if (!subjectName) return null;
  const category = categoryFromText(joined);
  const subjectType = typeFromText(joined);
  const code = cellAt(cells, headerMap.indexes.code) || cells.find(cell => /^[A-Z]{2,8}[- ]?\d{2,}[A-Z0-9-]*$/i.test(cell));
  const hasStrongColumnEvidence = Boolean(code || category || subjectType || hasCreditsOrLtpc(cells, headerMap));
  const level = table.kind === 'subject_like' && hasStrongColumnEvidence ? 'high' : 'low';
  const reason = level === 'high'
    ? 'Row is inside a subject-like table and includes a subject name plus code, category/type, or credit/LTPC evidence.'
    : 'Row has a possible subject name but lacks enough code/category/type/credit structure for high confidence.';
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
      table_index: table.tableIndex,
      table_reason: table.reason,
    },
    confidence: {
      level,
      reason,
      signals: [
        table.reason,
        code ? 'subject/course code present' : '',
        category ? 'category label present' : '',
        subjectType ? 'type label present' : '',
        hasCreditsOrLtpc(cells, headerMap) ? 'credit or LTPC columns present' : '',
      ].filter(Boolean),
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
  const tables = extractTables(withoutScripts);
  const candidates = [];
  const lowConfidenceCandidates = [];
  const ignoredTableRows = [];

  for (const rawTable of tables) {
    const headerMap = buildHeaderMap(rawTable.rows);
    const table = {
      ...rawTable,
      ...classifyTable(rawTable, headerMap),
    };
    rawTable.rows.forEach((cells, rowIndex) => {
      if (rowIndex === headerMap.headerRowIndex) return;
      if (table.kind === 'ignored') {
        ignoredTableRows.push({
          table_index: table.tableIndex,
          row_index: rowIndex,
          reason: table.reason,
          cells,
          row_text: cells.join(' | '),
        });
        return;
      }
      const candidate = candidateFromCells(cells, context, rowIndex, table, headerMap);
      if (candidate?.confidence?.level === 'high') {
        candidates.push(candidate);
        return;
      }
      if (candidate) {
        lowConfidenceCandidates.push(candidate);
        return;
      }
      if (table.kind !== 'subject_like') {
        ignoredTableRows.push({
          table_index: table.tableIndex,
          row_index: rowIndex,
          reason: table.reason,
          cells,
          row_text: cells.join(' | '),
        });
      }
    });
  }

  return {
    parsedPayload: {
      evidence_type: 'source_specific_subject_index',
      evidence_status: 'needs_review',
      source_url: asset.sourceUrl,
      parser_version: parserVersion,
      candidates: candidates.slice(0, 200),
      low_confidence_candidates: lowConfidenceCandidates.slice(0, 200),
      ignored_table_rows: ignoredTableRows.slice(0, 200),
    },
    confidence: {
      parser: parserKey,
      extraction: 'source_specific_subject_index',
      candidate_count: candidates.length,
      low_confidence_candidate_count: lowConfidenceCandidates.length,
      ignored_table_row_count: ignoredTableRows.length,
      requires_human_review: true,
      no_auto_proposal: true,
      candidate_rule: 'Only rows in clearly subject-like tables with code/category/type/credit evidence are high-confidence candidates.',
    },
  };
}

function assertPdfAsset({ asset, buffer }) {
  const contentType = String(asset?.contentType || '').toLowerCase();
  const filename = String(asset?.originalFilename || asset?.sourceUrl || '').toLowerCase();
  if (!contentType.includes('pdf') && !filename.endsWith('.pdf')) {
    throw new Error('PDF parser can only run against stored PDF source assets.');
  }
  if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) {
    throw new Error('PDF parser requires a binary asset buffer.');
  }
  if (buffer.length > MAX_PDF_BYTES) {
    throw new Error(`PDF is too large. Limit is ${MAX_PDF_BYTES} bytes.`);
  }
}

function normalizePdfLine(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function extractPdfText({ asset, buffer, parserKey, parserVersion }) {
  assertPdfAsset({ asset, buffer });
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const extracted = await extractText(pdf, { mergePages: false });
  const pageTexts = (Array.isArray(extracted.text) ? extracted.text : [extracted.text])
    .map(text => String(text || '').replace(/\r\n/g, '\n').trim());
  const fullText = pageTexts.join('\n\n').trim();
  return {
    parsedPayload: {
      evidence_type: 'pdf_text',
      evidence_status: 'needs_review',
      asset_id: asset.id,
      source_url: asset.sourceUrl,
      parser_version: parserVersion,
      page_count: extracted.totalPages || pageTexts.length,
      page_texts: pageTexts,
      text_preview: fullText.slice(0, 5000),
      full_text_length: fullText.length,
    },
    confidence: {
      parser: parserKey,
      extraction: 'pdf_text',
      page_count: extracted.totalPages || pageTexts.length,
      requires_human_review: true,
      no_auto_proposal: true,
    },
  };
}

function romanToNumber(value) {
  const text = cleanText(value).toUpperCase();
  if (text === 'I') return 1;
  if (text === 'II') return 2;
  if (text === 'III') return 3;
  if (text === 'IV') return 4;
  return undefined;
}

function extractPdfContext({ asset, fullText }) {
  const locatorText = cleanText([
    asset?.originalFilename,
    asset?.sourceUrl,
  ].filter(Boolean).join(' '));
  const contentText = cleanText(fullText.slice(0, 1500));
  const haystack = cleanText([locatorText, contentText].join(' '));
  const regulation = /\bR23\b/i.test(haystack) ? 'R23' : undefined;
  let branch;
  if (/\b(AIML|AI\s*&\s*ML|AI\s+AND\s+ML|AI&DS)\b|ARTIFICIAL%20INTELLIGENCE|DATA%20SCIENCE/i.test(locatorText)) branch = undefined;
  else if (/\bCSE\b|COMPUTER SCIENCE\s*&?\s*ENGINEERING|COMPUTER SECIENCE\s*&?\s*ENGINEERING/i.test(haystack)) branch = 'CSE';
  else if (/\bIT\b|INFORMATION TECHNOLOGY/i.test(haystack)) branch = 'IT';
  else if (/\bECE\b|ELECTRONICS AND COMMUNICATION/i.test(haystack)) branch = 'ECE';
  else if (/\bEEE\b|ELECTRICAL AND ELECTRONICS/i.test(haystack)) branch = 'EEE';
  else if (/\bCIVIL\b|\bCE\b/i.test(haystack)) branch = 'CE';
  else if (/\bMECH\b|MECHANICAL/i.test(haystack)) branch = 'MECH';
  return { regulation, branch };
}

function parseSemesterHeading(line) {
  const text = normalizePdfLine(line);
  const match = text.match(/\b(?:B\.?\s*Tech\.?\s*)?[-. ]*([IV]{1,3}|1st|2nd|3rd|4th|[1-4])\s+Year\s*[-–—]?\s*([IV]{1,2}|1st|2nd|[12])\s+Semester\b/i);
  if (!match) return null;
  const yearToken = match[1].toUpperCase();
  const semesterToken = match[2].toUpperCase();
  const year = romanToNumber(yearToken)
    || ({ '1ST': 1, '2ND': 2, '3RD': 3, '4TH': 4 }[yearToken])
    || Number.parseInt(yearToken, 10);
  const semester = romanToNumber(semesterToken)
    || ({ '1ST': 1, '2ND': 2 }[semesterToken])
    || Number.parseInt(semesterToken, 10);
  if (!year || !semester) return null;
  return {
    year,
    semester,
    year_sem_label: `${year}-${semester}`,
    heading: text,
  };
}

function parsePdfNumber(value) {
  const text = normalizePdfLine(value);
  if (!text || text === '-') return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function titleBasedBsHCategory(title) {
  const text = cleanText(title).toLowerCase();
  if (/\b(human values|ethic|constitution|managerial|economics|communication skills?)\b/.test(text)) {
    return { category: 'HSMC', reason: 'BS&H label mapped to HSMC from clear humanities/management title terms.' };
  }
  if (/\b(mathematics|math|statistics|probability|physics|chemistry|biology)\b/.test(text)) {
    return { category: 'BasicScience', reason: 'BS&H label mapped to BasicScience from clear science/mathematics title terms.' };
  }
  return { category: undefined, reason: 'BS&H label is ambiguous without clear title terms.' };
}

function categoryAndTitleFromCourseText(value) {
  const text = normalizePdfLine(value);
  const rules = [
    [/^(HSMC)\s+(.+)$/i, 'HSMC', 'HSMC maps directly to HSMC.'],
    [/^(BS)\s+(.+)$/i, 'BasicScience', 'BS maps directly to BasicScience.'],
    [/^(Professional Core)\s+(.+)$/i, 'ProfessionalCore', 'Professional Core maps directly to ProfessionalCore.'],
    [/^(Professional Elective(?:-\s*[IVX]+)?)\s+(.+)$/i, 'ProfessionalElective', 'Professional Elective maps directly to ProfessionalElective.'],
    [/^(Open Elective(?:-\s*[IVX]+)?)\s+(.+)$/i, 'OpenElective', 'Open Elective maps directly to OpenElective.'],
    [/^(Skill Enhancement(?: Course)?)\s+(.+)$/i, 'SkillEnhancement', 'Skill Enhancement maps directly to SkillEnhancement.'],
    [/^(Audit Course)\s+(.+)$/i, 'MandatoryNonCredit', 'Audit Course maps to MandatoryNonCredit.'],
    [/^(Management Course(?:-\s*[IVX]+)?)\s+(.+)$/i, 'HSMC', 'Management Course maps to HSMC.'],
    [/^(Engineering Science)\s+(.+)$/i, 'EngineeringScience', 'Engineering Science maps directly to EngineeringScience.'],
    [/^(Basic Science(?:s)?(?:\s*&\s*Humanities)?)\s+(.+)$/i, 'BasicScience', 'Basic Science maps directly to BasicScience.'],
  ];
  for (const [pattern, category, reason] of rules) {
    const match = text.match(pattern);
    if (match) {
      return {
        rawCategory: match[1],
        title: cleanText(match[2]),
        category,
        categoryReason: reason,
      };
    }
  }

  const mixedScience = text.match(/^(Engineering Science\s*\/\s*Basic Science)\s+(.+)$/i);
  if (mixedScience) {
    const title = cleanText(mixedScience[2]);
    const science = titleBasedBsHCategory(title);
    return {
      rawCategory: mixedScience[1],
      title,
      category: science.category || 'BasicScience',
      categoryReason: science.category
        ? `Mixed Engineering Science/Basic Science label resolved by title: ${science.reason}`
        : 'Mixed Engineering Science/Basic Science label is ambiguous; defaulted to BasicScience for review.',
      ambiguous: !science.category,
    };
  }

  const bsh = text.match(/^(BS&H)\s+(.+)$/i);
  if (bsh) {
    const title = cleanText(bsh[2]);
    const mapped = titleBasedBsHCategory(title);
    return {
      rawCategory: bsh[1],
      title,
      category: mapped.category,
      categoryReason: mapped.reason,
      ambiguous: !mapped.category,
    };
  }

  return {
    rawCategory: '',
    title: text,
    category: undefined,
    categoryReason: 'No clear course category label was found.',
    ambiguous: true,
  };
}

function typeFromLtpcAndTitle({ title, category, L, T, P }) {
  const text = cleanText(title).toLowerCase();
  if (/\bproject\b/.test(text) || category === 'Project') return 'project';
  if (/\binternship\b/.test(text) || category === 'Internship') return 'internship';
  if (/\bseminar\b/.test(text)) return 'seminar';
  if (/\blab\b|laboratory|workshop/.test(text)) return P > 0 && (L > 0 || T > 0) ? 'theory_cum_lab' : 'lab';
  if (P > 0 && (L > 0 || T > 0)) return 'theory_cum_lab';
  if (P > 0 && !L && !T) return 'lab';
  return 'theory';
}

function isCourseRowStart(line) {
  return /^\d{1,2}\s+[A-Za-z&/(]/.test(normalizePdfLine(line));
}

function isCourseStructureHeader(line) {
  const text = normalizePdfLine(line);
  return /\bS\.?\s*N\.?\s*o\.?\b/i.test(text)
    && /\bCategory\b/i.test(text)
    && /\bTitle\b/i.test(text)
    && /\bL\b/i.test(text)
    && /\bT\b/i.test(text)
    && /\bP\b/i.test(text)
    && /\b(Credits?|C)\b/i.test(text);
}

function titleAmbiguityReason({ title, rawCategory }) {
  const cleanTitle = cleanText(title);
  const category = cleanText(rawCategory);
  if (/\b1\.\s+.+\b2\./.test(cleanTitle)) {
    return 'row lists multiple numbered options rather than one clear subject title';
  }
  if (/\bMOOC\b|\bNPTEL\b/i.test(cleanTitle)) {
    return 'row references MOOC/NPTEL options rather than one clear subject title';
  }
  if (/\bElective\b/i.test(category) && /\bOR\b/i.test(cleanTitle)) {
    return 'elective row contains OR and may not be one clear subject title';
  }
  return '';
}

function parseCourseRow({ rowLines, context, pageNumber }) {
  const rowText = normalizePdfLine(rowLines.join(' '));
  const match = rowText.match(/^(\d{1,2})\s+(.+?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(-|\d+(?:\.\d+)?)$/);
  if (!match) {
    return {
      ignored: {
        page_number: pageNumber,
        reason: 'Course row did not end with clear L T P Credits values.',
        row_text: rowText,
      },
    };
  }

  const rowNumber = Number.parseInt(match[1], 10);
  const categoryTitle = categoryAndTitleFromCourseText(match[2]);
  const L = parsePdfNumber(match[3]);
  const T = parsePdfNumber(match[4]);
  const P = parsePdfNumber(match[5]);
  const C = parsePdfNumber(match[6]);
  const title = categoryTitle.title;
  const subjectType = typeFromLtpcAndTitle({ title, category: categoryTitle.category, L, T, P });
  const credits = { L, T, P };
  if (C != null) credits.C = C;
  const ambiguityReason = titleAmbiguityReason({
    title,
    rawCategory: categoryTitle.rawCategory,
  });

  const missing = [
    !context.regulation ? 'regulation' : '',
    !context.branch ? 'branch' : '',
    !context.year ? 'year' : '',
    !context.semester ? 'semester' : '',
    !categoryTitle.category ? 'category' : '',
    !title ? 'title' : '',
    L == null || T == null || P == null ? 'L/T/P' : '',
    ambiguityReason,
  ].filter(Boolean);
  const level = missing.length === 0 && !categoryTitle.ambiguous ? 'high' : 'low';

  return {
    candidate: {
      candidate_index: rowNumber,
      subject_code: null,
      name: title,
      raw_category: categoryTitle.rawCategory,
      regulation: context.regulation,
      branch: context.branch,
      year: context.year,
      semester: context.semester,
      year_sem_label: context.year_sem_label,
      category: categoryTitle.category,
      type: subjectType,
      credits,
      evidence: {
        row_text: rowText,
        page_number: pageNumber,
        semester_heading: context.heading,
        category_reason: categoryTitle.categoryReason,
      },
      confidence: {
        level,
        reason: level === 'high'
          ? 'Course row has clear title, category, L/T/P values, regulation, branch, and year/semester context.'
          : `Course row needs review before extraction: ${missing.join(', ') || categoryTitle.categoryReason}`,
        signals: [
          categoryTitle.categoryReason,
          context.regulation ? `regulation ${context.regulation}` : '',
          context.branch ? `branch ${context.branch}` : '',
          context.year_sem_label ? `year-semester ${context.year_sem_label}` : '',
          'L/T/P values present',
          C != null ? 'credit value present' : 'credit value not numeric',
        ].filter(Boolean),
      },
    },
  };
}

function parseTirumalaCourseRows({ pageTexts, asset, parserVersion }) {
  const fullText = pageTexts.join('\n\n');
  const globalContext = extractPdfContext({ asset, fullText });
  const candidates = [];
  const lowConfidenceCandidates = [];
  const ignoredTableRows = [];
  let activeSemester = null;
  let inCourseTable = false;
  let rowLines = [];
  let rowPageNumber = null;
  let headerLines = [];

  function finishRow() {
    if (!rowLines.length) return;
    const parsed = parseCourseRow({
      rowLines,
      context: { ...globalContext, ...(activeSemester || {}) },
      pageNumber: rowPageNumber,
    });
    if (parsed.candidate?.confidence?.level === 'high') candidates.push(parsed.candidate);
    else if (parsed.candidate) lowConfidenceCandidates.push(parsed.candidate);
    else if (parsed.ignored) ignoredTableRows.push(parsed.ignored);
    rowLines = [];
    rowPageNumber = null;
  }

  pageTexts.forEach((pageText, pageIndex) => {
    const pageNumber = pageIndex + 1;
    for (const rawLine of pageText.split(/\n+/)) {
      const line = normalizePdfLine(rawLine);
      if (!line) continue;
      headerLines.push(line);
      if (headerLines.length > 3) headerLines.shift();
      const semester = parseSemesterHeading(line);
      if (semester) {
        finishRow();
        activeSemester = semester;
        inCourseTable = false;
        headerLines = [];
        continue;
      }
      if (isCourseStructureHeader(headerLines.join(' '))) {
        finishRow();
        inCourseTable = true;
        headerLines = [];
        continue;
      }
      if (!inCourseTable) continue;
      if (/^Total\b/i.test(line)) {
        finishRow();
        inCourseTable = false;
        continue;
      }
      if (/^Mandatory\b/i.test(line)) {
        finishRow();
        inCourseTable = false;
        continue;
      }
      if (isCourseRowStart(line)) {
        finishRow();
        rowLines = [line];
        rowPageNumber = pageNumber;
      } else if (rowLines.length) {
        rowLines.push(line);
      }
    }
  });
  finishRow();

  return {
    evidence_type: 'tirumala_r23_syllabus_pdf',
    evidence_status: 'needs_review',
    source_url: asset.sourceUrl,
    parser_version: parserVersion,
    page_count: pageTexts.length,
    text_preview: fullText.slice(0, 5000),
    detected_context: globalContext,
    candidates: candidates.slice(0, 300),
    low_confidence_candidates: lowConfidenceCandidates.slice(0, 300),
    ignored_table_rows: ignoredTableRows.slice(0, 300),
  };
}

export function parseTirumalaR23SyllabusTextForTest({ pageTexts, asset = {}, parserVersion = 'test' }) {
  return parseTirumalaCourseRows({ pageTexts, asset, parserVersion });
}

async function parseTirumalaR23SyllabusPdf({ asset, buffer, parserKey, parserVersion }) {
  const textResult = await extractPdfText({ asset, buffer, parserKey, parserVersion });
  const pageTexts = textResult.parsedPayload.page_texts || [];
  const parsedPayload = parseTirumalaCourseRows({ pageTexts, asset, parserVersion });
  return {
    parsedPayload,
    confidence: {
      parser: parserKey,
      extraction: 'tirumala_r23_syllabus_pdf',
      page_count: parsedPayload.page_count,
      candidate_count: parsedPayload.candidates.length,
      low_confidence_candidate_count: parsedPayload.low_confidence_candidates.length,
      ignored_table_row_count: parsedPayload.ignored_table_rows.length,
      requires_human_review: true,
      no_auto_proposal: true,
      candidate_rule: 'Only rows from clear S.No/Category/Title/L/T/P/Credits course-structure tables are high-confidence candidates.',
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
  version: '0.2.0',
  description: 'Conservatively extracts subject-index candidates from uploaded Tirumala syllabus HTML/text evidence.',
  supports: ['text/html', '.html', '.htm'],
  sourceSpecific: true,
  async parse({ asset, buffer }) {
    return parseSourceSpecificSubjectIndex({
      asset,
      buffer,
      parserKey: 'tirumala-syllabus-html',
      parserVersion: '0.2.0',
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
  version: '1.0.0',
  description: 'Extracts page text from stored PDF source assets for human review.',
  supports: ['application/pdf', '.pdf'],
  async parse({ asset, buffer }) {
    return extractPdfText({
      asset,
      buffer,
      parserKey: 'pdf-text-basic',
      parserVersion: '1.0.0',
    });
  },
});

registerParser({
  key: 'tirumala-r23-syllabus-pdf',
  label: 'Tirumala R23 syllabus PDF',
  version: '0.1.0',
  description: 'Conservatively extracts subject candidates from Tirumala R23 syllabus PDF course-structure tables.',
  supports: ['application/pdf', '.pdf'],
  sourceSpecific: true,
  async parse({ asset, buffer }) {
    return parseTirumalaR23SyllabusPdf({
      asset,
      buffer,
      parserKey: 'tirumala-r23-syllabus-pdf',
      parserVersion: '0.1.0',
    });
  },
});
