import assert from 'node:assert/strict';
import { buildContentFreshness } from '../lib/content-freshness.js';
import { createStructuredDiff } from '../lib/diff-engine.js';
import { validateProposalPayload } from '../lib/proposal-validation.js';
import { proposalActionAllowed } from '../lib/proposals.js';
import { releaseArtifactsMutable } from '../lib/release-candidates.js';
import { adminMutationIsSameOrigin } from '../routes/admin.js';
import {
  renderAdminChecksPage,
  renderAssetDetailPage,
  renderContentIntakePage,
  renderDashboard,
  renderFreshnessPage,
  renderGuidedProcessingPage,
  renderParseResultDetailPage,
  renderProposalCreatePage,
  renderProposalDetailPage,
  renderReviewQueuePage,
  renderReleaseApplyPlanDetailPage,
  renderReleaseCandidateDetailPage,
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

function adminRequest({ method = 'POST', protocol = 'https', headers = {} } = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
  return {
    method,
    protocol,
    get(name) {
      return normalizedHeaders[String(name).toLowerCase()];
    },
  };
}

assert.equal(adminMutationIsSameOrigin(adminRequest({ method: 'GET' }), { nodeEnv: 'production' }), true);
assert.equal(adminMutationIsSameOrigin(adminRequest({
  headers: { host: 'admin.example.com', origin: 'https://admin.example.com' },
}), { nodeEnv: 'production' }), true);
assert.equal(adminMutationIsSameOrigin(adminRequest({
  headers: { host: 'admin.example.com', origin: 'https://attacker.example' },
}), { nodeEnv: 'production' }), false);
assert.equal(adminMutationIsSameOrigin(adminRequest({
  headers: { host: 'admin.example.com', origin: 'https://admin.example.com/untrusted-path' },
}), { nodeEnv: 'production' }), false);
assert.equal(adminMutationIsSameOrigin(adminRequest({
  headers: { host: 'admin.example.com', origin: 'not a URL' },
}), { nodeEnv: 'production' }), false);
assert.equal(adminMutationIsSameOrigin(adminRequest({
  headers: { host: 'admin.example.com', 'sec-fetch-site': 'same-origin' },
}), { nodeEnv: 'production' }), true);
assert.equal(adminMutationIsSameOrigin(adminRequest({
  headers: { host: 'admin.example.com', 'sec-fetch-site': 'cross-site' },
}), { nodeEnv: 'production' }), false);
assert.equal(adminMutationIsSameOrigin(adminRequest()), false);

const dashboard = renderDashboard({
  contentSource: 'json',
  counts: {
    subjectsTotal: 436,
    subjectsVerified: 436,
    subjectsNeedsVerification: 0,
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
    runtime: { nodeVersion: 'v24', contentSource: 'json', contentPublicationMode: 'github_pr', adminEnabled: true, adminConfigured: true, askEnabled: false },
    db: { configured: true, skipped: false, connected: true, ok: true, expectedMigrations: 26, appliedMigrations: 26, pendingMigrations: [], message: 'ok' },
    storage: { ok: true, configured: true, provider: 'r2', message: 'private R2 adapter configured' },
    content: { source: 'json', subjectsTotal: 436, subjectsVerified: 436, subjectPages: 403, subjectListings: 33, subjectsNeedsVerification: 0, subjectsPlaceholder: 0, collegesTotal: 376, branchProfilesTotal: 6, guidesTotal: 1 },
    searchIndex: { ok: true, total: 786, byType: { subject: 403, college: 376, branch_profile: 6, guide: 1 }, path: '/dist/search-index.json' },
  },
});
assert.doesNotMatch(checks, /needs attention/);
assert.doesNotMatch(checks, /619/);
assert.match(checks, /github_pr/);
assert.match(checks, /private R2 adapter configured/);

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

const guidePayload = {
  id: 'R23 Internships and Projects',
  regulation: 'r23',
  name: 'R23 Internships and Projects',
  intro: 'Official milestone guidance.',
  seo: {
    slug: 'R23 Internships and Projects',
    title: 'R23 Internships and Projects Guide',
    meta_description: 'Official R23 internship and final project guidance for JNTUK students.',
  },
  sections: [{ id: 'Community Project', title: 'Community Project', body: 'Complete the official milestone.' }],
  source: {
    status: 'needs_verification',
    origin_url: 'https://jntuk.edu.in/r23-regulations.pdf',
    retrieved_date: '2026-07-18',
  },
};
const guideValidation = validateProposalPayload({
  root: process.cwd(),
  entityType: 'guide',
  payload: guidePayload,
});
assert.equal(guideValidation.status, 'passed');
assert.equal(guideValidation.normalizedPayload.id, 'r23-internships-and-projects');
assert.equal(guideValidation.normalizedPayload.regulation, 'R23');
assert.equal(guideValidation.normalizedPayload.seo.slug, 'r23-internships-and-projects');
assert.equal(guideValidation.normalizedPayload.sections[0].id, 'community-project');

const guideDiff = createStructuredDiff({
  content: {
    data: { subjects: [], guides: [{ ...guideValidation.normalizedPayload, intro: 'Before' }] },
    guides: [{ ...guideValidation.normalizedPayload, intro: 'Before' }],
    colleges: [],
    branchProfiles: [],
  },
  entityType: 'guide',
  entityKey: 'R23 Internships and Projects',
  proposedPayload: { ...guideValidation.normalizedPayload, intro: 'After' },
});
assert.equal(guideDiff.diff.operation, 'merge_update');
assert.equal(guideDiff.diff.match.found_existing, true);
assert.equal(guideDiff.proposedPayload.intro, 'After');

const proposalCreate = renderProposalCreatePage({ values: { entity_type: 'guide' } });
assert.match(proposalCreate, /value="guide" selected>guide \(manual only\)<\/option>/);
assert.match(proposalCreate, /Guide proposals are manual-only/);

const parseDetail = renderParseResultDetailPage({
  result: {
    id: 9,
    status: 'success',
    parserKey: 'pdf-text-basic',
    assetId: 4,
    assetFilename: 'guide.pdf',
    parsedPayload: {},
    confidence: {},
  },
});
assert.match(parseDetail, /value="guide">guide \(manual payload only\)<\/option>/);
assert.match(parseDetail, /Automatic guide extraction is not available/);

const invalidR2Asset = renderAssetDetailPage({
  asset: {
    id: 8,
    originalFilename: 'official.pdf',
    storageProvider: 'r2',
    storageKey: 'source-assets/sha256/ab/abcdef',
    sha256Checksum: 'a'.repeat(64),
    discoverySourceId: 2,
    discoverySourceName: 'Official source',
    sourceUrl: 'https://jntuk.edu.in/official.pdf',
  },
  fileStatus: {
    status: 'invalid',
    exists: false,
    repairAvailable: true,
    integrityError: 'Asset checksum mismatch.',
  },
  parsers: [{ key: 'pdf-text-basic', label: 'PDF reader', version: '1', available: true }],
});
assert.match(invalidR2Asset, /Stored evidence failed its integrity check/);
assert.match(invalidR2Asset, /source-assets\/sha256\/ab\/abcdef/);
assert.match(invalidR2Asset, /Repair evidence/);
assert.doesNotMatch(invalidR2Asset, />Run parser<\/button>/);

const releaseCandidate = renderReleaseCandidateDetailPage({
  release: {
    id: 12,
    title: 'Reviewed guide release',
    status: 'ready_for_review',
    publicationMode: 'github_pr',
    itemCount: 1,
    exportedCount: 1,
    draftAppliedCount: 1,
    revisionCount: 1,
    items: [],
  },
  reviewSummary: { has_blocking_warnings: false, warnings: [], items: [] },
  githubPublication: {
    id: 3,
    status: 'pr_open',
    pullRequestNumber: 44,
    pullRequestUrl: 'https://github.com/example/site/pull/44',
  },
});
assert.match(releaseCandidate, /Review PR open/);
assert.match(releaseCandidate, /Open sealed apply plan and publication/);
assert.match(releaseCandidate, /Open review PR #44/);
assert.doesNotMatch(releaseCandidate, /action="\/admin\/release-candidates\/12\/apply-plan"/);
assert.doesNotMatch(releaseCandidate, /NOT PUBLISHED/);
assert.doesNotMatch(releaseCandidate, /Recover timeout\/partial live apply/);

for (const [status, label] of [
  ['deployed', 'Deployed and verified'],
  ['superseded', 'Superseded by a newer release'],
  ['tampered', 'Blocked · integrity failure'],
]) {
  const lifecyclePage = renderReleaseCandidateDetailPage({
    release: {
      id: 12,
      title: 'Reviewed guide release',
      status: 'ready_for_review',
      publicationMode: 'github_pr',
      itemCount: 1,
      exportedCount: 1,
      draftAppliedCount: 1,
      revisionCount: 1,
      items: [],
    },
    reviewSummary: { has_blocking_warnings: false, warnings: [], items: [] },
    githubPublication: { id: 3, status },
  });
  assert.match(lifecyclePage, new RegExp(label));
  assert.doesNotMatch(lifecyclePage, /action="\/admin\/release-candidates\/12\/apply-plan"/);
}

const releasePlan = renderReleaseApplyPlanDetailPage({
  plan: {
    release_candidate_id: 12,
    status: 'ready_for_review',
    generated_at: '2026-07-18T00:00:00.000Z',
    final_warnings: [],
    informational_warnings: [],
    changes: [{
      order: 1,
      file: 'data/guides.json',
      operation: 'replace',
      entity_type: 'guide',
      entity_key: 'r23-internships-and-projects',
      proposal_id: 7,
      after_json: guideValidation.normalizedPayload,
    }],
    ordered_file_changes: [],
    combined_patch: [],
    storage: { tmp_artifact_status: 'available' },
  },
  publicationMode: 'github_pr',
  githubTrustReady: true,
  githubPublication: {
    id: 3,
    status: 'pr_open',
    pullRequestNumber: 44,
    pullRequestUrl: 'https://github.com/example/site/pull/44',
    branchName: 'jntustack/rc-12-0123456789ab',
    baseSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    artifactHash: 'c'.repeat(64),
    attemptCount: 1,
  },
});
assert.match(releasePlan, /Human-gated publication workflow/);
assert.match(releasePlan, /Review PR #44/);
assert.match(releasePlan, /Review PR open/);
assert.match(releasePlan, /Refresh status/);
assert.doesNotMatch(releasePlan, /NOT PUBLISHED/);
assert.doesNotMatch(releasePlan, /Apply to live JSON/);
assert.doesNotMatch(releasePlan, /merge[^<]*button/i);

const trustBlockedPlan = renderReleaseApplyPlanDetailPage({
  plan: {
    release_candidate_id: 13,
    status: 'ready_for_review',
    generated_at: '2026-07-18T00:00:00.000Z',
    final_warnings: [],
    informational_warnings: [],
    changes: [{
      order: 1,
      file: 'data/guides.json',
      operation: 'replace',
      entity_type: 'guide',
      entity_key: 'r23-internships-and-projects',
      proposal_id: 8,
      after_json: guideValidation.normalizedPayload,
    }],
    ordered_file_changes: [],
    combined_patch: [],
    storage: { tmp_artifact_status: 'available' },
  },
  publicationMode: 'github_pr',
  githubTrustReady: false,
});
assert.match(trustBlockedPlan, /Publication trust gate is closed/);
assert.doesNotMatch(trustBlockedPlan, /action="\/admin\/release-apply-plans\/13\/publish-github"/);

console.log('Admin UI and freshness checks passed.');
