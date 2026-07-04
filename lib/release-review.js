import { describeDbError, getDbPool } from './db.js';

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  return JSON.parse(value);
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
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

function filesForItem(row) {
  const draftSummary = parseJson(row.draft_summary_json, null);
  const exportPayload = parseJson(row.export_payload_json, null);
  const files = [];
  if (Array.isArray(draftSummary?.changed_files)) files.push(...draftSummary.changed_files);
  if (draftSummary?.target_file) files.push(draftSummary.target_file);
  if (exportPayload?.target?.data_file_hint) files.push(exportPayload.target.data_file_hint);
  return unique(files.map(file => String(file).replaceAll('\\', '/')));
}

function diffForItem(row) {
  const exportPayload = parseJson(row.export_payload_json, null);
  const patch = Array.isArray(exportPayload?.patch) ? exportPayload.patch : [];
  return {
    proposal_id: row.proposal_id,
    entity_type: row.entity_type,
    entity_key: row.entity_key,
    operation: exportPayload?.target?.operation || patch[0]?.op || null,
    target_file: exportPayload?.target?.data_file_hint || null,
    patch_count: patch.length,
    patch_paths: patch.map(item => item.path).filter(Boolean),
  };
}

function promotionMetadataForItem(row) {
  const exportPayload = parseJson(row.export_payload_json, null);
  const proposalPayload = parseJson(row.normalized_payload_json, parseJson(row.proposed_payload_json, null));
  const diff = parseJson(row.diff_json, null);
  const replacement = exportPayload?.replacement || exportPayload?.patch?.[0]?.value || proposalPayload;
  return {
    workflow_type: diff?.workflow?.type || null,
    public_source: replacement?.source || null,
  };
}

function itemSummaryFromRow(row) {
  const promotionMetadata = promotionMetadataForItem(row);
  return {
    item_id: row.id,
    proposal_id: row.proposal_id,
    proposal_export_id: row.proposal_export_id,
    draft_apply_id: row.draft_apply_id,
    revision_id: row.revision_id,
    entity_type: row.entity_type,
    entity_key: row.entity_key,
    proposal_status: row.proposal_status,
    proposal_validation_status: row.proposal_validation_status || 'not_validated',
    export_validation_status: row.export_validation_status || (row.proposal_export_id ? 'not_validated' : 'missing'),
    draft_validation_status: row.draft_validation_status || (row.draft_apply_id ? 'not_validated' : 'missing'),
    files: filesForItem(row),
    diff: diffForItem(row),
    workflow_type: promotionMetadata.workflow_type,
    public_source: promotionMetadata.public_source,
    links: {
      proposal: `/admin/proposals/${row.proposal_id}`,
      export: row.proposal_export_id ? `/admin/proposal-exports/${row.proposal_export_id}` : null,
      draft_apply: row.draft_apply_id ? `/admin/proposal-draft-applies/${row.draft_apply_id}` : null,
      revision: row.revision_id ? `/admin/revisions/${row.revision_id}` : null,
    },
  };
}

function addWarning(warnings, {
  code,
  message,
  severity = 'blocking',
  blocking = true,
  itemId = null,
  proposalId = null,
  entityKey = null,
  file = null,
}) {
  warnings.push({
    code,
    severity,
    blocking,
    message,
    item_id: itemId,
    proposal_id: proposalId,
    entity_key: entityKey,
    file,
  });
}

function isValidationReady(item) {
  return item.proposal_validation_status === 'passed'
    && item.proposal_export_id
    && item.export_validation_status === 'passed'
    && item.draft_apply_id
    && item.draft_validation_status === 'passed'
    && item.revision_id;
}

function isAppendPath(path) {
  return /^\/[^/]+\/-$/.test(String(path || ''));
}

function safeSameFileAdds(items) {
  const entityKeys = new Set();
  for (const item of items) {
    const entityKey = `${item.entity_type}:${normalize(item.entity_key)}`;
    if (!item.entity_key || entityKeys.has(entityKey)) return false;
    entityKeys.add(entityKey);

    if (!isValidationReady(item)) return false;
    if (item.diff.operation !== 'add') return false;
    if (item.diff.patch_count !== 1) return false;
    if (item.diff.patch_paths.length !== 1 || !isAppendPath(item.diff.patch_paths[0])) return false;
  }
  return true;
}

function buildWarnings(items) {
  const warnings = [];
  if (items.length === 0) {
    addWarning(warnings, {
      code: 'no_items',
      message: 'Release candidate has no proposals.',
    });
  }

  const entityCounts = new Map();
  const fileItems = new Map();

  for (const item of items) {
    const entityKey = `${item.entity_type}:${normalize(item.entity_key)}`;
    entityCounts.set(entityKey, (entityCounts.get(entityKey) || 0) + 1);
    for (const file of item.files) {
      if (!fileItems.has(file)) fileItems.set(file, []);
      fileItems.get(file).push(item);
    }

    if (item.proposal_validation_status !== 'passed') {
      addWarning(warnings, {
        code: 'validation_failed',
        message: `Proposal ${item.proposal_id} validation is ${item.proposal_validation_status}.`,
        itemId: item.item_id,
        proposalId: item.proposal_id,
        entityKey: item.entity_key,
      });
    }
    if (!item.proposal_export_id) {
      addWarning(warnings, {
        code: 'missing_export',
        message: `Proposal ${item.proposal_id} has no export.`,
        itemId: item.item_id,
        proposalId: item.proposal_id,
        entityKey: item.entity_key,
      });
    } else if (item.export_validation_status !== 'passed') {
      addWarning(warnings, {
        code: 'validation_failed',
        message: `Export ${item.proposal_export_id} validation is ${item.export_validation_status}.`,
        itemId: item.item_id,
        proposalId: item.proposal_id,
        entityKey: item.entity_key,
      });
    }
    if (!item.draft_apply_id) {
      addWarning(warnings, {
        code: 'missing_draft_apply',
        message: `Proposal ${item.proposal_id} has not been applied to a draft workspace.`,
        itemId: item.item_id,
        proposalId: item.proposal_id,
        entityKey: item.entity_key,
      });
    } else if (item.draft_validation_status !== 'passed') {
      addWarning(warnings, {
        code: 'validation_failed',
        message: `Draft apply ${item.draft_apply_id} validation is ${item.draft_validation_status}.`,
        itemId: item.item_id,
        proposalId: item.proposal_id,
        entityKey: item.entity_key,
      });
    }
    if (!item.revision_id) {
      addWarning(warnings, {
        code: 'missing_revision',
        message: `Proposal ${item.proposal_id} does not have an immutable revision snapshot yet.`,
        itemId: item.item_id,
        proposalId: item.proposal_id,
        entityKey: item.entity_key,
      });
    }
    if (item.workflow_type === 'verified_promotion') {
      const source = item.public_source || {};
      if (!String(source.retrieved_date || '').trim()) {
        addWarning(warnings, {
          code: 'missing_source_retrieved_date',
          message: `Verified promotion proposal ${item.proposal_id} is missing a public source retrieved_date.`,
          itemId: item.item_id,
          proposalId: item.proposal_id,
          entityKey: item.entity_key,
          file: item.diff.target_file,
        });
      }
      if (!String(source.college_source_note || '').trim()) {
        addWarning(warnings, {
          code: 'missing_public_source_caveat',
          message: `Verified promotion proposal ${item.proposal_id} is missing a public source caveat/college_source_note.`,
          itemId: item.item_id,
          proposalId: item.proposal_id,
          entityKey: item.entity_key,
          file: item.diff.target_file,
        });
      }
    }
  }

  for (const [entityKey, count] of entityCounts) {
    if (count > 1) {
      addWarning(warnings, {
        code: 'duplicate_entity_key',
        message: `${entityKey} appears in ${count} release items.`,
        entityKey,
      });
    }
  }

  for (const [file, fileGroup] of fileItems) {
    if (fileGroup.length > 1) {
      if (safeSameFileAdds(fileGroup)) {
        addWarning(warnings, {
          code: 'same_file_multiple_safe_adds',
          severity: 'info',
          blocking: false,
          message: 'Multiple add-only proposals append to the same file. This is allowed because keys are unique and no existing entities are modified.',
          file,
        });
        continue;
      }
      addWarning(warnings, {
        code: 'same_file_multiple_proposals',
        message: `${file} is touched by ${fileGroup.length} proposals and includes non-add, non-append, duplicate, or incomplete changes.`,
        file,
      });
    }
  }

  return warnings;
}

export function buildReleaseReviewWarningsForTest(items) {
  return buildWarnings(items);
}

async function releaseRows(pool, releaseCandidateId) {
  const [releaseRowsResult] = await pool.execute(
    'SELECT * FROM release_candidates WHERE id = ?',
    [releaseCandidateId]
  );
  const release = releaseRowsResult[0];
  if (!release) throw new Error(`Release candidate not found: ${releaseCandidateId}`);

  const [itemRows] = await pool.execute(
    `SELECT rci.*,
      cp.entity_type, cp.entity_key, cp.status AS proposal_status,
      cp.validation_status AS proposal_validation_status,
      cp.proposed_payload_json,
      cp.normalized_payload_json,
      cp.diff_json,
      pe.validation_status AS export_validation_status,
      pe.export_payload_json,
      pda.validation_status AS draft_validation_status,
      pda.summary_json AS draft_summary_json
     FROM release_candidate_items rci
     INNER JOIN content_proposals cp ON cp.id = rci.proposal_id
     LEFT JOIN proposal_exports pe ON pe.id = rci.proposal_export_id
     LEFT JOIN proposal_draft_applies pda ON pda.id = rci.draft_apply_id
     WHERE rci.release_candidate_id = ?
     ORDER BY rci.created_at ASC, rci.id ASC`,
    [releaseCandidateId]
  );

  return { release, itemRows };
}

export async function generateReleaseReviewSummary({ releaseCandidateId, actor = null, auditEvents = false }) {
  const pool = await getDbPool({ requireConfigured: true });
  const { release, itemRows } = await releaseRows(pool, releaseCandidateId);
  const items = itemRows.map(itemSummaryFromRow);
  const warnings = buildWarnings(items);
  const blockingWarnings = warnings.filter(warning => warning.blocking);
  const informationalWarnings = warnings.filter(warning => !warning.blocking);
  const files = unique(items.flatMap(item => item.files));
  const entityTypes = unique(items.map(item => item.entity_type));
  const validationByItem = items.map(item => ({
    item_id: item.item_id,
    proposal_id: item.proposal_id,
    proposal: item.proposal_validation_status,
    export: item.export_validation_status,
    draft: item.draft_validation_status,
  }));
  const summary = {
    release_candidate_id: Number(releaseCandidateId),
    title: release.title,
    status: release.status,
    item_count: items.length,
    entity_types_affected: entityTypes,
    files_that_would_change: files,
    validation_status_per_item: validationByItem,
    items,
    combined_diff_summary: {
      total_patch_operations: items.reduce((sum, item) => sum + Number(item.diff.patch_count || 0), 0),
      operations: items.map(item => item.diff),
    },
    warnings,
    blocking_warnings: blockingWarnings,
    informational_warnings: informationalWarnings,
    blocking_warning_count: blockingWarnings.length,
    informational_warning_count: informationalWarnings.length,
    has_blocking_warnings: blockingWarnings.length > 0,
    not_published: true,
  };

  if (auditEvents) {
    await audit(pool, {
      actor,
      action: 'release_review.generate',
      entityType: 'release_candidate',
      entityId: releaseCandidateId,
      after: {
        item_count: summary.item_count,
        warning_count: warnings.length,
        blocking_warning_count: summary.blocking_warning_count,
        files_that_would_change: files,
      },
    });
    for (const warning of warnings) {
      await audit(pool, {
        actor,
        action: 'release_review.warning',
        entityType: 'release_candidate',
        entityId: releaseCandidateId,
        after: warning,
      });
    }
  }

  return summary;
}

export function releaseReviewErrorSummary(err) {
  const safe = describeDbError(err);
  if (err?.name === 'DatabaseConfigError') {
    return 'Release review requires MySQL configuration. Set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, and run migrations.';
  }
  if (safe.code === 'ER_NO_SUCH_TABLE' || safe.code === 'ER_BAD_FIELD_ERROR') {
    return 'Release review tables are missing or out of date. Run npm run db:migrate.';
  }
  return `${safe.code ? `${safe.code}: ` : ''}${safe.message}`;
}
