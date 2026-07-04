import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractEntityPayload } from '../lib/entity-extractors/index.js';
import { applyReviewerCategoryMappingToPayload } from '../lib/extraction-results.js';
import { normalizeCourseTitle } from '../lib/entity-extractors/subject-extractor.js';
import { createStructuredDiff } from '../lib/diff-engine.js';
import {
  getParser,
  parseLbrceR23SyllabusTextForTest,
  parseTirumalaR23SyllabusTextForTest,
} from '../lib/parsers/index.js';
import { validateProposalPayload } from '../lib/proposal-validation.js';
import { buildReleaseReviewWarningsForTest } from '../lib/release-review.js';

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

async function testLbrcePdfTextFixture() {
  const text = await fs.readFile(path.join(root, 'fixtures/parser/lbrce-r23-course-structure.txt'), 'utf-8');
  const payload = parseLbrceR23SyllabusTextForTest({
    pageTexts: [text],
    asset: {
      originalFilename: 'R23_CSE_Syllabus1.pdf',
      sourceUrl: 'https://www.lbrce.ac.in/academics/syllabus/R23/R23_CSE_Syllabus1.pdf',
    },
  });

  assert.equal(payload.evidence_type, 'lbrce_r23_syllabus_pdf');
  assert.equal(payload.detected_context.regulation, 'R23');
  assert.equal(payload.detected_context.branch, 'CSE');
  assert.equal(payload.candidates.length, 7, JSON.stringify(payload.candidates.map(summarizeCandidate), null, 2));
  assert.equal(payload.low_confidence_candidates.length, 2);

  const graphTheory = payload.candidates.find(candidate => candidate.name === 'Discrete Mathematics & Graph Theory');
  assert.ok(graphTheory);
  assert.equal(graphTheory.subject_code, '23FE11');
  assert.equal(graphTheory.category, undefined);
  assert.equal(graphTheory.type, 'theory');
  assert.deepEqual(graphTheory.credits, { L: 3, T: 0, P: 0, C: 3 });
  assert.equal(graphTheory.year, 2);
  assert.equal(graphTheory.semester, 1);
  assert.equal(graphTheory.confidence.level, 'high');
  assert.ok(graphTheory.confidence.reason.includes('category still requires validation'));

  const lab = payload.candidates.find(candidate => candidate.name === 'Advanced data structures & Algorithm Analysis lab');
  assert.ok(lab);
  assert.equal(lab.subject_code, '23CS53');
  assert.equal(lab.type, 'lab');
  assert.deepEqual(lab.credits, { L: 0, T: 0, P: 3, C: 1.5 });

  const elective = payload.low_confidence_candidates.find(candidate => candidate.raw_category === 'Program Elective-I');
  assert.ok(elective);
  assert.equal(elective.category, 'ProfessionalElective');
  assert.equal(elective.confidence.level, 'low');
  assert.ok(elective.confidence.reason.includes('option group'));

  const openElective = payload.low_confidence_candidates.find(candidate => candidate.raw_category === 'Open Elective-I');
  assert.ok(openElective);
  assert.equal(openElective.category, 'OpenElective');
  assert.equal(openElective.confidence.level, 'low');

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
  assert.equal(validation.normalizedPayload.source.status, 'needs_verification');
  assert.equal(validation.status, 'failed');
  assert.ok(
    validation.errors.some(error => error.params?.missingProperty === 'category'),
    JSON.stringify(validation.errors, null, 2)
  );

  assert.throws(
    () => applyReviewerCategoryMappingToPayload({
      root,
      entityType: 'subject',
      extractedPayload: validation.normalizedPayload,
      mappedCategory: 'NotARealCategory',
      mappingNote: 'Fixture reviewer note.',
      mappedBy: 'test',
    }),
    /Invalid category/
  );
  assert.throws(
    () => applyReviewerCategoryMappingToPayload({
      root,
      entityType: 'subject',
      extractedPayload: validation.normalizedPayload,
      mappedCategory: 'BasicScience',
      mappingNote: '',
      mappedBy: 'test',
    }),
    /Reviewer note is required/
  );

  const mapped = applyReviewerCategoryMappingToPayload({
    root,
    entityType: 'subject',
    extractedPayload: validation.normalizedPayload,
    mappedCategory: 'BasicScience',
    mappingNote: 'Fixture maps this row to BasicScience for validation coverage only.',
    mappedBy: 'test',
    evidenceReference: {
      row_text: graphTheory.evidence.row_text,
      page_number: graphTheory.evidence.page_number,
    },
  });
  assert.equal(mapped.validation.status, 'passed', JSON.stringify(mapped.validation.errors, null, 2));
  assert.equal(mapped.mappedPayload.category, 'BasicScience');
  assert.equal(mapped.mappedPayload.source.status, 'needs_verification');
}

function subjectPayload(overrides = {}) {
  return {
    id: 'r23-cse-3-1-new-parser-subject',
    regulation: 'R23',
    branch: 'CSE',
    specialization: null,
    year: 3,
    semester: 1,
    year_sem_label: '3-1',
    subject_code: null,
    name: 'New Parser Subject',
    category: 'ProfessionalCore',
    credits: { L: 3, T: 0, P: 0, C: 3 },
    type: 'theory',
    course_outcomes: [],
    resources: {
      lecture_notes_pdf: null,
      previous_question_papers_pdf: null,
      lab_manual_pdf: null,
    },
    seo: {
      slug: 'new-parser-subject-jntuk-r23-cse-3-1',
      title: 'New Parser Subject',
      meta_description: 'New Parser Subject extracted candidate. Needs human verification before publishing.',
    },
    legacy_equivalent_id: null,
    source: {
      origin_url: 'https://www.tecnrt.org/example.pdf',
      retrieved_date: null,
      status: 'needs_verification',
    },
    notes: 'Extracted candidate from parsed source evidence. Requires human verification.',
    ...overrides,
  };
}

function testAddModeDiff() {
  const proposed = subjectPayload();
  const diff = createStructuredDiff({
    content: { data: { subjects: [] }, colleges: [], branchProfiles: [] },
    entityType: 'subject',
    entityKey: proposed.id,
    proposedPayload: proposed,
  });

  assert.equal(diff.existingPayload, null);
  assert.equal(diff.diff.operation, 'add');
  assert.equal(diff.diff.change_count, 1);
  assert.equal(diff.proposedPayload.id, proposed.id);
  const validation = validateProposalPayload({ root, entityType: 'subject', payload: diff.proposedPayload });
  assert.equal(validation.status, 'passed', JSON.stringify(validation.errors, null, 2));
}

function testSafeMergePreservesRichExistingFields() {
  const existing = subjectPayload({
    id: 'r23-cse-3-1-existing-rich-subject',
    name: 'Existing Rich Subject',
    units: [{ number: 1, title: 'Existing Unit', topics: ['Keep this'] }],
    course_outcomes: ['Keep outcome'],
    resources: { lecture_notes_pdf: 'https://example.com/notes.pdf' },
    seo: {
      slug: 'existing-rich-subject',
      title: 'Existing Rich Subject - Verified',
      meta_description: 'Keep verified SEO.',
    },
    source: {
      origin_url: 'https://verified.example/source.pdf',
      retrieved_date: '2026-07-01',
      status: 'verified',
    },
    notes: 'Keep verified notes.',
  });
  const thinParserPayload = subjectPayload({
    id: existing.id,
    name: 'Existing Rich Subject',
    units: [],
    course_outcomes: [],
    resources: {
      lecture_notes_pdf: null,
      previous_question_papers_pdf: null,
      lab_manual_pdf: null,
    },
    seo: {
      slug: 'parser-thin-seo',
      title: 'Parser Thin SEO',
      meta_description: 'Parser thin metadata.',
    },
    source: {
      origin_url: 'https://parser.example/source.pdf',
      retrieved_date: null,
      status: 'needs_verification',
    },
    notes: 'Parser thin notes.',
  });
  const diff = createStructuredDiff({
    content: { data: { subjects: [existing] }, colleges: [], branchProfiles: [] },
    entityType: 'subject',
    entityKey: existing.id,
    proposedPayload: thinParserPayload,
  });

  assert.equal(diff.diff.operation, 'no_change');
  assert.deepEqual(diff.proposedPayload.units, existing.units);
  assert.deepEqual(diff.proposedPayload.course_outcomes, existing.course_outcomes);
  assert.deepEqual(diff.proposedPayload.resources, existing.resources);
  assert.deepEqual(diff.proposedPayload.seo, existing.seo);
  assert.equal(diff.proposedPayload.notes, existing.notes);
  assert.equal(diff.proposedPayload.source.status, 'verified');
  assert.ok(diff.diff.safety.warnings.some(warning => warning.code === 'thin_parser_field_preserved'));
  assert.ok(diff.diff.safety.warnings.some(warning => warning.code === 'verified_source_downgrade_blocked' && warning.blocking));
}

function testTitleNormalization() {
  assert.equal(normalizeCourseTitle('Full Stack development-2'), 'Full Stack Development-2');
  assert.equal(normalizeCourseTitle('AI and ML for IoT systems'), 'AI and ML for IoT Systems');
  assert.equal(normalizeCourseTitle('DBMS using SQL'), 'DBMS using SQL');
}

function releaseReviewItem(overrides = {}) {
  return {
    item_id: 1,
    proposal_id: 101,
    proposal_export_id: 201,
    draft_apply_id: 301,
    revision_id: 401,
    entity_type: 'subject',
    entity_key: 'r23-eee-2-1-example-subject',
    proposal_validation_status: 'passed',
    export_validation_status: 'passed',
    draft_validation_status: 'passed',
    files: ['data/subjects-eee.json'],
    diff: {
      operation: 'add',
      target_file: 'data/subjects-eee.json',
      patch_count: 1,
      patch_paths: ['/subjects/-'],
    },
    ...overrides,
  };
}

function testReleaseReviewSameFileSafeAdds() {
  const warnings = buildReleaseReviewWarningsForTest([
    releaseReviewItem(),
    releaseReviewItem({
      item_id: 2,
      proposal_id: 102,
      proposal_export_id: 202,
      draft_apply_id: 302,
      revision_id: 402,
      entity_key: 'r23-eee-2-1-second-example-subject',
    }),
  ]);

  assert.equal(warnings.length, 1, JSON.stringify(warnings, null, 2));
  assert.equal(warnings[0].code, 'same_file_multiple_safe_adds');
  assert.equal(warnings[0].blocking, false);
  assert.equal(warnings[0].severity, 'info');
}

function testReleaseReviewSameFileMixedOpsBlock() {
  const warnings = buildReleaseReviewWarningsForTest([
    releaseReviewItem(),
    releaseReviewItem({
      item_id: 2,
      proposal_id: 102,
      proposal_export_id: 202,
      draft_apply_id: 302,
      revision_id: 402,
      entity_key: 'r23-eee-2-1-existing-subject',
      diff: {
        operation: 'replace',
        target_file: 'data/subjects-eee.json',
        patch_count: 1,
        patch_paths: ['/subjects/8'],
      },
    }),
  ]);

  assert.ok(warnings.some(warning => warning.code === 'same_file_multiple_proposals' && warning.blocking), JSON.stringify(warnings, null, 2));
}

await testTirumalaPdfTextFixture();
await testTirumalaHtmlIgnoresContactRows();
await testLbrcePdfTextFixture();
testAddModeDiff();
testSafeMergePreservesRichExistingFields();
testTitleNormalization();
testReleaseReviewSameFileSafeAdds();
testReleaseReviewSameFileMixedOpsBlock();

console.log('Parser regression checks passed.');
