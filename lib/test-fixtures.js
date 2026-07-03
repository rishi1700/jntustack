import fs from 'node:fs/promises';
import path from 'node:path';
import { getDbPool, describeDbError } from './db.js';
import { createContentProposal, reviewContentProposal } from './proposals.js';
import {
  addProposalToReleaseCandidate,
  applyReleaseCandidateItemDraft,
  createReleaseCandidate,
  exportReleaseCandidateItem,
  getReleaseCandidate,
  markReleaseCandidateReady,
} from './release-candidates.js';
import { generateReleaseReviewSummary } from './release-review.js';

const TEST_ENTITY_KEY = 'test-pr24-release-dry-run';
const TEST_RELEASE_TITLE_PREFIX = 'TEST Fixture Release';

function testSubjectPayload() {
  return {
    id: TEST_ENTITY_KEY,
    regulation: 'R23',
    branch: 'CSE',
    specialization: 'CSE',
    year: 4,
    semester: 2,
    year_sem_label: '4-2',
    subject_code: null,
    name: 'Test Fixture Release Dry Run',
    category: 'ProfessionalElective',
    credits: {
      L: 0,
      T: 0,
      P: 0,
      C: 0,
    },
    type: 'theory',
    units: [],
    course_outcomes: [],
    resources: {
      lecture_notes_pdf: null,
      previous_question_papers_pdf: null,
      lab_manual_pdf: null,
    },
    seo: {
      slug: TEST_ENTITY_KEY,
      title: 'Test Fixture Release Dry Run',
      meta_description: 'Test-only fixture for JNTUStack admin release candidate dry runs.',
    },
    legacy_equivalent_id: null,
    source: {
      origin_url: null,
      retrieved_date: null,
      status: 'needs_verification',
      college_source_note: null,
    },
    notes: 'TEST FIXTURE ONLY. Not real content. Created by ADMIN_TEST_TOOLS dry run.',
  };
}

async function audit(connOrPool, { actor, action, entityType, entityId, before = null, after = null }) {
  await connOrPool.execute(
    `INSERT INTO audit_log
      (actor, action, entity_type, entity_id, before_json, after_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      actor,
      action,
      entityType,
      entityId == null ? null : String(entityId),
      before == null ? null : JSON.stringify(before),
      after == null ? null : JSON.stringify(after),
    ]
  );
}

function assertTestEntityKey(entityKey) {
  if (!String(entityKey || '').startsWith('test-')) {
    throw new Error('Test fixture entity_key must start with test-.');
  }
}

function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(', ');
}

async function removeFixturePaths(root, paths) {
  const removed = [];
  for (const relativePath of paths) {
    if (!relativePath || !String(relativePath).startsWith('tmp/')) continue;
    const absolutePath = path.join(root, relativePath);
    await fs.rm(absolutePath, { recursive: true, force: true });
    removed.push(relativePath);
  }
  return removed;
}

export async function cleanupTestFixtures({ root = process.cwd(), actor = null } = {}) {
  const pool = await getDbPool({ requireConfigured: true });
  const conn = await pool.getConnection();
  const removedPaths = [];
  try {
    await conn.beginTransaction();
    const [proposalRows] = await conn.execute(
      "SELECT id FROM content_proposals WHERE entity_key LIKE 'test-%'"
    );
    const proposalIds = proposalRows.map(row => row.id);

    const releaseParams = [...proposalIds];
    const releaseProposalClause = proposalIds.length
      ? `OR rci.proposal_id IN (${placeholders(proposalIds.length)})`
      : '';
    const [releaseRows] = await conn.execute(
      `SELECT DISTINCT rc.id
       FROM release_candidates rc
       LEFT JOIN release_candidate_items rci ON rci.release_candidate_id = rc.id
       WHERE rc.title LIKE 'TEST Fixture%' ${releaseProposalClause}`,
      releaseParams
    );
    const releaseIds = releaseRows.map(row => row.id);
    removedPaths.push(...releaseIds.map(id => path.join('tmp', 'release-apply-plans', String(id))));

    const [liveApplyRows] = releaseIds.length
      ? await conn.execute(
        `SELECT id, backup_path FROM release_live_applies WHERE release_candidate_id IN (${placeholders(releaseIds.length)})`,
        releaseIds
      )
      : [[]];
    removedPaths.push(...liveApplyRows.map(row => row.backup_path));

    const [exportRows] = proposalIds.length
      ? await conn.execute(
        `SELECT id, export_path FROM proposal_exports WHERE proposal_id IN (${placeholders(proposalIds.length)})`,
        proposalIds
      )
      : [[]];
    const exportIds = exportRows.map(row => row.id);

    const [draftRows] = proposalIds.length
      ? await conn.execute(
        `SELECT id, draft_path FROM proposal_draft_applies WHERE proposal_id IN (${placeholders(proposalIds.length)})`,
        proposalIds
      )
      : [[]];
    const draftIds = draftRows.map(row => row.id);
    removedPaths.push(...exportRows.map(row => row.export_path), ...draftRows.map(row => row.draft_path));

    if (releaseIds.length) {
      await conn.execute(
        `DELETE FROM release_candidates WHERE id IN (${placeholders(releaseIds.length)})`,
        releaseIds
      );
    }

    const revisionClauses = ["entity_key LIKE 'test-%'"];
    const revisionParams = [];
    if (proposalIds.length) {
      revisionClauses.push(`proposal_id IN (${placeholders(proposalIds.length)})`);
      revisionParams.push(...proposalIds);
    }
    if (exportIds.length) {
      revisionClauses.push(`export_id IN (${placeholders(exportIds.length)})`);
      revisionParams.push(...exportIds);
    }
    if (draftIds.length) {
      revisionClauses.push(`draft_apply_id IN (${placeholders(draftIds.length)})`);
      revisionParams.push(...draftIds);
    }
    await conn.execute(
      `DELETE FROM content_revisions WHERE ${revisionClauses.join(' OR ')}`,
      revisionParams
    );

    if (proposalIds.length) {
      await conn.execute(
        `DELETE FROM proposal_draft_applies WHERE proposal_id IN (${placeholders(proposalIds.length)})`,
        proposalIds
      );
      await conn.execute(
        `DELETE FROM proposal_exports WHERE proposal_id IN (${placeholders(proposalIds.length)})`,
        proposalIds
      );
      await conn.execute(
        `DELETE FROM content_proposals WHERE id IN (${placeholders(proposalIds.length)})`,
        proposalIds
      );
    }

    const summary = {
      proposal_count: proposalIds.length,
      release_candidate_count: releaseIds.length,
      export_count: exportIds.length,
      draft_apply_count: draftIds.length,
      removed_paths: removedPaths,
    };
    await audit(conn, {
      actor,
      action: 'test_fixture.cleanup',
      entityType: 'test_fixture',
      entityId: TEST_ENTITY_KEY,
      after: summary,
    });
    await conn.commit();

    const removedStoragePaths = await removeFixturePaths(root, removedPaths);
    return { ...summary, removed_paths: removedStoragePaths };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function runReleaseCandidateDryRun({ root = process.cwd(), actor = null } = {}) {
  assertTestEntityKey(TEST_ENTITY_KEY);
  await cleanupTestFixtures({ root, actor });

  const proposalId = await createContentProposal({
    root,
    entityType: 'subject',
    entityKey: TEST_ENTITY_KEY,
    proposedPayload: testSubjectPayload(),
    createdBy: actor,
    note: 'TEST FIXTURE ONLY: PR24 release candidate dry-run proposal.',
  });

  await reviewContentProposal({
    id: proposalId,
    action: 'approve_for_draft',
    note: 'TEST FIXTURE ONLY: approving for release candidate dry run.',
    actor,
  });

  const releaseCandidateId = await createReleaseCandidate({
    title: `${TEST_RELEASE_TITLE_PREFIX} ${new Date().toISOString()}`,
    actor,
  });
  const itemId = await addProposalToReleaseCandidate({
    releaseCandidateId,
    proposalId,
    actor,
  });
  const proposalExport = await exportReleaseCandidateItem({
    root,
    releaseCandidateId,
    itemId,
    actor,
  });
  const draftApply = await applyReleaseCandidateItemDraft({
    root,
    releaseCandidateId,
    itemId,
    actor,
  });
  const reviewSummary = await generateReleaseReviewSummary({
    releaseCandidateId,
    actor,
    auditEvents: true,
  });
  const readyRelease = await markReleaseCandidateReady({
    releaseCandidateId,
    actor,
  });
  const release = await getReleaseCandidate(releaseCandidateId);
  const result = {
    entity_key: TEST_ENTITY_KEY,
    proposal_id: Number(proposalId),
    release_candidate_id: Number(releaseCandidateId),
    item_id: Number(itemId),
    export_id: Number(proposalExport.id),
    draft_apply_id: Number(draftApply.id),
    revision_id: draftApply.summary?.revision_id || null,
    review_summary: {
      item_count: reviewSummary.item_count,
      blocking_warning_count: reviewSummary.blocking_warning_count,
      files_that_would_change: reviewSummary.files_that_would_change,
    },
    ready_status: readyRelease.status,
    release_status: release?.status,
    not_published: true,
  };

  const pool = await getDbPool({ requireConfigured: true });
  await audit(pool, {
    actor,
    action: 'test_fixture.create',
    entityType: 'test_fixture',
    entityId: TEST_ENTITY_KEY,
    after: result,
  });
  return result;
}

export function testFixtureErrorSummary(err) {
  const safe = describeDbError(err);
  if (err?.name === 'DatabaseConfigError') {
    return 'Test fixtures require MySQL configuration. Set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, and run migrations.';
  }
  if (safe.code === 'ER_NO_SUCH_TABLE' || safe.code === 'ER_BAD_FIELD_ERROR') {
    return 'Test fixture tables are missing or out of date. Run npm run db:migrate.';
  }
  return `${safe.code ? `${safe.code}: ` : ''}${safe.message}`;
}
