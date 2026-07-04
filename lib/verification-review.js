import { loadContent } from './content-store/index.js';
import { describeDbError, getDbPool } from './db.js';
import { createStructuredDiff } from './diff-engine.js';
import {
  normalizeEntityKey,
  validateProposalPayload,
} from './proposal-validation.js';

export const PROMOTE_TO_VERIFIED_CONFIRMATION = 'PROMOTE TO VERIFIED';

export const PROMOTION_CHECKLIST = [
  { key: 'source_opened_reviewed', label: 'Source opened/reviewed' },
  { key: 'title_matches_source', label: 'Title matches source' },
  { key: 'category_type_correct', label: 'Category/type correct' },
  { key: 'credits_correct', label: 'Credits correct' },
  { key: 'year_semester_correct', label: 'Year/semester correct' },
  { key: 'no_fabricated_units_outcomes', label: 'No fabricated units/outcomes' },
  { key: 'caveat_text_correct', label: 'Caveat text correct' },
];

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  return JSON.parse(value);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function uniqueSorted(values) {
  return [...new Set(values.filter(value => value !== '' && value != null).map(String))]
    .sort((a, b) => a.localeCompare(b));
}

function findSubject(content, subjectId) {
  const key = normalize(subjectId);
  return (content.data.subjects || []).find(subject => [
    subject.id,
    subject.seo?.slug,
    subject.subject_code,
    subject.name,
  ].some(candidate => normalize(candidate) === key)) || null;
}

function hasArrayItems(value) {
  return Array.isArray(value) && value.length > 0;
}

function hasCredits(subject) {
  const credits = subject?.credits;
  return Boolean(credits && typeof credits === 'object' && Object.values(credits).some(value => value !== null && value !== undefined && value !== ''));
}

function sourceLabel(source = {}) {
  return [
    source.origin_url || '',
    source.college_source_note || '',
    source.retrieved_date || '',
  ].filter(Boolean).join(' ');
}

function subjectSummary(subject) {
  return {
    id: subject.id,
    name: subject.name,
    regulation: subject.regulation,
    branch: subject.branch,
    year: subject.year,
    semester: subject.semester,
    yearSemLabel: subject.year_sem_label,
    category: subject.category,
    type: subject.type,
    credits: subject.credits || null,
    hasCredits: hasCredits(subject),
    hasUnits: hasArrayItems(subject.units),
    hasOutcomes: hasArrayItems(subject.course_outcomes),
    source: subject.source || {},
    slug: subject.seo?.slug || subject.id,
  };
}

function matchesFilters(subject, filters = {}) {
  if (filters.branch && subject.branch !== filters.branch) return false;
  if (filters.year && String(subject.year || '') !== String(filters.year)) return false;
  if (filters.semester && String(subject.semester || '') !== String(filters.semester)) return false;
  if (filters.source && !sourceLabel(subject.source).toLowerCase().includes(String(filters.source).trim().toLowerCase())) return false;
  return true;
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

export function isVerifiedPromotionDiff(diffValue) {
  const diff = parseJson(diffValue, null);
  return diff?.workflow?.type === 'verified_promotion';
}

export function buildVerifiedPromotionPayload(subject) {
  const payload = clone(subject);
  payload.source = { ...(payload.source || {}), status: 'verified' };
  return payload;
}

export function normalizePromotionChecklist(input = {}) {
  return Object.fromEntries(PROMOTION_CHECKLIST.map(item => [
    item.key,
    input[item.key] === true || input[item.key] === 'on' || input[item.key] === 'yes',
  ]));
}

export function validatePromotionReview({ root = process.cwd(), subject, checklist = {}, reviewerNote = '', confirmationPhrase = '' }) {
  const errors = [];
  const normalizedChecklist = normalizePromotionChecklist(checklist);

  if (!subject) {
    errors.push('Subject draft was not found.');
    return { status: 'failed', errors, checklist: normalizedChecklist, payload: null, validation: null };
  }
  if (subject.source?.status !== 'needs_verification') {
    errors.push('Only needs_verification subject drafts can be promoted.');
  }
  if (!subject.source?.origin_url || !String(subject.source.origin_url).trim()) {
    errors.push('Source/provenance origin_url is required before promotion.');
  }
  for (const item of PROMOTION_CHECKLIST) {
    if (!normalizedChecklist[item.key]) errors.push(`Checklist item is required: ${item.label}.`);
  }
  if (!String(reviewerNote || '').trim()) {
    errors.push('Reviewer note is required.');
  }
  if (String(confirmationPhrase || '').trim() !== PROMOTE_TO_VERIFIED_CONFIRMATION) {
    errors.push(`Confirmation phrase must be exactly: ${PROMOTE_TO_VERIFIED_CONFIRMATION}.`);
  }

  const payload = subject ? buildVerifiedPromotionPayload(subject) : null;
  const validation = payload
    ? validateProposalPayload({
      root,
      entityType: 'subject',
      payload,
      allowVerifiedSource: true,
    })
    : null;
  if (validation && validation.status !== 'passed') {
    errors.push('Verified promotion payload failed schema validation.');
  }

  return {
    status: errors.length ? 'failed' : 'passed',
    errors,
    checklist: normalizedChecklist,
    payload,
    validation,
  };
}

async function listActivePromotionProposals(conn, entityKey) {
  const [rows] = await conn.execute(
    `SELECT id, status, proposed_payload_json, diff_json, created_at
     FROM content_proposals
     WHERE entity_type = 'subject'
       AND entity_key = ?
       AND status IN ('needs_review', 'approved_for_draft')
     ORDER BY id DESC
     LIMIT 25`,
    [entityKey]
  );
  return rows
    .map(row => ({
      ...row,
      proposedPayload: parseJson(row.proposed_payload_json, {}),
      diff: parseJson(row.diff_json, null),
    }))
    .filter(row => row.proposedPayload?.source?.status === 'verified' || row.diff?.workflow?.type === 'verified_promotion');
}

export async function listNeedsVerificationSubjects({ root = process.cwd(), filters = {} } = {}) {
  const content = await loadContent({ root });
  const drafts = (content.data.subjects || [])
    .filter(subject => subject.source?.status === 'needs_verification')
    .filter(subject => matchesFilters(subject, filters));

  const allDrafts = (content.data.subjects || []).filter(subject => subject.source?.status === 'needs_verification');
  const filterOptions = {
    branches: uniqueSorted(allDrafts.map(subject => subject.branch)),
    years: uniqueSorted(allDrafts.map(subject => subject.year)),
    semesters: uniqueSorted(allDrafts.map(subject => subject.semester)),
  };

  return {
    subjects: drafts
      .map(subjectSummary)
      .sort((a, b) => [
        String(a.branch || '').localeCompare(String(b.branch || '')),
        Number(a.year || 0) - Number(b.year || 0),
        Number(a.semester || 0) - Number(b.semester || 0),
        String(a.name || '').localeCompare(String(b.name || '')),
      ].find(value => value !== 0) || 0),
    totalDrafts: allDrafts.length,
    filters,
    filterOptions,
    contentSource: content.source,
  };
}

export async function getVerificationReviewSubject({ root = process.cwd(), subjectId }) {
  const content = await loadContent({ root });
  const subject = findSubject(content, subjectId);
  if (!subject || subject.source?.status !== 'needs_verification') return null;

  const proposedPayload = buildVerifiedPromotionPayload(subject);
  const diff = createStructuredDiff({
    content,
    entityType: 'subject',
    entityKey: subject.id,
    proposedPayload,
  });
  const validation = validateProposalPayload({
    root,
    entityType: 'subject',
    payload: proposedPayload,
    allowVerifiedSource: true,
  });

  return {
    subject,
    summary: subjectSummary(subject),
    proposedPayload,
    diff,
    validation,
  };
}

export async function recordVerificationReviewStarted({ subjectId, actor = null }) {
  const pool = await getDbPool({ requireConfigured: true });
  await audit(pool, {
    actor,
    action: 'verification_review.started',
    entityType: 'subject',
    entityId: subjectId,
    after: { subject_id: subjectId },
  });
}

export async function createVerifiedPromotionProposal({
  root = process.cwd(),
  subjectId,
  checklist = {},
  reviewerNote = '',
  confirmationPhrase = '',
  actor = null,
}) {
  const content = await loadContent({ root });
  const subject = findSubject(content, subjectId);
  const review = validatePromotionReview({
    root,
    subject,
    checklist,
    reviewerNote,
    confirmationPhrase,
  });
  const entityKey = normalizeEntityKey('subject', subject?.id || subjectId);
  const pool = await getDbPool({ requireConfigured: true });
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    if (review.status !== 'passed') {
      await audit(conn, {
        actor,
        action: 'verification_review.blocked',
        entityType: 'subject',
        entityId: subjectId,
        after: {
          subject_id: subjectId,
          errors: review.errors,
          checklist: review.checklist,
        },
      });
      await conn.commit();
      const err = new Error(review.errors.join(' '));
      err.auditCommitted = true;
      throw err;
    }

    const activePromotions = await listActivePromotionProposals(conn, entityKey);
    if (activePromotions.length) {
      await audit(conn, {
        actor,
        action: 'verification_review.blocked',
        entityType: 'subject',
        entityId: subject.id,
        after: {
          subject_id: subject.id,
          reason: 'active_verified_promotion_proposal_exists',
          proposal_ids: activePromotions.map(row => row.id),
        },
      });
      await conn.commit();
      const err = new Error(`An active verified promotion proposal already exists for this subject: ${activePromotions.map(row => row.id).join(', ')}.`);
      err.auditCommitted = true;
      throw err;
    }

    const structured = createStructuredDiff({
      content,
      entityType: 'subject',
      entityKey: subject.id,
      proposedPayload: review.validation.normalizedPayload,
    });
    const diff = {
      ...structured.diff,
      workflow: {
        type: 'verified_promotion',
        checklist: review.checklist,
        reviewer_note: reviewerNote.trim(),
      },
    };

    const [result] = await conn.execute(
      `INSERT INTO content_proposals
        (entity_type, entity_key, proposed_payload_json, diff_json, source_id,
         parse_result_id, diff_result_id, status, created_by)
       VALUES ('subject', ?, ?, ?, NULL, NULL, NULL, 'needs_review', ?)`,
      [
        entityKey,
        JSON.stringify(review.validation.normalizedPayload),
        JSON.stringify(diff),
        actor,
      ]
    );
    const proposalId = result.insertId;

    await conn.execute(
      `UPDATE content_proposals
       SET validation_status = 'passed', validation_errors_json = '[]', normalized_payload_json = ?
       WHERE id = ?`,
      [JSON.stringify(review.validation.normalizedPayload), proposalId]
    );

    await conn.execute(
      `INSERT INTO review_events
        (proposal_id, actor, action, from_status, to_status, note)
       VALUES (?, ?, 'verification_review.approved', NULL, 'needs_review', ?)`,
      [proposalId, actor, reviewerNote.trim()]
    );

    const [afterRows] = await conn.execute('SELECT * FROM content_proposals WHERE id = ?', [proposalId]);
    await audit(conn, {
      actor,
      action: 'verification_review.approved',
      entityType: 'content_proposal',
      entityId: proposalId,
      before: { subject_id: subject.id, source_status: subject.source?.status },
      after: {
        proposal_id: proposalId,
        subject_id: subject.id,
        validation_status: 'passed',
        checklist: review.checklist,
      },
    });
    await audit(conn, {
      actor,
      action: 'verification_review.promoted',
      entityType: 'content_proposal',
      entityId: proposalId,
      before: { subject_id: subject.id, source_status: subject.source?.status },
      after: {
        proposal_id: proposalId,
        subject_id: subject.id,
        source_status: 'verified',
        proposal_only: true,
      },
    });
    await audit(conn, {
      actor,
      action: 'content_proposal.create',
      entityType: 'content_proposal',
      entityId: proposalId,
      after: afterRows[0],
    });

    await conn.commit();
    return { proposalId, subjectId: subject.id };
  } catch (err) {
    if (!err?.auditCommitted) await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export function verificationReviewErrorSummary(err) {
  const safe = describeDbError(err);
  if (err?.name === 'DatabaseConfigError') {
    return 'Verified promotion workflow requires MySQL configuration. Set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, and run migrations.';
  }
  if (safe.code === 'ER_NO_SUCH_TABLE' || safe.code === 'ER_BAD_FIELD_ERROR') {
    return 'Verified promotion workflow tables are missing or out of date. Run npm run db:migrate.';
  }
  return `${safe.code ? `${safe.code}: ` : ''}${safe.message}`;
}
