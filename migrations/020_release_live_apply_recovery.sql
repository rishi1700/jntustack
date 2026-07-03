ALTER TABLE release_candidates
  MODIFY status ENUM(
    'draft',
    'ready_for_review',
    'rejected',
    'applied_to_draft',
    'partial_applied_needs_review',
    'published_pending_deploy_recovered',
    'published_pending_deploy',
    'applied_to_live'
  ) NOT NULL DEFAULT 'draft';

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
    'rollback_failed'
  ) NOT NULL;

ALTER TABLE release_live_applies
  ADD COLUMN phase VARCHAR(64) NOT NULL DEFAULT 'prepare' AFTER status,
  ADD COLUMN backup_exists TINYINT(1) NOT NULL DEFAULT 0 AFTER backup_path,
  ADD COLUMN error_message TEXT NULL AFTER verification_json,
  ADD COLUMN recovery_json JSON NULL AFTER error_message,
  ADD COLUMN started_at DATETIME NULL AFTER applied_by,
  ADD COLUMN finished_at DATETIME NULL AFTER started_at;
