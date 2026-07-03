import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractEntityPayload } from '../lib/entity-extractors/index.js';
import { getParser, parseTirumalaR23SyllabusTextForTest } from '../lib/parsers/index.js';
import { validateProposalPayload } from '../lib/proposal-validation.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function summarizeCandidate(candidate) {
  return {
    name: candidate.name,
    category: candidate.category,
    type: candidate.type,
    year: candidate.year,
    semester: candidate.semester,
    credits: candidate.credits,
    confidence: candidate.confidence?.level,
  };
}

async function testTirumalaPdfTextFixture() {
  const text = await fs.readFile(path.join(root, 'fixtures/parser/tirumala-r23-course-structure.txt'), 'utf-8');
  const payload = parseTirumalaR23SyllabusTextForTest({
    pageTexts: [text],
    asset: {
      originalFilename: 'CSE II-I & II-II SYLLABUS.pdf',
      sourceUrl: 'https://www.tecnrt.org/R23_FINIAL_SYLLABUS/SECOND%20YEAR/CSE%20II-I%20%26%20II-II%20SYLLABUS.pdf',
    },
  });

  assert.equal(payload.detected_context.regulation, 'R23');
  assert.equal(payload.detected_context.branch, 'CSE');
  assert.equal(payload.candidates.length, 4, JSON.stringify(payload.candidates.map(summarizeCandidate), null, 2));
  assert.equal(payload.low_confidence_candidates.length, 1);
  assert.equal(payload.ignored_table_rows.length, 0);

  const graphTheory = payload.candidates.find(candidate => candidate.name === 'Discrete Mathematics & Graph Theory');
  assert.ok(graphTheory);
  assert.equal(graphTheory.category, 'BasicScience');
  assert.equal(graphTheory.type, 'theory');
  assert.deepEqual(graphTheory.credits, { L: 3, T: 0, P: 0, C: 3 });
  assert.equal(graphTheory.year, 2);
  assert.equal(graphTheory.semester, 1);
  assert.equal(graphTheory.confidence.level, 'high');

  const lab = payload.candidates.find(candidate => candidate.name === 'Advanced Data Structures and Algorithm Analysis Lab');
  assert.ok(lab);
  assert.equal(lab.type, 'lab');
  assert.deepEqual(lab.credits, { L: 0, T: 0, P: 3, C: 1.5 });

  const ambiguous = payload.low_confidence_candidates[0];
  assert.equal(ambiguous.name, 'Design Thinking &Innovation');
  assert.equal(ambiguous.confidence.level, 'low');

  const extracted = extractEntityPayload({
    parsedPayload: payload,
    entityType: 'subject',
    candidateIndex: 0,
  });
  const validation = validateProposalPayload({
    root,
    entityType: 'subject',
    payload: extracted.extractedPayload,
  });
  assert.equal(validation.status, 'passed', JSON.stringify(validation.errors, null, 2));
  assert.equal(validation.normalizedPayload.source.status, 'needs_verification');
  assert.deepEqual(validation.normalizedPayload.credits, { L: 3, T: 0, P: 0, C: 3 });
}

async function testTirumalaHtmlIgnoresContactRows() {
  const parser = getParser('tirumala-syllabus-html');
  const html = `
    <table>
      <tr><th>Name</th><th>Designation</th><th>Email</th></tr>
      <tr><td>Jane Faculty</td><td>Professor</td><td>jane@example.edu</td></tr>
    </table>
    <table>
      <tr><th>S.No</th><th>Subject Code</th><th>Subject Name</th><th>Category</th><th>Credits</th></tr>
      <tr><td>1</td><td>CS301</td><td>Data Structures</td><td>Professional Core</td><td>3</td></tr>
    </table>
  `;
  const result = await parser.parse({
    asset: { id: 'fixture-html', sourceUrl: 'https://www.tecnrt.org/fixture.html' },
    buffer: Buffer.from(html),
    root,
  });

  assert.equal(result.parsedPayload.candidates.length, 1);
  assert.equal(result.parsedPayload.candidates[0].name, 'Data Structures');
  assert.equal(result.parsedPayload.low_confidence_candidates.length, 0);
  assert.ok(result.parsedPayload.ignored_table_rows.length >= 1);
}

await testTirumalaPdfTextFixture();
await testTirumalaHtmlIgnoresContactRows();

console.log('Parser regression checks passed.');
