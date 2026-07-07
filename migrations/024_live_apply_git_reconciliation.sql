-- Kills the "forensic debt" problem: release_live_applies/release_candidates
-- used to sit in 'published_pending_deploy' forever with no code path that
-- ever recorded whether the change was actually reconciled into git. See
-- lib/release-live-apply.js commitLiveApplyToGit() and
-- scripts/reconcile-live-apply.js for the two paths that now use these:
--
--   committed_pending_push -- the app itself created a local git commit for
--     this apply right after verification passed. Not pushed yet (this
--     process never gets push/remote credentials, by design).
--   reconciled -- a human manually confirmed (via git-history/live-site
--     cross-referencing, or any other means) that an older
--     published_pending_deploy(_recovered) row is already synced into git.
--     Only ever set explicitly, by row id, via scripts/reconcile-live-apply.js.
--     Never set by a blanket/automatic migration.

ALTER TABLE release_live_applies
  MODIFY status ENUM(
    'started',
    'backup_created',
    'files_written',
    'verification_running',
    'verification_passed',
    'completed',
    'published_pending_deploy',
    'published_pending_deploy_recovered',
    'applied_to_live',
    'failed',
    'partial_applied',
    'recovered_applied',
    'manual_rollback_required',
    'rolled_back',
    'rollback_failed',
    'committed_pending_push',
    'reconciled'
  ) NOT NULL;

ALTER TABLE release_live_applies
  ADD COLUMN git_commit_sha VARCHAR(64) NULL AFTER finished_at,
  ADD COLUMN git_commit_error TEXT NULL AFTER git_commit_sha,
  ADD COLUMN git_committed_at DATETIME NULL AFTER git_commit_error;

ALTER TABLE release_candidates
  MODIFY status ENUM(
    'draft',
    'ready_for_review',
    'rejected',
    'applied_to_draft',
    'partial_applied_needs_review',
    'published_pending_deploy_recovered',
    'published_pending_deploy',
    'applied_to_live',
    'committed_pending_push',
    'reconciled'
  ) NOT NULL DEFAULT 'draft';
