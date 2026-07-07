// Manually reconciles specific release_live_applies rows that a human has
// confirmed (by whatever means -- git-history cross-referencing, live-page
// checks, etc.) are already synced into git, but that predate or otherwise
// bypassed the automatic commitLiveApplyToGit() path in
// lib/release-live-apply.js and so are stuck in published_pending_deploy(_recovered)
// forever with no code path that ever clears that status.
//
// Deliberately explicit-ids-only. There is NO blanket/auto mode. This never
// scans for "probably clean" rows and updates them -- it only touches the
// exact ids you pass, and only if you also state why.
//
// Usage:
//   node scripts/reconcile-live-apply.js <id> [<id> ...] --note="<evidence>" [--actor=you@example.com]
//
// Example (the 6 rows human-verified-reconciled during the 2026-07-07
// session: RC7/RC9/RC10/RC11/RC12/RC13, live_apply ids 2-7, matched against
// commits f69d855/00f38b0/25a8872/b96414d/6258f4b/29ac399 and confirmed via
// live HTTP 200s on the actual published slugs):
//   node scripts/reconcile-live-apply.js 2 3 4 5 6 7 \
//     --note="Matched to commits f69d855/00f38b0/25a8872/b96414d/6258f4b/29ac399 (exact file sets + one exact content diff for id 2); live slugs confirmed 200. See 2026-07-07 session notes." \
//     --actor=you@example.com

import { closeDbPool, describeDbError, getDbPool } from '../lib/db.js';

const RECONCILABLE_STATUSES = new Set(['published_pending_deploy', 'published_pending_deploy_recovered']);

function parseArgs(argv) {
  const ids = [];
  let note = '';
  let actor = null;
  for (const arg of argv) {
    if (arg.startsWith('--note=')) {
      note = arg.slice('--note='.length);
      continue;
    }
    if (arg.startsWith('--actor=')) {
      actor = arg.slice('--actor='.length);
      continue;
    }
    const id = Number(arg);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`Not a valid release_live_applies id: "${arg}"`);
    }
    ids.push(id);
  }
  return { ids, note: note.trim(), actor };
}

async function audit(pool, { actor, action, entityType, entityId, before = null, after = null }) {
  await pool.execute(
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

async function reconcileOne(pool, id, { note, actor }) {
  const [rows] = await pool.execute('SELECT * FROM release_live_applies WHERE id = ?', [id]);
  const row = rows[0];
  if (!row) {
    return { id, ok: false, reason: 'no such release_live_applies row' };
  }
  if (!RECONCILABLE_STATUSES.has(row.status)) {
    return { id, ok: false, reason: `status is "${row.status}", not one of ${[...RECONCILABLE_STATUSES].join('/')} -- refusing to touch` };
  }

  const previousStatus = row.status;
  await pool.execute(`UPDATE release_live_applies SET status = 'reconciled' WHERE id = ?`, [id]);
  const [candidateResult] = await pool.execute(
    `UPDATE release_candidates SET status = 'reconciled' WHERE id = ? AND status IN ('published_pending_deploy', 'published_pending_deploy_recovered')`,
    [row.release_candidate_id]
  );

  await audit(pool, {
    actor,
    action: 'release_live_apply.manually_reconciled',
    entityType: 'release_live_apply',
    entityId: id,
    before: { status: previousStatus },
    after: {
      release_candidate_id: row.release_candidate_id,
      previous_status: previousStatus,
      new_status: 'reconciled',
      release_candidate_also_updated: candidateResult.affectedRows > 0,
      note,
    },
  });

  return {
    id,
    ok: true,
    releaseCandidateId: row.release_candidate_id,
    previousStatus,
    releaseCandidateUpdated: candidateResult.affectedRows > 0,
  };
}

async function main() {
  const { ids, note, actor } = parseArgs(process.argv.slice(2));

  if (!ids.length) {
    console.log('Usage: node scripts/reconcile-live-apply.js <id> [<id> ...] --note="<evidence>" [--actor=you@example.com]');
    console.log('No ids given -- nothing to do. This script never runs a blanket update.');
    return;
  }
  if (!note) {
    throw new Error('--note="..." is required: state the evidence for why these ids are already reconciled into git.');
  }

  const pool = await getDbPool({ requireConfigured: true });
  const results = [];
  for (const id of ids) {
    results.push(await reconcileOne(pool, id, { note, actor }));
  }

  console.log(JSON.stringify(results, null, 2));
  const failed = results.filter(result => !result.ok);
  if (failed.length) {
    console.error(`${failed.length} of ${results.length} id(s) were NOT reconciled -- see reasons above.`);
    process.exitCode = 1;
  } else {
    console.log(`Reconciled ${results.length} release_live_applies row(s).`);
  }
}

main().catch(err => {
  console.error('Reconciliation failed:', JSON.stringify(describeDbError(err), null, 2));
  process.exitCode = 1;
}).finally(async () => {
  await closeDbPool();
});
