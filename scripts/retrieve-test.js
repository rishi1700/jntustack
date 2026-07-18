import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadContent } from '../lib/content-store/index.js';
import { buildSearchIndex, retrieve, tokenize } from '../lib/retrieve.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const content = await loadContent({ root: ROOT });
const { subjects, branches = [] } = content.data;
const guides = content.guides || content.data.guides || [];
const index = buildSearchIndex({
  subjects,
  branches,
  branchProfiles: content.branchProfiles,
  colleges: content.colleges,
  guides,
});

function titles(hits) {
  return hits.map(hit => `[${hit.type}] ${hit.title}`).join(' | ');
}

function hitAtOne(query, predicate, description) {
  const hits = retrieve(index, query, 5);
  assert.ok(hits[0] && predicate(hits[0]), `${description}\nquery: ${query}\nhits: ${titles(hits)}`);
  return 1;
}

console.log(`Indexed ${index.length} verified public documents from ${content.source}.`);

const navigationalCases = [
  ['data structures CSE 1-2', doc => doc.id === 'r23-cse-1-2-data-structures', 'CSE 1-2 Data Structures must rank first'],
  ['machine learning ECE 3-2', doc => doc.id === 'r23-ece-3-2-machine-learning', 'ECE 3-2 Machine Learning must rank first'],
  ['IT 3-1 computer networks', doc => doc.id === 'r23-it-3-1-computer-networks', 'IT 3-1 Computer Networks must rank first'],
  ['CE 3-2 environmental engineering', doc => doc.id === 'r23-ce-3-2-environmental-engineering', 'CE 3-2 Environmental Engineering must rank first'],
  ['R23 EEE 3-1 power systems II', doc => doc.id === 'r23-eee-3-1-power-systems-ii', 'R23 EEE 3-1 Power Systems-II must rank first'],
  ['thermal engineering mechanical', doc => doc.id === 'r23-mech-3-1-thermal-engineering', 'Mechanical Thermal Engineering must rank first'],
  [
    'JNTUK constituent college Kakinada',
    doc => doc.type === 'college' && doc.title === 'University College of Engineering Kakinada, JNTUK',
    'The JNTUK constituent college in Kakinada must rank first',
  ],
];

const reciprocalRanks = navigationalCases.map(([query, predicate, description]) =>
  hitAtOne(query, predicate, description));
const navigationalMrr = reciprocalRanks.reduce((sum, value) => sum + value, 0) / reciprocalRanks.length;
assert.equal(navigationalMrr, 1, 'Navigational MRR must be 1.0');

const networks = retrieve(index, 'computer networks unit topics', 2);
assert.deepEqual(
  new Set(networks.map(doc => doc.id)),
  new Set(['r23-cse-3-1-computer-networks', 'r23-it-3-1-computer-networks']),
  `Computer Networks theory pages must occupy the top two positions; got ${titles(networks)}`
);

const comparison = retrieve(index, 'should I choose ECE or EEE', 2);
assert.deepEqual(
  new Set(comparison.map(doc => doc.id)),
  new Set(['branch-ECE', 'branch-EEE']),
  `ECE/EEE comparison must return the two exact branch profiles; got ${titles(comparison)}`
);

const krishna = retrieve(index, 'engineering colleges in Krishna district', 5);
assert.equal(krishna.length, 5, `Expected five Krishna district results; got ${titles(krishna)}`);
assert.ok(
  krishna.every(doc => doc.type === 'college' && doc.summary?.location?.district === 'Krishna'),
  `Every top-five Krishna result must be in Krishna district; got ${titles(krishna)}`
);

const conceptTargets = new Set(subjects
  .filter(subject => subject.source?.status === 'verified')
  .filter(subject => /k[ -]?means/i.test(JSON.stringify(subject.units || [])))
  .map(subject => subject.id));
const conceptHits = retrieve(index, 'what is K-means clustering used for', 3);
assert.ok(
  conceptHits.some(doc => conceptTargets.has(doc.id)),
  `A syllabus page containing K-means must appear in the top three; got ${titles(conceptHits)}`
);

// Contract tests use a deliberately impossible cross-product: CSE 1-1 and IT
// 1-2 are valid, but CSE 1-2 is not. A flattened branch/semester matcher would
// incorrectly return the page for the third query.
const syntheticSubjects = [
  {
    id: 'multi-offering-fixture',
    name: 'Shared Systems',
    regulation: 'R23',
    type: 'theory',
    category: 'ProfessionalCore',
    offerings: [
      { branchCodes: ['CSE'], year: 1, semester: 1, credits: { L: 3, T: 0, P: 0, C: 3 } },
      { branchCodes: ['IT'], year: 1, semester: 2, credits: { L: 3, T: 0, P: 0, C: 3 } },
    ],
    units: [{ title: 'System Models', topics: ['Shared system design'] }],
    course_outcomes: [],
    seo: { slug: 'shared-systems-jntuk-r23' },
    source: { status: 'verified' },
  },
  {
    id: 'listing-fixture',
    name: 'Community Service Project Internship',
    regulation: 'R23',
    branch: 'CSE',
    year: 2,
    semester: 2,
    year_sem_label: '2-2',
    type: 'internship',
    category: 'Internship',
    publication: { mode: 'listing_only', listing_url: '/r23-internships-and-projects/#community-project' },
    source: { status: 'verified' },
  },
  {
    id: 'listing-fixture-it',
    name: 'Community Service Project Internship',
    regulation: 'R23',
    branch: 'IT',
    year: 2,
    semester: 2,
    year_sem_label: '2-2',
    type: 'internship',
    category: 'Internship',
    publication: { mode: 'listing_only', listing_url: '/r23-internships-and-projects/#community-project' },
    source: { status: 'verified' },
  },
  {
    id: 'entrepreneurship-listing-fixture',
    name: 'Entrepreneurship Development and Venture Creation',
    regulation: 'R23',
    branch: 'CSE',
    year: 3,
    semester: 1,
    year_sem_label: '3-1',
    type: 'theory',
    category: 'OpenElective',
    publication: { mode: 'listing_only', listing_url: null },
    source: { status: 'verified' },
  },
  {
    id: 'unverified-fixture',
    name: 'Unverified Secret Subject',
    regulation: 'R23',
    branch: 'CSE',
    year: 1,
    semester: 1,
    source: { status: 'needs_verification' },
  },
];
const syntheticGuides = [{
  id: 'r23-internships-and-projects',
  title: 'R23 Internships and Projects',
  regulation: 'R23',
  seo: { slug: 'r23-internships-and-projects' },
  sections: [{ id: 'community-project', title: 'Community Service Project', body: 'Internship evaluation guidance.' }],
  source: { status: 'verified' },
}];
const synthetic = buildSearchIndex({ subjects: syntheticSubjects, branches, guides: syntheticGuides });

assert.equal(retrieve(synthetic, 'shared systems CSE 1-1', 1)[0]?.id, 'multi-offering-fixture');
assert.equal(retrieve(synthetic, 'shared systems IT 1-2', 1)[0]?.id, 'multi-offering-fixture');
assert.deepEqual(retrieve(synthetic, 'shared systems CSE 1-2', 5), [], 'Branch and semester must match one offering atomically');
assert.deepEqual(retrieve(synthetic, 'shared systems CSE 9-9', 5), [], 'A nonexistent semester filter must not fall back to a loose match');
assert.equal(retrieve(synthetic, 'CSE 2-2 community service project internship', 3)[0]?.id, 'r23-internships-and-projects');
assert.equal(retrieve(synthetic, 'IT 2-2 community service project internship', 3)[0]?.id, 'r23-internships-and-projects');
assert.equal(synthetic.filter(doc => doc.id === 'r23-internships-and-projects').length, 1, 'The internship guide must be one search document');
assert.ok(!synthetic.some(doc => doc.id === 'listing-fixture' || doc.id === 'listing-fixture-it'), 'Listing-only milestones must not become standalone search documents');
assert.ok(!synthetic.some(doc => doc.id === 'entrepreneurship-listing-fixture'), 'Listing-only electives must not become standalone search documents');
assert.ok(!synthetic.some(doc => doc.id === 'unverified-fixture'), 'Unverified content must never enter the index');

if (index.some(doc => doc.type === 'guide')) {
  const internshipHits = retrieve(index, 'R23 CSE 2-2 community service project internship', 5);
  assert.equal(internshipHits[0]?.type, 'guide', `A real internship query must resolve to the published guide; got ${titles(internshipHits)}`);
  assert.equal(new Set(internshipHits.map(doc => doc.url)).size, internshipHits.length, 'Guide results must not contain duplicate URLs');
}

assert.deepEqual(retrieve(index, 'flibbertigibbet', 5), [], 'Nonsense must return no grounded match');
assert.deepEqual(retrieve(index, 'Data Structures CSE 9-9', 5), [], 'Nonexistent academic filters must return no match');

const tieDocs = [
  { type: 'subject', id: 'z', title: 'Beta', url: '/z/', fields: { primary: 'Quasar' }, contexts: [] },
  { type: 'subject', id: 'b', title: 'Alpha', url: '/b/', fields: { primary: 'Quasar' }, contexts: [] },
  { type: 'subject', id: 'a', title: 'Alpha', url: '/a/', fields: { primary: 'Quasar' }, contexts: [] },
];
assert.deepEqual(retrieve(tieDocs, 'quasar', 2).map(doc => doc.id), ['a', 'b'], 'Ties must sort by title then ID');
assert.deepEqual(retrieve(tieDocs, 'quasar', 0), [], 'topK=0 must return no results');

assert.ok(tokenize('CE IT R23 1-2').includes('ce'), 'CE must survive tokenization');
assert.ok(tokenize('CE IT R23 1-2').includes('it'), 'IT must survive tokenization');
assert.ok(tokenize('CE IT R23 1-2').includes('r23'), 'R23 must survive tokenization');
assert.ok(tokenize('CE IT R23 1-2').includes('1-2'), '1-2 must survive tokenization');
assert.deepEqual(tokenize('networks topics colleges'), ['network', 'topic', 'college'], 'Common plural forms must normalize deterministically');

const typedChecks = [
  ...krishna.map(doc => doc.summary?.location?.district === 'Krishna'),
  ...comparison.map(doc => ['branch-ECE', 'branch-EEE'].includes(doc.id)),
  ...networks.map(doc => ['r23-cse-3-1-computer-networks', 'r23-it-3-1-computer-networks'].includes(doc.id)),
];
const typedPrecision = typedChecks.filter(Boolean).length / typedChecks.length;
assert.equal(typedPrecision, 1, 'Typed Precision@5 gate must be 100%');

console.log(`Retrieval quality gates passed: navigational Hit@1 100%, MRR ${navigationalMrr.toFixed(1)}, concept Hit@3 100%, typed Precision@5 ${(typedPrecision * 100).toFixed(0)}%.`);
