import assert from 'node:assert/strict';
import { buildContentFreshness } from '../lib/content-freshness.js';
import { proposalActionAllowed } from '../lib/proposals.js';
import { releaseArtifactsMutable } from '../lib/release-candidates.js';
import {
  renderAdminChecksPage,
  renderContentIntakePage,
  renderDashboard,
  renderFreshnessPage,
  renderGuidedProcessingPage,
  renderProposalDetailPage,
  renderReviewQueuePage,
} from '../templates/admin.js';

const subjects = [
  {
    id: 'current-subject',
    name: 'Current Subject',
    branch: 'CSE',
    year_sem_label: '3-1',
    source: {
      status: 'verified',
      origin_url: 'https://jntuk.edu.in/current.pdf',
      retrieved_date: '2026-07-01',
    },
  },
  {
    id: 'due-subject',
    name: 'Due Subject',
    branch: 'ECE',
    year_sem_label: '2-2',
    source: {
      status: 'verified',
      origin_url: 'https://jntuk.edu.in/older.pdf',
      retrieved_date: '2025-01-01',
    },
  },
  {
    id: 'missing-source',
    name: 'Missing Source',
    branch: 'CSE',
    year_sem_label: '3-2',
    source: { status: 'needs_verification' },
  },
];

const freshness = buildContentFreshness(subjects, {
  now: new Date('2026-07-12T00:00:00Z'),
  reviewDays: 180,
});
assert.equal(freshness.totalSources, 3);
assert.equal(freshness.current, 1);
assert.equal(freshness.due, 1);
assert.equal(freshness.missing, 1);
assert.equal(proposalActionAllowed('needs_review', 'approve_for_draft'), true);
assert.equal(proposalActionAllowed('approved_for_draft', 'approve_for_draft'), false);
assert.equal(proposalActionAllowed('applied', 'reject'), false);
assert.equal(releaseArtifactsMutable('draft'), true);
assert.equal(releaseArtifactsMutable('ready_for_review'), false);

const dashboard = renderDashboard({
  contentSource: 'json',
  counts: {
    subjectsTotal: 427,
    subjectsVerified: 396,
    subjectsNeedsVerification: 31,
    subjectsPlaceholder: 0,
    collegesTotal: 376,
    branchProfilesTotal: 6,
  },
  freshness,
  workflow: {
    available: true,
    proposalsNeedingReview: 2,
    approvedProposals: 1,
    pipelineFailures: 1,
    activeReleases: 1,
    pendingPush: 0,
    commitFailed: 0,
  },
});
assert.match(dashboard, /Keep every page grounded in a source/);
assert.match(dashboard, /class="proof-rail"/);
assert.match(dashboard, /Start an update/);
assert.match(dashboard, /<summary>Advanced<\/summary>/);
assert.doesNotMatch(dashboard, /--muted:var\(--muted\)/);

const sources = [{
  id: 7,
  enabled: true,
  name: 'Official JNTUK',
  sourceKey: 'jntuk',
  baseUrl: 'https://jntuk.edu.in/',
}];
const intake = renderContentIntakePage({ sources });
assert.match(intake, /action="\/admin\/content\/new\/fetch"/);
assert.match(intake, /action="\/admin\/assets\/new\?guided=1"/);
assert.match(intake, /Nothing publishes automatically/);

const guided = renderGuidedProcessingPage({
  asset: {
    id: 11,
    originalFilename: 'r23.pdf',
    discoverySourceName: 'Official JNTUK',
    sourceUrl: 'https://jntuk.edu.in/r23.pdf',
    fileSize: 1024,
    sha256Checksum: '1234567890abcdef1234567890abcdef',
  },
  fileStatus: { status: 'present' },
  parsers: [{ key: 'pdf-text-basic', label: 'PDF reader', suggested: true, available: true }],
});
assert.match(guided, /Run safe automation/);
assert.match(guided, /name="create_proposal" value="1" checked/);
assert.match(guided, /never approves, verifies or publishes/);

const review = renderReviewQueuePage({
  drafts: subjects.filter(subject => subject.source.status === 'needs_verification'),
  totalDrafts: 1,
  proposals: [{ id: 3, entityType: 'subject', entityKey: 'new-subject', status: 'needs_review', validationStatus: 'passed' }],
});
assert.match(review, /Decisions, not pipeline artifacts/);
assert.match(review, /\/admin\/verification-reviews\/missing-source/);
assert.match(review, /\/admin\/proposals\/3/);

const freshnessPage = renderFreshnessPage({ freshness });
assert.match(freshnessPage, /review reminder, not a claim/);
assert.match(freshnessPage, /Review source/);

const checks = renderAdminChecksPage({
  checks: {
    generatedAt: '2026-07-12T00:00:00Z',
    runtime: { nodeVersion: 'v22', contentSource: 'json', adminEnabled: true, adminConfigured: true, askEnabled: false },
    db: { configured: true, skipped: false, connected: true, ok: true, expectedMigrations: 24, appliedMigrations: 24, pendingMigrations: [], message: 'ok' },
    storage: { ok: true, path: '/tmp', message: 'ok' },
    content: { source: 'json', subjectsTotal: 427, subjectsVerified: 396, subjectsNeedsVerification: 31, subjectsPlaceholder: 0, collegesTotal: 376, branchProfilesTotal: 6 },
    searchIndex: { ok: true, total: 778, byType: { subject: 396, college: 376, branch_profile: 6 }, path: '/dist/search-index.json' },
  },
});
assert.doesNotMatch(checks, /needs attention/);
assert.doesNotMatch(checks, /619/);

const approvedProposal = renderProposalDetailPage({
  proposal: {
    id: 4,
    entityType: 'subject',
    entityKey: 'approved-subject',
    status: 'approved_for_draft',
    validationStatus: 'passed',
    validationErrors: [],
    proposedPayload: {},
    normalizedPayload: {},
    diff: { operation: 'add', safety: { warnings: [] } },
    events: [],
  },
  exports: [],
});
assert.match(approvedProposal, /Continue to publishing/);
assert.doesNotMatch(approvedProposal, /name="action" value="approve_for_draft"/);

console.log('Admin UI and freshness checks passed.');
