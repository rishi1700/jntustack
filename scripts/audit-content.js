import fs from 'node:fs';

// Telltale substitutions left behind by a crude thesaurus/word-spinner.
// Not exhaustive -- this is a detector, not a fixer. A real cleanup pass
// belongs to an LLM rewrite step, not a regex (see audit-content.js notes).
const SPIN_TELLTALES = [
  'Knowledge Mining', 'Knowledge Warehouse', 'Resolution Tree', 'Affiliation Evaluation',
  'Affiliation Guidelines', 'Ok-means', 'Perceive ', 'Fashions and algorithms',
  'Discount,Knowledge', 'Cleansing,Knowledge', 'Sorts of Knowledge', 'Merchandise Set',
  'Strategy to fixing', 'Drawback Defecation', 'Frequent Merchandise',
];

const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8 };
const WORD_NUM = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

function wordOrDigitToNumber(tok) {
  const t = tok.trim();
  if (/^\d+$/.test(t)) return Number(t);
  const n = WORD_NUM[t.toLowerCase()];
  return n === undefined ? null : n;
}

function extractBetween(text, startRe, endRe) {
  const startMatch = text.match(startRe);
  if (!startMatch) return null;
  const startIdx = startMatch.index + startMatch[0].length;
  const rest = text.slice(startIdx);
  const endMatch = endRe ? rest.match(endRe) : null;
  return endMatch ? rest.slice(0, endMatch.index).trim() : rest.trim();
}

function bulletLines(block) {
  if (!block) return [];
  return block.split('\n').map(l => l.replace(/^[•\-\d.]\s*/, '').trim()).filter(Boolean);
}

export function parseSubjectFixture(rawText) {
  const sourceUrlMatch = rawText.match(/^SOURCE_URL:\s*(.+)$/m);
  const titleMatch = rawText.match(/^#\s+(.+)$/m);

  const objectivesBlock = extractBetween(rawText, /OBJECTIVES:\s*\n/, /\nUNIT/);
  const outcomesBlock = extractBetween(rawText, /OUTCOMES:\s*\n/, /\nTEXT BOOKS/);
  const textbooksBlock = extractBetween(rawText, /TEXT BOOKS:\s*\n/, /\nREFERENCE BOOKS/);
  const referenceBlock = extractBetween(rawText, /REFERENCE BOOKS:\s*\n/, /\n\[Download\]|\n\n\[/);

  // Units: split on "UNIT -<roman>" markers, tolerant of the en-dash/hyphen variants
  // the spinner/CMS export produced.
  const unitMatches = [...rawText.matchAll(/UNIT\s*[–-]?\s*([IVX]+)\s*:?\s*\n([\s\S]*?)(?=\nUNIT\s*[–-]?\s*[IVX]+|\n\n[A-Z]{2,}|\nL T P C|$)/g)];
  const units = unitMatches.map(m => ({
    number: ROMAN[m[1]] ?? null,
    roman: m[1],
    raw_topics: m[2].replace(/\n/g, ' ').trim(),
  }));

  // L T P C line: the row right after the literal header, tokens may be digits or spun words
  let credits = null;
  const ltpcMatch = rawText.match(/L T P C\s*\n\s*([^\n]+)/);
  if (ltpcMatch) {
    const tokens = ltpcMatch[1].trim().split(/\s+/).map(wordOrDigitToNumber);
    if (tokens.length === 4 && tokens.every(t => t !== null)) {
      credits = { L: tokens[0], T: tokens[1], P: tokens[2], C: tokens[3] };
    }
  }

  const downloadLinkMatch = rawText.match(/\[Download\]\(([^)]+)\)/);

  const spinHits = SPIN_TELLTALES.filter(t => rawText.includes(t));

  return {
    source_url: sourceUrlMatch?.[1] ?? null,
    title: titleMatch?.[1] ?? null,
    objectives: bulletLines(objectivesBlock),
    units,
    credits,
    course_outcomes: bulletLines(outcomesBlock),
    textbooks: bulletLines(textbooksBlock),
    reference_books: bulletLines(referenceBlock),
    download_product_url: downloadLinkMatch?.[1] ?? null,
    content_quality: {
      likely_spun_text: spinHits.length > 0,
      spin_telltale_hits: spinHits,
    },
  };
}

export function parseEddProductFixture(rawText) {
  const sourceUrlMatch = rawText.match(/^SOURCE_URL:\s*(.+)$/m);
  const fileLines = [...rawText.matchAll(/^\d+\.\s+(.+)$/gm)].map(m => m[1].trim());
  const isFreeButGated = /Free\s*[–-]\s*Purchase/.test(rawText) && /Checkout/.test(rawText);
  return {
    source_url: sourceUrlMatch?.[1] ?? null,
    listed_files: fileLines,
    requires_checkout_even_when_free: isFreeButGated,
    direct_file_url_present_in_html: false, // confirmed false for this EDD config -- see notes.md
  };
}

// --- run against the real fixtures captured this session ---
if (import.meta.url === `file://${process.argv[1]}`) {
  const subjectRaw = fs.readFileSync(new URL('../fixtures/subject-page-dwdm.txt', import.meta.url), 'utf-8');
  const eddRaw = fs.readFileSync(new URL('../fixtures/edd-product-page-dwdm.txt', import.meta.url), 'utf-8');

  const subject = parseSubjectFixture(subjectRaw);
  const edd = parseEddProductFixture(eddRaw);

  const unitCountMismatch = subject.units.length !== edd.listed_files.length;

  const report = { subject, edd, audit_flags: {
    unit_count_mismatch: unitCountMismatch,
    page_units: subject.units.length,
    product_files: edd.listed_files.length,
  }};

  console.log(JSON.stringify(report, null, 2));
  console.log('');
  console.log('--- Human-readable summary ---');
  console.log(`Title              : ${subject.title}`);
  console.log(`Credits (L-T-P-C)  : ${subject.credits ? `${subject.credits.L}-${subject.credits.T}-${subject.credits.P}-${subject.credits.C}` : 'not found'}`);
  console.log(`Units found on page: ${subject.units.length}`);
  console.log(`Files in EDD product: ${edd.listed_files.length}`);
  console.log(`Unit/file count mismatch: ${unitCountMismatch ? 'YES -- ' + subject.units.length + ' units vs ' + edd.listed_files.length + ' files, needs a human/Claude look' : 'no'}`);
  console.log(`Likely spun text   : ${subject.content_quality.likely_spun_text} (${subject.content_quality.spin_telltale_hits.length} telltale phrases matched)`);
  console.log(`File requires checkout even though free: ${edd.requires_checkout_even_when_free}`);
}
