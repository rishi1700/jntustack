import fs from 'node:fs/promises';
import path from 'node:path';
import { describeDbError, getDbPool } from './db.js';

export const CLEAN_TEST_ARTIFACTS_CONFIRMATION = 'CLEAN TEST ARTIFACTS';

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  return JSON.parse(value);
}

function rowsToIds(rows) {
  return rows.map(row => Number(row.id)).filter(Number.isInteger);
}

function placeholders(ids) {
  return ids.length ? ids.map(() => '?').join(', ') : 'NULL';
}

function asRelativeSafeStoragePath(root, value) {
  const raw = String(value || '').replaceAll('\\', '/');
  if (!raw || !raw.startsWith('storage/source-assets/')) return null;
  const absolute = path.resolve(root, raw);
  const storageRoot = path.resolve(root, 'storage', 'source-assets');
  if (!absolute.startsWith(`${storageRoot}${path.sep}`)) return null;
  const base = path.basename(raw).toLowerCase();
  if (
    !base.startsWith('pr8-') &&
    !base.startsWith('pr14-') &&
    !base.startsWith('jntustack-pr') &&
    !base.startsWith('test-') &&
    base !== 'source-fetch.html'
  ) {
    return null;
  }
  return raw;
}

async function queryRows(pool, sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function audit(conn, { actor, action, entityType, entityId, before = null, after = null }) {
  await conn.execute(
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

async function collectCandidates(pool) {
  const assets = await queryRows(pool, `
    SELECT id, original_filename, source_url, local_storage_path, download_status, created_at
    FROM source_assets
    WHERE LOWER(COALESCE(original_filename, '')) LIKE 'pr8-%'
       OR LOWER(COALESCE(original_filename, '')) LIKE 'pr14-%'
       OR LOWER(COALESCE(original_filename, '')) LIKE 'jntustack-pr%'
       OR LOWER(COALESCE(original_filename, '')) LIKE 'test-%'
       OR LOWER(COALESCE(source_url, url, '')) LIKE '%example.edu/%'
       OR (
          LOWER(COALESCE(original_filename, '')) = 'source-fetch.html'
          AND LOWER(COALESCE(source_url, url, '')) IN ('https://www.tecnrt.org/', 'https://tecnrt.org/')
          AND created_at < '2026-07-03 00:00:00'
       )
    ORDER BY id ASC
  `);
  const assetIds = rowsToIds(assets);

  const proposals = await queryRows(pool, `
    SELECT id, entity_type, entity_key, status, validation_status, created_by, reviewed_by, updated_at
    FROM content_proposals
    WHERE LOWER(entity_key) LIKE 'test-%'
       OR LOWER(entity_key) LIKE 'pr5-%'
       OR LOWER(entity_key) LIKE 'pr6-%'
       OR LOWER(entity_key) LIKE 'pr12%'
       OR LOWER(entity_key) LIKE '%validation test%'
       OR created_by IN ('admin@example.com', 'codex-pr5-verification')
       OR reviewed_by = 'admin@example.com'
       OR LOWER(CAST(proposed_payload_json AS CHAR)) LIKE '%example.edu/%'
       OR LOWER(CAST(proposed_payload_json AS CHAR)) LIKE '%pr14-%'
       OR LOWER(CAST(proposed_payload_json AS CHAR)) LIKE '%jntustack-pr%'
       OR LOWER(CAST(diff_json AS CHAR)) LIKE '%example.edu/%'
       OR LOWER(CAST(diff_json AS CHAR)) LIKE '%pr14-%'
       OR LOWER(CAST(diff_json AS CHAR)) LIKE '%jntustack-pr%'
    ORDER BY id ASC
  `);

  const proposalIds = rowsToIds(proposals);
  const proposalWhere = proposalIds.length ? `OR proposal_id IN (${placeholders(proposalIds)})` : '';
  const exports = await queryRows(pool, `
    SELECT id, proposal_id, export_path, validation_status, created_at
    FROM proposal_exports
    WHERE LOWER(export_path) LIKE '%/test-%'
       OR LOWER(CAST(export_payload_json AS CHAR)) LIKE '%example.edu/%'
       OR LOWER(CAST(export_payload_json AS CHAR)) LIKE '%pr14-%'
       OR LOWER(CAST(export_payload_json AS CHAR)) LIKE '%jntustack-pr%'
       ${proposalWhere}
    ORDER BY id ASC
  `, proposalIds);

  const exportIds = rowsToIds(exports);
  const exportWhere = exportIds.length ? `OR proposal_export_id IN (${placeholders(exportIds)})` : '';
  const draftParams = [...proposalIds, ...exportIds];
  const drafts = await queryRows(pool, `
    SELECT id, proposal_export_id, proposal_id, draft_path, validation_status, created_at
    FROM proposal_draft_applies
    WHERE LOWER(draft_path) LIKE '%/test-%'
       ${proposalWhere}
       ${exportWhere}
    ORDER BY id ASC
  `, draftParams);

  const draftIds = rowsToIds(drafts);
  const parseParams = assetIds;
  const parseResults = await queryRows(pool, `
    SELECT id, asset_id, parser_key, parser_version, status, created_at
    FROM parse_results
    WHERE ${assetIds.length ? `asset_id IN (${placeholders(assetIds)})` : 'FALSE'}
    ORDER BY id ASC
  `, parseParams);

  const parseResultIds = rowsToIds(parseResults);
  const extractionResults = await queryRows(pool, `
    SELECT id, parse_result_id, entity_type, entity_key, validation_status, status, created_at
    FROM extraction_results
    WHERE ${parseResultIds.length ? `parse_result_id IN (${placeholders(parseResultIds)})` : 'FALSE'}
    ORDER BY id ASC
  `, parseResultIds);

  const extractionResultIds = rowsToIds(extractionResults);
  const diffParams = [...parseResultIds, ...extractionResultIds];
  const diffResults = await queryRows(pool, `
    SELECT id, parse_result_id, extraction_result_id, entity_type, entity_key, status, created_at
    FROM diff_results
    WHERE ${parseResultIds.length ? `parse_result_id IN (${placeholders(parseResultIds)})` : 'FALSE'}
       ${extractionResultIds.length ? `OR extraction_result_id IN (${placeholders(extractionResultIds)})` : ''}
    ORDER BY id ASC
  `, diffParams);

  const pipelineRuns = await queryRows(pool, `
    SELECT id, asset_id, parser_key, entity_type, entity_key, status, created_at
    FROM pipeline_runs
    WHERE ${assetIds.length ? `asset_id IN (${placeholders(assetIds)})` : 'FALSE'}
    ORDER BY id ASC
  `, assetIds);

  const revisionParams = [...proposalIds, ...exportIds, ...draftIds];
  const revisionWhere = [
    proposalIds.length ? `proposal_id IN (${placeholders(proposalIds)})` : null,
    exportIds.length ? `export_id IN (${placeholders(exportIds)})` : null,
    draftIds.length ? `draft_apply_id IN (${placeholders(draftIds)})` : null,
  ].filter(Boolean).join(' OR ');
  const revisions = await queryRows(pool, `
    SELECT id, entity_type, entity_key, revision_number, source_status, proposal_id, export_id, draft_apply_id, created_at
    FROM content_revisions
    WHERE LOWER(entity_key) LIKE 'test-%'
       OR LOWER(entity_key) LIKE 'pr5-%'
       OR LOWER(entity_key) LIKE 'pr6-%'
       OR LOWER(entity_key) LIKE 'pr12%'
       OR LOWER(entity_key) LIKE '%validation test%'
       OR LOWER(CAST(content_json AS CHAR)) LIKE '%example.edu/%'
       OR LOWER(CAST(content_json AS CHAR)) LIKE '%pr14-%'
       OR LOWER(CAST(content_json AS CHAR)) LIKE '%jntustack-pr%'
       ${revisionWhere ? `OR ${revisionWhere}` : ''}
    ORDER BY id ASC
  `, revisionParams);

  const releaseParams = proposalIds;
  const releases = await queryRows(pool, `
    SELECT DISTINCT rc.id, rc.title, rc.status, rc.created_by, rc.created_at
    FROM release_candidates rc
    LEFT JOIN release_candidate_items rci ON rci.release_candidate_id = rc.id
    WHERE LOWER(rc.title) LIKE 'test-%'
       OR LOWER(rc.title) LIKE '%dry run%'
       ${proposalIds.length ? `OR rci.proposal_id IN (${placeholders(proposalIds)})` : ''}
    ORDER BY rc.id ASC
  `, releaseParams);

  return {
    assets,
    proposals,
    exports,
    drafts,
    revisions,
    releases,
    parseResults,
    extractionResults,
    diffResults,
    pipelineRuns,
  };
}

function summarizeCandidates(candidates) {
  return Object.fromEntries(Object.entries(candidates).map(([key, rows]) => [key, rows.length]));
}

export async function previewProductionTestArtifacts() {
  const pool = await getDbPool({ requireConfigured: true });
  const candidates = await collectCandidates(pool);
  return {
    confirmationPhrase: CLEAN_TEST_ARTIFACTS_CONFIRMATION,
    counts: summarizeCandidates(candidates),
    candidates,
  };
}

async function deleteTmpFolders(root, proposalIds) {
  const removed = [];
  for (const id of proposalIds) {
    for (const relativePath of [
      path.join('tmp', 'proposal-exports', String(id)),
      path.join('tmp', 'content-drafts', String(id)),
    ]) {
      await fs.rm(path.join(root, relativePath), { recursive: true, force: true });
      removed.push(relativePath);
    }
  }
  return removed;
}

async function deleteUnreferencedStorageFiles(root, pool, assetRows) {
  const removed = [];
  const candidatePaths = [...new Set(assetRows.map(row => asRelativeSafeStoragePath(root, row.local_storage_path)).filter(Boolean))];
  for (const relativePath of candidatePaths) {
    const [refs] = await pool.execute(
      'SELECT COUNT(*) AS count FROM source_assets WHERE local_storage_path = ? OR storage_path = ?',
      [relativePath, relativePath]
    );
    if (Number(refs[0]?.count || 0) > 0) continue;
    await fs.rm(path.join(root, relativePath), { force: true });
    removed.push(relativePath);
  }
  return removed;
}

async function tryFilesystemCleanup(label, cleanupFn) {
  try {
    return { removed: await cleanupFn(), warning: null };
  } catch (err) {
    return {
      removed: [],
      warning: {
        scope: label,
        message: err.message || String(err),
      },
    };
  }
}

async function deleteByIds(conn, table, ids) {
  if (!ids.length) return 0;
  const [result] = await conn.execute(
    `DELETE FROM ${table} WHERE id IN (${placeholders(ids)})`,
    ids
  );
  return result.affectedRows || 0;
}

export async function cleanupProductionTestArtifacts({
  root = process.cwd(),
  confirmationPhrase,
  actor = null,
} = {}) {
  if (String(confirmationPhrase || '').trim() !== CLEAN_TEST_ARTIFACTS_CONFIRMATION) {
    throw new Error(`Confirmation phrase must be exactly "${CLEAN_TEST_ARTIFACTS_CONFIRMATION}".`);
  }

  const pool = await getDbPool({ requireConfigured: true });
  const conn = await pool.getConnection();
  let candidates;
  const deleted = {};
  try {
    await conn.beginTransaction();
    candidates = await collectCandidates(conn);
    const ids = {
      assets: rowsToIds(candidates.assets),
      proposals: rowsToIds(candidates.proposals),
      exports: rowsToIds(candidates.exports),
      drafts: rowsToIds(candidates.drafts),
      revisions: rowsToIds(candidates.revisions),
      releases: rowsToIds(candidates.releases),
    };

    await audit(conn, {
      actor,
      action: 'admin_cleanup.test_artifacts.run',
      entityType: 'admin_cleanup',
      entityId: 'test_artifacts',
      after: {
        counts: summarizeCandidates(candidates),
        criteria: [
          'test/pr entity keys',
          'known PR test filenames',
          'example.edu evidence',
          'admin@example.com/codex test actors',
          'known pre-production manual fetch dry-run asset',
        ],
      },
    });

    if (ids.releases.length) {
      await conn.execute(
        `DELETE FROM release_candidate_items WHERE release_candidate_id IN (${placeholders(ids.releases)})`,
        ids.releases
      );
    }
    if (ids.proposals.length) {
      await conn.execute(
        `DELETE FROM release_candidate_items WHERE proposal_id IN (${placeholders(ids.proposals)})`,
        ids.proposals
      );
    }

    deleted.release_candidates = await deleteByIds(conn, 'release_candidates', ids.releases);
    deleted.content_revisions = await deleteByIds(conn, 'content_revisions', ids.revisions);
    deleted.proposal_draft_applies = await deleteByIds(conn, 'proposal_draft_applies', ids.drafts);
    deleted.proposal_exports = await deleteByIds(conn, 'proposal_exports', ids.exports);
    deleted.pipeline_runs = await deleteByIds(conn, 'pipeline_runs', rowsToIds(candidates.pipelineRuns));
    deleted.diff_results = await deleteByIds(conn, 'diff_results', rowsToIds(candidates.diffResults));
    deleted.extraction_results = await deleteByIds(conn, 'extraction_results', rowsToIds(candidates.extractionResults));
    deleted.parse_results = await deleteByIds(conn, 'parse_results', rowsToIds(candidates.parseResults));
    if (ids.proposals.length) {
      await conn.execute(
        `DELETE FROM review_events WHERE proposal_id IN (${placeholders(ids.proposals)})`,
        ids.proposals
      );
    }
    deleted.content_proposals = await deleteByIds(conn, 'content_proposals', ids.proposals);
    deleted.source_assets = await deleteByIds(conn, 'source_assets', ids.assets);

    await audit(conn, {
      actor,
      action: 'admin_cleanup.test_artifacts.success',
      entityType: 'admin_cleanup',
      entityId: 'test_artifacts',
      before: { counts: summarizeCandidates(candidates) },
      after: { deleted },
    });

    await conn.commit();

    const storageCleanup = await tryFilesystemCleanup(
      'storage/source-assets',
      () => deleteUnreferencedStorageFiles(root, pool, candidates.assets)
    );
    const tmpCleanup = await tryFilesystemCleanup(
      'tmp proposal workspaces',
      () => deleteTmpFolders(root, ids.proposals)
    );
    const cleanupWarnings = [storageCleanup.warning, tmpCleanup.warning].filter(Boolean);
    return {
      confirmationPhrase: CLEAN_TEST_ARTIFACTS_CONFIRMATION,
      counts: summarizeCandidates(candidates),
      deleted,
      removedStorageFiles: storageCleanup.removed,
      removedTmpFolders: tmpCleanup.removed,
      cleanupWarnings,
    };
  } catch (err) {
    await conn.rollback().catch(() => {});
    await audit(pool, {
      actor,
      action: 'admin_cleanup.test_artifacts.error',
      entityType: 'admin_cleanup',
      entityId: 'test_artifacts',
      after: {
        error: err.message || String(err),
        counts: candidates ? summarizeCandidates(candidates) : null,
      },
    }).catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

export function adminCleanupErrorSummary(err) {
  const safe = describeDbError(err);
  if (err?.name === 'DatabaseConfigError') {
    return 'Admin cleanup requires MySQL configuration. Set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, and run migrations.';
  }
  if (safe.code === 'ER_NO_SUCH_TABLE' || safe.code === 'ER_BAD_FIELD_ERROR') {
    return 'Admin cleanup tables are missing or out of date. Run npm run db:migrate.';
  }
  return `${safe.code ? `${safe.code}: ` : ''}${safe.message}`;
}
