import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUTHORITATIVE_PRUNE_COMMIT_ACTION,
  AUTHORITATIVE_PRUNE_COMMIT_ENTITY_TYPE,
  AUTHORITATIVE_PRUNE_CONFIRMATION,
  AuthoritativePruneCommitOutcomeUnknownError,
  ImportPhaseCommitOutcomeUnknownError,
  TransactionRollbackOutcomeUnknownError,
  TransactionStartOutcomeUnknownError,
  findAuthoritativePruneCommitEvidence,
  importJsonContent,
  loadJsonContent,
  normalizeImportOptions,
  pruneAuthoritativeMirrorContent,
  verifyAuthoritativeMirrorKeyState,
} from '../lib/db-json.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function clone(value) {
  return structuredClone(value);
}

class FakePruneConnection {
  constructor({
    tables,
    foreignKeys = [],
    deleteCountMismatchTable = null,
    auditRows = [],
    commitAck = 'success',
    rollbackAck = 'success',
    startAck = 'success',
  }) {
    this.tables = clone(tables);
    this.foreignKeys = clone(foreignKeys);
    this.auditRows = clone(auditRows);
    this.queries = [];
    this.snapshot = null;
    this.deleteCountMismatchTable = deleteCountMismatchTable;
    this.commitAck = commitAck;
    this.rollbackAck = rollbackAck;
    this.startAck = startAck;
    this.destroyed = false;
  }

  destroy() {
    this.destroyed = true;
    if (this.snapshot) {
      this.tables = this.snapshot.tables;
      this.auditRows = this.snapshot.auditRows;
      this.snapshot = null;
    }
  }

  async query(statement, values = []) {
    const sql = (typeof statement === 'string' ? statement : statement.sql).replace(/\s+/g, ' ').trim();
    this.queries.push(sql);

    if (
      sql.startsWith('SET SESSION ') ||
      sql === 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE' ||
      sql === 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'
    ) {
      return [[], []];
    }
    if (sql === 'START TRANSACTION' || sql === 'START TRANSACTION READ ONLY') {
      this.snapshot = {
        tables: clone(this.tables),
        auditRows: clone(this.auditRows),
      };
      if (this.startAck === 'timeout') {
        const error = new Error('START TRANSACTION acknowledgement timed out');
        error.code = 'ETIMEDOUT';
        throw error;
      }
      return [[], []];
    }
    if (sql === 'COMMIT') {
      if (this.commitAck === 'before-commit-timeout') {
        const error = new Error('COMMIT acknowledgement timed out before server commit');
        error.code = 'ETIMEDOUT';
        throw error;
      }
      this.snapshot = null;
      if (this.commitAck === 'after-commit-timeout') {
        const error = new Error('COMMIT acknowledgement timed out after server commit');
        error.code = 'ETIMEDOUT';
        throw error;
      }
      return [[], []];
    }
    if (sql === 'ROLLBACK') {
      if (this.rollbackAck === 'timeout') {
        const error = new Error('ROLLBACK acknowledgement timed out');
        error.code = 'ETIMEDOUT';
        throw error;
      }
      if (this.snapshot) {
        this.tables = this.snapshot.tables;
        this.auditRows = this.snapshot.auditRows;
      }
      this.snapshot = null;
      return [[], []];
    }
    if (sql.includes('FROM information_schema.KEY_COLUMN_USAGE')) {
      return [this.foreignKeys.map(item => ({
        referencing_table: item.referencingTable,
        referencing_column: item.referencingColumn,
        referenced_table: item.referencedTable,
        referenced_column: item.referencedColumn,
      })), []];
    }

    if (
      sql ===
      'SELECT id FROM audit_log WHERE action = ? AND entity_type = ? AND entity_id = ? ORDER BY id FOR UPDATE'
    ) {
      return [this.auditRows
        .filter(row => (
          row.action === values[0] &&
          row.entityType === values[1] &&
          row.entityId === values[2]
        ))
        .map(row => ({ id: row.id })), []];
    }

    if (
      sql ===
      'SELECT id, actor, action, entity_type, entity_id, after_json, created_at FROM audit_log ' +
      'WHERE action = ? AND entity_type = ? AND entity_id = ? ORDER BY id LIMIT 2'
    ) {
      return [this.auditRows
        .filter(row => (
          row.action === values[0] &&
          row.entityType === values[1] &&
          row.entityId === values[2]
        ))
        .slice(0, 2)
        .map(row => ({
          id: row.id,
          actor: row.actor,
          action: row.action,
          entity_type: row.entityType,
          entity_id: row.entityId,
          after_json: JSON.stringify(row.after),
          created_at: row.createdAt,
        })), []];
    }

    const selectAll = sql.match(/^SELECT \* FROM `([a-z_]+)` ORDER BY id(?: FOR UPDATE)?$/);
    if (selectAll) {
      return [clone(this.tables[selectAll[1]] || []).sort((left, right) => left.id - right.id), []];
    }

    const referenceSelect = sql.match(
      /^SELECT id, `([a-z_]+)` AS referenced_id FROM `([a-z_]+)` WHERE `\1` IN \(\?\) ORDER BY id(?: FOR UPDATE)?$/
    );
    if (referenceSelect) {
      const [, column, table] = referenceSelect;
      const referencedIds = new Set((values[0] || []).map(String));
      const rows = (this.tables[table] || [])
        .filter(row => referencedIds.has(String(row[column])))
        .map(row => ({ id: row.id, referenced_id: row[column] }));
      return [clone(rows), []];
    }

    if (sql.startsWith('INSERT INTO audit_log ')) {
      const marker = sql.includes('VALUES (?, ?, ?, ?, NULL, ?)');
      const beforeValue = marker ? null : values[4];
      const afterValue = marker ? values[4] : values[5];
      this.auditRows.push({
        id: this.auditRows.length + 1,
        actor: values[0],
        action: values[1],
        entityType: values[2],
        entityId: values[3],
        before: beforeValue == null ? null : JSON.parse(beforeValue),
        after: afterValue == null ? null : JSON.parse(afterValue),
        createdAt: new Date('2026-07-26T12:00:00.000Z'),
      });
      return [{ affectedRows: 1 }, []];
    }

    const deleteMatch = sql.match(/^DELETE FROM `([a-z_]+)` WHERE id IN \(\?\)$/);
    if (deleteMatch) {
      const table = deleteMatch[1];
      const ids = new Set((values[0] || []).map(String));
      const before = this.tables[table].length;
      this.tables[table] = this.tables[table].filter(row => !ids.has(String(row.id)));
      const affectedRows = before - this.tables[table].length;
      return [{
        affectedRows: table === this.deleteCountMismatchTable ? Math.max(0, affectedRows - 1) : affectedRows,
      }, []];
    }

    const assertionSelect = sql.match(
      /^SELECT id, `([a-z_]+)` FROM `([a-z_]+)` ORDER BY id(?: FOR UPDATE)?$/
    );
    if (assertionSelect) {
      const [, column, table] = assertionSelect;
      return [this.tables[table].map(row => ({ id: row.id, [column]: row[column] })), []];
    }

    throw new Error(`Unexpected fake prune query: ${sql}`);
  }
}

const authoritativeContent = {
  shared: { regulations: [], branches: [] },
  subjects: [
    { id: 'subject-keep' },
    ...Array.from({ length: 435 }, (_value, index) => ({ id: `subject-${index + 1}` })),
  ],
  colleges: [
    {
      affiliated_to: 'JNTUK',
      short_code: 'KEEP',
      name: 'Keep College',
      location: { district: 'East Godavari' },
    },
    ...Array.from({ length: 375 }, (_value, index) => ({
      affiliated_to: 'JNTUK',
      short_code: `C${String(index + 1).padStart(3, '0')}`,
      name: `College ${index + 1}`,
      location: { district: `District ${index + 1}` },
    })),
  ],
  branchProfiles: ['CSE', 'ECE', 'EEE', 'IT', 'MECH', 'CE'].map(branch => ({ branch })),
  guides: [{ id: 'guide-keep' }],
};

function collegeKey(college) {
  return [
    college.affiliated_to || '',
    college.short_code || '',
    college.name || '',
    college.location?.district || '',
  ].join(':');
}

function mirrorTables(content = authoritativeContent) {
  return {
    subjects: [
      ...content.subjects.map((subject, index) => ({
        id: index + 1,
        stable_id: subject.id,
        name: subject.name || `Subject ${index + 1}`,
        legacy_subject_id: null,
        status: subject.source?.status || 'verified',
      })),
      { id: 1000, stable_id: 'subject-old', name: 'Old Subject', legacy_subject_id: 1000, status: 'verified' },
    ],
    colleges: [
      ...content.colleges.map((college, index) => ({
        id: index + 1,
        stable_key: collegeKey(college),
        name: college.name,
        status: college.source?.status || 'verified',
      })),
      { id: 2000, stable_key: 'JNTUK:OLD:Old College:Old District', name: 'Old College', status: 'verified' },
    ],
    branch_profiles: [
      ...content.branchProfiles.map((profile, index) => ({
        id: index + 1,
        branch_code: profile.branch,
        tagline: profile.tagline || `${profile.branch} profile`,
        status: profile.source?.status || 'verified',
      })),
      { id: 3000, branch_code: 'OLD', tagline: 'Old profile', status: 'verified' },
    ],
    guides: [
      ...content.guides.map((guide, index) => ({
        id: index + 1,
        stable_id: guide.id,
        name: guide.name || `Guide ${index + 1}`,
        status: guide.source?.status || 'verified',
      })),
      { id: 4000, stable_id: 'guide-old', name: 'Old Guide', status: 'verified' },
    ],
  };
}

const subjectSelfReference = {
  referencingTable: 'subjects',
  referencingColumn: 'legacy_subject_id',
  referencedTable: 'subjects',
  referencedColumn: 'id',
};

class FakeFullImportConnection extends FakePruneConnection {
  constructor(content) {
    super({
      tables: mirrorTables(content),
      foreignKeys: [subjectSelfReference],
    });
    this.referenceRows = {
      regulations: content.shared.regulations.map((regulation, index) => ({
        id: index + 1,
        code: regulation.code,
      })),
      branches: content.shared.branches.map((branch, index) => ({
        id: index + 1,
        code: branch.code,
      })),
      universities: [...new Set(
        content.colleges.map(college => college.affiliated_to).filter(Boolean)
      )].sort().map((code, index) => ({ id: index + 1, code })),
    };
    this.nextSourceId = 1;
  }

  async query(statement, values = []) {
    const sql = (typeof statement === 'string' ? statement : statement.sql)
      .replace(/\s+/g, ' ')
      .trim();

    const referenceSelect = sql.match(
      /^SELECT id, code FROM (regulations|branches|universities)$/
    );
    if (referenceSelect) {
      this.queries.push(sql);
      return [clone(this.referenceRows[referenceSelect[1]]), []];
    }
    if (sql === 'SELECT id, stable_id FROM subjects') {
      this.queries.push(sql);
      return [
        this.tables.subjects.map(row => ({ id: row.id, stable_id: row.stable_id })),
        [],
      ];
    }
    if (sql.startsWith('INSERT INTO sources ')) {
      this.queries.push(sql);
      return [{ affectedRows: 1, insertId: this.nextSourceId++ }, []];
    }
    if (
      /^(?:INSERT INTO (?:universities|regulations|branches|subjects|colleges|branch_profiles|guides)|UPDATE (?:regulations|subjects)) /.test(sql)
    ) {
      this.queries.push(sql);
      return [{ affectedRows: 1 }, []];
    }

    return super.query(statement, values);
  }
}

assert.equal(normalizeImportOptions({}).pruneMode, 'disabled');
assert.equal(normalizeImportOptions({ pruneDryRun: true }).pruneMode, 'dry-run');
assert.throws(
  () => normalizeImportOptions({ subjects: true, pruneDryRun: true }),
  /requires a full import/
);
assert.throws(
  () => normalizeImportOptions({
    file: 'data/subjects-cse.json',
    prune: true,
    pruneConfirmation: AUTHORITATIVE_PRUNE_CONFIRMATION,
  }),
  /requires a full import/
);
assert.throws(
  () => normalizeImportOptions({ prune: true }),
  new RegExp(AUTHORITATIVE_PRUNE_CONFIRMATION)
);
assert.throws(
  () => normalizeImportOptions({
    prune: true,
    pruneConfirmation: AUTHORITATIVE_PRUNE_CONFIRMATION,
  }),
  /exact .*<sha256> token from --prune-dry-run/
);
assert.throws(
  () => normalizeImportOptions({ pruneConfirmation: AUTHORITATIVE_PRUNE_CONFIRMATION }),
  /only valid with --prune/
);
const generatedRequestOptions = normalizeImportOptions({
  prune: true,
  pruneConfirmation: `${AUTHORITATIVE_PRUNE_CONFIRMATION}:${'1'.repeat(64)}`,
});
assert.match(generatedRequestOptions.pruneRequestId, /^[a-f0-9-]{36}$/);
assert.equal(
  normalizeImportOptions({
    prune: true,
    pruneConfirmation: `${AUTHORITATIVE_PRUNE_CONFIRMATION}:${'1'.repeat(64)}`,
    pruneRequestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  }).pruneRequestId,
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
);
assert.throws(
  () => normalizeImportOptions({
    prune: true,
    pruneConfirmation: `${AUTHORITATIVE_PRUNE_CONFIRMATION}:${'1'.repeat(64)}`,
    pruneRequestId: 'not-a-uuid',
  }),
  /canonical UUID/
);
assert.throws(
  () => normalizeImportOptions({ pruneRequestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }),
  /only valid with --prune/
);

const truncatedConnection = new FakePruneConnection({
  tables: mirrorTables(),
  foreignKeys: [subjectSelfReference],
});
await assert.rejects(
  pruneAuthoritativeMirrorContent(
    truncatedConnection,
    { ...authoritativeContent, subjects: [] },
    { authoritativeScope: 'full', mode: 'dry-run' }
  ),
  /subject count is 0; expected the approved count 436/
);
assert.equal(truncatedConnection.queries.length, 0);

const dryRunConnection = new FakePruneConnection({
  tables: mirrorTables(),
  foreignKeys: [subjectSelfReference],
});
const dryRunBefore = clone(dryRunConnection.tables);
const dryRun = await pruneAuthoritativeMirrorContent(
  dryRunConnection,
  authoritativeContent,
  { authoritativeScope: 'full', mode: 'dry-run' }
);
assert.equal(dryRun.mode, 'dry-run');
assert.deepEqual(dryRun.totals, {
  authoritative: 819,
  current: 823,
  obsolete: 4,
  missing: 0,
  deleted: 0,
  blockedReferences: 0,
});
assert.match(
  dryRun.confirmationToken,
  new RegExp(`^${AUTHORITATIVE_PRUNE_CONFIRMATION}:[a-f0-9]{64}$`)
);
assert.match(dryRun.authoritativeContentDigest, /^[a-f0-9]{64}$/);
assert.equal(dryRun.planDigest, dryRun.confirmationToken.split(':')[1]);
assert.deepEqual(dryRunConnection.tables, dryRunBefore);
assert.equal(dryRunConnection.auditRows.length, 0);
assert.equal(dryRunConnection.queries.some(query => query.startsWith('DELETE ')), false);
assert.equal(dryRunConnection.queries.some(query => query.includes(' FOR UPDATE')), false);

await assert.rejects(
  pruneAuthoritativeMirrorContent(
    new FakePruneConnection({ tables: mirrorTables(), foreignKeys: [subjectSelfReference] }),
    authoritativeContent,
    { authoritativeScope: 'full', mode: 'apply', confirmation: 'yes' }
  ),
  new RegExp(AUTHORITATIVE_PRUNE_CONFIRMATION)
);
const staticTokenConnection = new FakePruneConnection({
  tables: mirrorTables(),
  foreignKeys: [subjectSelfReference],
});
await assert.rejects(
  pruneAuthoritativeMirrorContent(
    staticTokenConnection,
    authoritativeContent,
    {
      authoritativeScope: 'full',
      mode: 'apply',
      confirmation: AUTHORITATIVE_PRUNE_CONFIRMATION,
    }
  ),
  /exact .*<sha256> token from a dry-run/
);
assert.equal(staticTokenConnection.queries.length, 0);
await assert.rejects(
  pruneAuthoritativeMirrorContent(
    new FakePruneConnection({ tables: mirrorTables(), foreignKeys: [subjectSelfReference] }),
    authoritativeContent,
    {
      authoritativeScope: 'partial',
      mode: 'apply',
      confirmation: AUTHORITATIVE_PRUNE_CONFIRMATION,
    }
  ),
  /authoritativeScope="full"/
);

const applyConnection = new FakePruneConnection({
  tables: mirrorTables(),
  foreignKeys: [subjectSelfReference],
});
const applyPreview = await pruneAuthoritativeMirrorContent(
  applyConnection,
  authoritativeContent,
  { authoritativeScope: 'full', mode: 'dry-run' }
);
const applyResult = await pruneAuthoritativeMirrorContent(
  applyConnection,
  authoritativeContent,
  {
    authoritativeScope: 'full',
    mode: 'apply',
    confirmation: applyPreview.confirmationToken,
    actor: 'test:authoritative-prune',
  }
);
assert.equal(applyResult.totals.deleted, 4);
assert.equal(applyConnection.tables.subjects.length, 436);
assert.equal(applyConnection.tables.subjects.some(row => row.stable_id === 'subject-old'), false);
assert.equal(applyConnection.tables.colleges.length, 376);
assert.equal(applyConnection.tables.colleges.some(row => row.stable_key.includes(':OLD:')), false);
assert.equal(applyConnection.tables.branch_profiles.length, 6);
assert.equal(applyConnection.tables.branch_profiles.some(row => row.branch_code === 'OLD'), false);
assert.deepEqual(applyConnection.tables.guides.map(row => row.stable_id), ['guide-keep']);
assert.equal(applyConnection.auditRows.length, 5);
const subjectAudit = applyConnection.auditRows.find(row => row.entityType === 'subject');
assert.deepEqual(subjectAudit.before, {
  id: 1000,
  stable_id: 'subject-old',
  name: 'Old Subject',
  legacy_subject_id: 1000,
  status: 'verified',
});
assert.deepEqual(subjectAudit.after, {
  deleted: true,
  reason: 'absent_from_authoritative_json',
  stable_key: 'subject-old',
});
assert.equal(subjectAudit.actor, 'test:authoritative-prune');
assert.match(applyResult.requestId, /^[a-f0-9-]{36}$/);
const commitMarker = applyConnection.auditRows.find(
  row => row.action === AUTHORITATIVE_PRUNE_COMMIT_ACTION
);
assert.ok(commitMarker);
assert.equal(commitMarker.entityType, AUTHORITATIVE_PRUNE_COMMIT_ENTITY_TYPE);
assert.equal(commitMarker.entityId, applyResult.requestId);
assert.equal(commitMarker.before, null);
assert.equal(commitMarker.after.request_id, applyResult.requestId);
assert.equal(commitMarker.after.plan_digest, applyResult.planDigest);
assert.equal(commitMarker.after.confirmation_token, applyResult.confirmationToken);
assert.equal(commitMarker.after.actor, 'test:authoritative-prune');
assert.deepEqual(commitMarker.after.totals, applyResult.totals);
assert.equal(applyResult.commitEvidence.request_id, applyResult.requestId);
const markerInsertIndex = applyConnection.queries.findIndex(query => (
  query.startsWith('INSERT INTO audit_log ') &&
  query.includes('VALUES (?, ?, ?, ?, NULL, ?)')
));
const lastAssertionIndex = applyConnection.queries.reduce(
  (found, query, index) => query.includes(' ORDER BY id FOR UPDATE') ? index : found,
  -1
);
const commitIndex = applyConnection.queries.lastIndexOf('COMMIT');
assert.ok(lastAssertionIndex < markerInsertIndex);
assert.ok(markerInsertIndex < commitIndex);

const dryRunLoggerFailureConnection = new FakePruneConnection({
  tables: mirrorTables(),
  foreignKeys: [subjectSelfReference],
});
const dryRunWithLoggerFailure = await pruneAuthoritativeMirrorContent(
  dryRunLoggerFailureConnection,
  authoritativeContent,
  {
    authoritativeScope: 'full',
    mode: 'dry-run',
    logger(message) {
      if (message.startsWith('done ')) {
        throw new Error('logger failed after commit');
      }
    },
  }
);
assert.equal(dryRunWithLoggerFailure.mode, 'dry-run');
const dryRunLoggerStartIndex = dryRunLoggerFailureConnection.queries.lastIndexOf(
  'START TRANSACTION'
);
assert.equal(
  dryRunLoggerFailureConnection.queries
    .slice(dryRunLoggerStartIndex)
    .includes('ROLLBACK'),
  false
);

const applyLoggerFailureConnection = new FakePruneConnection({
  tables: mirrorTables(),
  foreignKeys: [subjectSelfReference],
});
const applyLoggerFailurePreview = await pruneAuthoritativeMirrorContent(
  applyLoggerFailureConnection,
  authoritativeContent,
  { authoritativeScope: 'full', mode: 'dry-run' }
);
const applyWithLoggerFailure = await pruneAuthoritativeMirrorContent(
  applyLoggerFailureConnection,
  authoritativeContent,
  {
    authoritativeScope: 'full',
    mode: 'apply',
    confirmation: applyLoggerFailurePreview.confirmationToken,
    actor: 'test:post-commit-logger-failure',
    logger(message) {
      if (message.startsWith('done ')) {
        throw new Error('logger failed after commit');
      }
    },
  }
);
assert.equal(applyWithLoggerFailure.totals.deleted, 4);
assert.equal(
  applyLoggerFailureConnection.auditRows.some(
    row => (
      row.action === AUTHORITATIVE_PRUNE_COMMIT_ACTION &&
      row.entityId === applyWithLoggerFailure.requestId
    )
  ),
  true
);
const applyLoggerStartIndex = applyLoggerFailureConnection.queries.lastIndexOf(
  'START TRANSACTION'
);
assert.equal(
  applyLoggerFailureConnection.queries
    .slice(applyLoggerStartIndex)
    .includes('ROLLBACK'),
  false
);

const fullImportContent = loadJsonContent(path.join(ROOT, 'data'));
const finalLoggerFailureConnection = new FakeFullImportConnection(fullImportContent);
const finalLoggerFailurePreview = await pruneAuthoritativeMirrorContent(
  finalLoggerFailureConnection,
  fullImportContent,
  { authoritativeScope: 'full', mode: 'dry-run' }
);
const finalLoggerMessages = [];
const importWithFinalLoggerFailure = await importJsonContent(
  finalLoggerFailureConnection,
  path.join(ROOT, 'data'),
  {
    prune: true,
    pruneConfirmation: finalLoggerFailurePreview.confirmationToken,
    pruneRequestId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    pruneActor: 'test:final-import-logger-failure',
    logger(message) {
      finalLoggerMessages.push(message);
      if (message === 'import complete') {
        throw new Error('final import logger failed after prune commit');
      }
    },
  }
);
assert.equal(importWithFinalLoggerFailure.prune.totals.deleted, 4);
assert.equal(importWithFinalLoggerFailure.lastCompletedPhase, 'authoritative_prune');
assert.equal(finalLoggerMessages.at(-1), 'import complete');
assert.equal(
  finalLoggerFailureConnection.auditRows.some(
    row => (
      row.action === AUTHORITATIVE_PRUNE_COMMIT_ACTION &&
      row.entityId === importWithFinalLoggerFailure.prune.requestId
    )
  ),
  true
);
const finalLoggerPruneStartIndex =
  finalLoggerFailureConnection.queries.lastIndexOf('START TRANSACTION');
assert.equal(
  finalLoggerFailureConnection.queries
    .slice(finalLoggerPruneStartIndex)
    .includes('ROLLBACK'),
  false
);

const committedEvidence = await findAuthoritativePruneCommitEvidence(applyConnection, {
  requestId: applyResult.requestId,
  planDigest: applyResult.planDigest,
  confirmationToken: applyResult.confirmationToken,
});
assert.equal(committedEvidence.committed, true);
assert.equal(committedEvidence.requestId, applyResult.requestId);
assert.equal(committedEvidence.auditId, String(commitMarker.id));
assert.deepEqual(committedEvidence.totals, applyResult.totals);
const exactKeyState = await verifyAuthoritativeMirrorKeyState(
  applyConnection,
  authoritativeContent
);
assert.equal(exactKeyState.ok, true);
assert.deepEqual(exactKeyState.totals, {
  authoritative: 819,
  current: 819,
  missing: 0,
  unexpected: 0,
  duplicateOrEmpty: 0,
});
const driftedKeyStateConnection = new FakePruneConnection({
  tables: applyConnection.tables,
  foreignKeys: [subjectSelfReference],
  auditRows: applyConnection.auditRows,
});
driftedKeyStateConnection.tables.guides.push({
  id: 5000,
  stable_id: 'post-commit-drift',
  name: 'Post-commit drift',
  status: 'verified',
});
const driftedKeyState = await verifyAuthoritativeMirrorKeyState(
  driftedKeyStateConnection,
  authoritativeContent
);
assert.equal(driftedKeyState.ok, false);
assert.equal(driftedKeyState.totals.unexpected, 1);
assert.deepEqual(
  driftedKeyState.entities.find(entity => entity.entityType === 'guide').unexpectedKeys,
  ['post-commit-drift']
);
await assert.rejects(
  findAuthoritativePruneCommitEvidence(applyConnection, {
    requestId: applyResult.requestId,
    planDigest: '0'.repeat(64),
  }),
  /plan digest mismatch/
);

const reusedRequestConnection = new FakePruneConnection({
  tables: mirrorTables(),
  foreignKeys: [subjectSelfReference],
  auditRows: [commitMarker],
});
const reusedRequestPreview = await pruneAuthoritativeMirrorContent(
  reusedRequestConnection,
  authoritativeContent,
  { authoritativeScope: 'full', mode: 'dry-run' }
);
await assert.rejects(
  pruneAuthoritativeMirrorContent(
    reusedRequestConnection,
    authoritativeContent,
    {
      authoritativeScope: 'full',
      mode: 'apply',
      confirmation: reusedRequestPreview.confirmationToken,
      pruneRequestId: applyResult.requestId,
    }
  ),
  /already has durable commit evidence/
);
assert.equal(reusedRequestConnection.auditRows.length, 1);

const duplicateEvidenceConnection = new FakePruneConnection({
  tables: applyConnection.tables,
  foreignKeys: [subjectSelfReference],
  auditRows: [commitMarker, { ...clone(commitMarker), id: commitMarker.id + 1 }],
});
await assert.rejects(
  findAuthoritativePruneCommitEvidence(duplicateEvidenceConnection, {
    requestId: applyResult.requestId,
  }),
  /Duplicate authoritative prune commit evidence/
);

const blockedTables = mirrorTables();
blockedTables.subjects[0].legacy_subject_id = 1000;
const blockedConnection = new FakePruneConnection({
  tables: blockedTables,
  foreignKeys: [subjectSelfReference],
});
const blockedPreview = await pruneAuthoritativeMirrorContent(
  blockedConnection,
  authoritativeContent,
  { authoritativeScope: 'full', mode: 'dry-run' }
);
await assert.rejects(
  pruneAuthoritativeMirrorContent(
    blockedConnection,
    authoritativeContent,
    {
      authoritativeScope: 'full',
      mode: 'apply',
      confirmation: blockedPreview.confirmationToken,
    }
  ),
  /still referenced: subject=1/
);
assert.deepEqual(blockedConnection.tables, blockedTables);
assert.equal(blockedConnection.auditRows.length, 0);
assert.equal(blockedConnection.queries.includes('ROLLBACK'), true);

const missingTables = mirrorTables();
missingTables.guides = missingTables.guides.filter(row => row.stable_id !== 'guide-keep');
const missingConnection = new FakePruneConnection({
  tables: missingTables,
  foreignKeys: [subjectSelfReference],
});
const missingPreview = await pruneAuthoritativeMirrorContent(
  missingConnection,
  authoritativeContent,
  { authoritativeScope: 'full', mode: 'dry-run' }
);
await assert.rejects(
  pruneAuthoritativeMirrorContent(
    missingConnection,
    authoritativeContent,
    {
      authoritativeScope: 'full',
      mode: 'apply',
      confirmation: missingPreview.confirmationToken,
    }
  ),
  /imported mirror rows are missing: guide=1/
);
assert.deepEqual(missingConnection.tables, missingTables);
assert.equal(missingConnection.auditRows.length, 0);

const mismatchConnection = new FakePruneConnection({
  tables: mirrorTables(),
  foreignKeys: [subjectSelfReference],
  deleteCountMismatchTable: 'subjects',
});
const mismatchBefore = clone(mismatchConnection.tables);
const mismatchPreview = await pruneAuthoritativeMirrorContent(
  mismatchConnection,
  authoritativeContent,
  { authoritativeScope: 'full', mode: 'dry-run' }
);
await assert.rejects(
  pruneAuthoritativeMirrorContent(
    mismatchConnection,
    authoritativeContent,
    {
      authoritativeScope: 'full',
      mode: 'apply',
      confirmation: mismatchPreview.confirmationToken,
    }
  ),
  /delete count mismatch/
);
assert.deepEqual(mismatchConnection.tables, mismatchBefore);
assert.equal(mismatchConnection.auditRows.length, 0);

const rollbackTimeoutConnection = new FakePruneConnection({
  tables: mirrorTables(),
  foreignKeys: [subjectSelfReference],
  deleteCountMismatchTable: 'subjects',
});
const rollbackTimeoutPreview = await pruneAuthoritativeMirrorContent(
  rollbackTimeoutConnection,
  authoritativeContent,
  { authoritativeScope: 'full', mode: 'dry-run' }
);
const rollbackTimeoutBefore = clone(rollbackTimeoutConnection.tables);
rollbackTimeoutConnection.rollbackAck = 'timeout';
const rollbackTimeoutRequestId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
let rollbackAmbiguity = null;
try {
  await pruneAuthoritativeMirrorContent(
    rollbackTimeoutConnection,
    authoritativeContent,
    {
      authoritativeScope: 'full',
      mode: 'apply',
      confirmation: rollbackTimeoutPreview.confirmationToken,
      pruneRequestId: rollbackTimeoutRequestId,
    }
  );
} catch (error) {
  rollbackAmbiguity = error;
}
assert.ok(rollbackAmbiguity instanceof TransactionRollbackOutcomeUnknownError);
assert.equal(rollbackAmbiguity.code, 'TRANSACTION_ROLLBACK_OUTCOME_UNKNOWN');
assert.equal(rollbackAmbiguity.commitOutcome, 'not_attempted');
assert.equal(rollbackAmbiguity.rollbackOutcome, 'unknown');
assert.equal(rollbackAmbiguity.rollbackAttempted, true);
assert.equal(rollbackAmbiguity.transactionOutcome, 'unknown');
assert.equal(rollbackAmbiguity.reconciliationRequired, true);
assert.equal(rollbackAmbiguity.pruneRequestId, rollbackTimeoutRequestId);
assert.equal(rollbackAmbiguity.prunePlanDigest, rollbackTimeoutPreview.planDigest);
assert.equal(rollbackAmbiguity.pruneConfirmationToken, rollbackTimeoutPreview.confirmationToken);
assert.equal(rollbackAmbiguity.rollbackCode, 'ETIMEDOUT');
assert.doesNotMatch(rollbackAmbiguity.message, /failed/i);
assert.equal(rollbackTimeoutConnection.destroyed, true);
assert.deepEqual(rollbackTimeoutConnection.tables, rollbackTimeoutBefore);
assert.equal(rollbackTimeoutConnection.auditRows.length, 0);

const driftConnection = new FakePruneConnection({
  tables: mirrorTables(),
  foreignKeys: [subjectSelfReference],
});
const driftPreview = await pruneAuthoritativeMirrorContent(
  driftConnection,
  authoritativeContent,
  { authoritativeScope: 'full', mode: 'dry-run' }
);
driftConnection.tables.guides.push({
  id: 4001,
  stable_id: 'guide-added-after-preview',
  name: 'Drift Guide',
  status: 'verified',
});
const driftBeforeApply = clone(driftConnection.tables);
await assert.rejects(
  pruneAuthoritativeMirrorContent(
    driftConnection,
    authoritativeContent,
    {
      authoritativeScope: 'full',
      mode: 'apply',
      confirmation: driftPreview.confirmationToken,
    }
  ),
  /plan changed or was not previewed/
);
assert.deepEqual(driftConnection.tables, driftBeforeApply);
assert.equal(driftConnection.auditRows.length, 0);

const beforeImageDriftConnection = new FakePruneConnection({
  tables: mirrorTables(),
  foreignKeys: [subjectSelfReference],
});
const beforeImageDriftPreview = await pruneAuthoritativeMirrorContent(
  beforeImageDriftConnection,
  authoritativeContent,
  { authoritativeScope: 'full', mode: 'dry-run' }
);
beforeImageDriftConnection.tables.subjects.find(row => row.stable_id === 'subject-old').name =
  'Old Subject Changed After Preview';
await assert.rejects(
  pruneAuthoritativeMirrorContent(
    beforeImageDriftConnection,
    authoritativeContent,
    {
      authoritativeScope: 'full',
      mode: 'apply',
      confirmation: beforeImageDriftPreview.confirmationToken,
    }
  ),
  /plan changed or was not previewed/
);
assert.equal(beforeImageDriftConnection.auditRows.length, 0);

const jsonDriftConnection = new FakePruneConnection({
  tables: mirrorTables(),
  foreignKeys: [subjectSelfReference],
});
const jsonDriftPreview = await pruneAuthoritativeMirrorContent(
  jsonDriftConnection,
  authoritativeContent,
  { authoritativeScope: 'full', mode: 'dry-run' }
);
const changedAuthoritativeContent = clone(authoritativeContent);
changedAuthoritativeContent.subjects[0].name = 'Changed after preview with the same stable ID';
await assert.rejects(
  pruneAuthoritativeMirrorContent(
    jsonDriftConnection,
    changedAuthoritativeContent,
    {
      authoritativeScope: 'full',
      mode: 'apply',
      confirmation: jsonDriftPreview.confirmationToken,
    }
  ),
  /plan changed or was not previewed/
);
assert.equal(jsonDriftConnection.auditRows.length, 0);

const sharedJsonDriftConnection = new FakePruneConnection({
  tables: mirrorTables(),
  foreignKeys: [subjectSelfReference],
});
const sharedJsonDriftPreview = await pruneAuthoritativeMirrorContent(
  sharedJsonDriftConnection,
  authoritativeContent,
  { authoritativeScope: 'full', mode: 'dry-run' }
);
const changedSharedContent = clone(authoritativeContent);
changedSharedContent.shared.regulations = [{ code: 'R23', full_name: 'Changed after preview' }];
changedSharedContent.coverageNotes = ['Changed after preview'];
await assert.rejects(
  pruneAuthoritativeMirrorContent(
    sharedJsonDriftConnection,
    changedSharedContent,
    {
      authoritativeScope: 'full',
      mode: 'apply',
      confirmation: sharedJsonDriftPreview.confirmationToken,
    }
  ),
  /plan changed or was not previewed/
);
assert.equal(sharedJsonDriftConnection.auditRows.length, 0);

const noPreviewConnection = new FakePruneConnection({
  tables: mirrorTables(),
  foreignKeys: [subjectSelfReference],
});
const noPreviewBefore = clone(noPreviewConnection.tables);
await assert.rejects(
  pruneAuthoritativeMirrorContent(
    noPreviewConnection,
    authoritativeContent,
    {
      authoritativeScope: 'full',
      mode: 'apply',
      confirmation: `${AUTHORITATIVE_PRUNE_CONFIRMATION}:${'0'.repeat(64)}`,
    }
  ),
  /plan changed or was not previewed/
);
assert.deepEqual(noPreviewConnection.tables, noPreviewBefore);
assert.equal(noPreviewConnection.auditRows.length, 0);
assert.equal(noPreviewConnection.queries.includes('ROLLBACK'), true);

const startTimeoutConnection = new FakePruneConnection({
  tables: mirrorTables(),
  foreignKeys: [subjectSelfReference],
  startAck: 'timeout',
});
const startTimeoutBefore = clone(startTimeoutConnection.tables);
let startAmbiguity = null;
try {
  await pruneAuthoritativeMirrorContent(
    startTimeoutConnection,
    authoritativeContent,
    { authoritativeScope: 'full', mode: 'dry-run' }
  );
} catch (error) {
  startAmbiguity = error;
}
assert.ok(startAmbiguity instanceof TransactionStartOutcomeUnknownError);
assert.equal(startAmbiguity.code, 'TRANSACTION_START_OUTCOME_UNKNOWN');
assert.equal(startAmbiguity.transactionStartOutcome, 'unknown');
assert.equal(startAmbiguity.operationStarted, false);
assert.equal(startAmbiguity.connectionMustBeDiscarded, true);
assert.equal(startAmbiguity.importPhase, 'authoritative_prune_dry_run');
assert.equal(startAmbiguity.originalCode, 'ETIMEDOUT');
assert.equal(startTimeoutConnection.destroyed, true);
assert.deepEqual(startTimeoutConnection.tables, startTimeoutBefore);
assert.equal(startTimeoutConnection.auditRows.length, 0);
assert.equal(
  startTimeoutConnection.queries.some(query => query.startsWith('SELECT * FROM')),
  false
);
assert.equal(startTimeoutConnection.queries.includes('ROLLBACK'), false);

const genericCommitTimeoutConnection = new FakePruneConnection({
  tables: mirrorTables(),
  foreignKeys: [subjectSelfReference],
  commitAck: 'after-commit-timeout',
});
let genericCommitAmbiguity = null;
try {
  await pruneAuthoritativeMirrorContent(
    genericCommitTimeoutConnection,
    authoritativeContent,
    { authoritativeScope: 'full', mode: 'dry-run' }
  );
} catch (error) {
  genericCommitAmbiguity = error;
}
assert.ok(genericCommitAmbiguity instanceof ImportPhaseCommitOutcomeUnknownError);
assert.equal(genericCommitAmbiguity.code, 'IMPORT_PHASE_COMMIT_OUTCOME_UNKNOWN');
assert.equal(genericCommitAmbiguity.commitOutcome, 'unknown');
assert.equal(genericCommitAmbiguity.commitAttempted, true);
assert.equal(genericCommitAmbiguity.reconciliationRequired, true);
assert.equal(genericCommitAmbiguity.importPhase, 'authoritative_prune_dry_run');
assert.equal(genericCommitAmbiguity.originalCode, 'ETIMEDOUT');
assert.equal(genericCommitTimeoutConnection.destroyed, true);
assert.equal(genericCommitTimeoutConnection.queries.includes('ROLLBACK'), false);

const afterCommitTimeoutConnection = new FakePruneConnection({
  tables: mirrorTables(),
  foreignKeys: [subjectSelfReference],
});
const afterCommitTimeoutPreview = await pruneAuthoritativeMirrorContent(
  afterCommitTimeoutConnection,
  authoritativeContent,
  { authoritativeScope: 'full', mode: 'dry-run' }
);
afterCommitTimeoutConnection.commitAck = 'after-commit-timeout';
const afterCommitRequestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let afterCommitAmbiguity = null;
try {
  await pruneAuthoritativeMirrorContent(
    afterCommitTimeoutConnection,
    authoritativeContent,
    {
      authoritativeScope: 'full',
      mode: 'apply',
      confirmation: afterCommitTimeoutPreview.confirmationToken,
      pruneRequestId: afterCommitRequestId,
      actor: 'test:commit-ack-timeout',
    }
  );
} catch (error) {
  afterCommitAmbiguity = error;
}
assert.ok(afterCommitAmbiguity instanceof AuthoritativePruneCommitOutcomeUnknownError);
assert.equal(afterCommitAmbiguity.code, 'AUTHORITATIVE_PRUNE_COMMIT_OUTCOME_UNKNOWN');
assert.equal(afterCommitAmbiguity.commitOutcome, 'unknown');
assert.equal(afterCommitAmbiguity.reconciliationRequired, true);
assert.equal(afterCommitAmbiguity.pruneRequestId, afterCommitRequestId);
assert.equal(afterCommitAmbiguity.prunePlanDigest, afterCommitTimeoutPreview.planDigest);
assert.equal(afterCommitAmbiguity.pruneConfirmationToken, afterCommitTimeoutPreview.confirmationToken);
assert.equal(afterCommitAmbiguity.importPhase, 'authoritative_prune');
assert.equal(afterCommitAmbiguity.originalCode, 'ETIMEDOUT');
assert.doesNotMatch(afterCommitAmbiguity.message, /failed/i);
assert.equal(afterCommitTimeoutConnection.destroyed, true);
assert.equal(afterCommitTimeoutConnection.queries.includes('ROLLBACK'), false);
const afterCommitEvidenceConnection = new FakePruneConnection({
  tables: afterCommitTimeoutConnection.tables,
  foreignKeys: [subjectSelfReference],
  auditRows: afterCommitTimeoutConnection.auditRows,
});
const afterCommitEvidence = await findAuthoritativePruneCommitEvidence(
  afterCommitEvidenceConnection,
  {
    requestId: afterCommitRequestId,
    planDigest: afterCommitAmbiguity.prunePlanDigest,
    confirmationToken: afterCommitAmbiguity.pruneConfirmationToken,
  }
);
assert.equal(afterCommitEvidence.committed, true);
assert.equal(afterCommitEvidence.actor, 'test:commit-ack-timeout');
assert.equal(afterCommitEvidence.totals.deleted, 4);

const beforeCommitTimeoutConnection = new FakePruneConnection({
  tables: mirrorTables(),
  foreignKeys: [subjectSelfReference],
});
const beforeCommitTimeoutPreview = await pruneAuthoritativeMirrorContent(
  beforeCommitTimeoutConnection,
  authoritativeContent,
  { authoritativeScope: 'full', mode: 'dry-run' }
);
const beforeCommitTables = clone(beforeCommitTimeoutConnection.tables);
beforeCommitTimeoutConnection.commitAck = 'before-commit-timeout';
const beforeCommitRequestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let beforeCommitAmbiguity = null;
try {
  await pruneAuthoritativeMirrorContent(
    beforeCommitTimeoutConnection,
    authoritativeContent,
    {
      authoritativeScope: 'full',
      mode: 'apply',
      confirmation: beforeCommitTimeoutPreview.confirmationToken,
      pruneRequestId: beforeCommitRequestId,
      actor: 'test:commit-before-timeout',
    }
  );
} catch (error) {
  beforeCommitAmbiguity = error;
}
assert.ok(beforeCommitAmbiguity instanceof AuthoritativePruneCommitOutcomeUnknownError);
assert.equal(beforeCommitAmbiguity.pruneRequestId, beforeCommitRequestId);
assert.equal(beforeCommitTimeoutConnection.destroyed, true);
assert.deepEqual(beforeCommitTimeoutConnection.tables, beforeCommitTables);
assert.equal(
  beforeCommitTimeoutConnection.auditRows.some(
    row => row.action === AUTHORITATIVE_PRUNE_COMMIT_ACTION && row.entityId === beforeCommitRequestId
  ),
  false
);
const beforeCommitEvidenceConnection = new FakePruneConnection({
  tables: beforeCommitTimeoutConnection.tables,
  foreignKeys: [subjectSelfReference],
  auditRows: beforeCommitTimeoutConnection.auditRows,
});
assert.deepEqual(
  await findAuthoritativePruneCommitEvidence(beforeCommitEvidenceConnection, {
    requestId: beforeCommitRequestId,
    planDigest: beforeCommitAmbiguity.prunePlanDigest,
    confirmationToken: beforeCommitAmbiguity.pruneConfirmationToken,
  }),
  { committed: false, requestId: beforeCommitRequestId }
);

assert.deepEqual(
  await findAuthoritativePruneCommitEvidence(applyConnection, {
    requestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  }),
  {
    committed: false,
    requestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  }
);

const help = spawnSync(process.execPath, ['scripts/import-json-to-db.js', '--help'], {
  cwd: ROOT,
  encoding: 'utf8',
  env: {},
});
assert.equal(help.status, 0, help.stderr);
assert.match(help.stdout, /--prune-dry-run/);
assert.match(help.stdout, new RegExp(`--confirm-prune=${AUTHORITATIVE_PRUNE_CONFIRMATION}`));

const staticCliToken = spawnSync(
  process.execPath,
  ['scripts/import-json-to-db.js', '--prune', `--confirm-prune=${AUTHORITATIVE_PRUNE_CONFIRMATION}`],
  { cwd: ROOT, encoding: 'utf8', env: {} }
);
assert.equal(staticCliToken.status, 1);
assert.match(staticCliToken.stderr, /exact .*<sha256> token from --prune-dry-run/);
assert.doesNotMatch(staticCliToken.stderr, /Database configuration is incomplete/);

const unsafeScope = spawnSync(
  process.execPath,
  ['scripts/import-json-to-db.js', '--subjects', '--prune-dry-run'],
  { cwd: ROOT, encoding: 'utf8', env: {} }
);
assert.equal(unsafeScope.status, 1);
assert.match(unsafeScope.stderr, /requires a full import/);
assert.doesNotMatch(unsafeScope.stderr, /Database configuration is incomplete/);

console.log('Authoritative JSON mirror pruning safety checks passed.');
