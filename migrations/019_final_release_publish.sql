ALTER TABLE release_candidates
  MODIFY status ENUM('draft', 'ready_for_review', 'rejected', 'applied_to_draft', 'published_pending_deploy', 'applied_to_live') NOT NULL DEFAULT 'draft';

CREATE TABLE IF NOT EXISTS release_live_applies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  release_candidate_id BIGINT UNSIGNED NOT NULL,
  apply_plan_path VARCHAR(1024) NOT NULL,
  backup_path VARCHAR(1024) NOT NULL,
  changed_files_json JSON NOT NULL,
  verification_json JSON NULL,
  status ENUM('published_pending_deploy', 'applied_to_live', 'failed', 'rolled_back', 'rollback_failed') NOT NULL,
  reviewer_note TEXT NOT NULL,
  applied_by VARCHAR(255) NULL,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rolled_back_by VARCHAR(255) NULL,
  rolled_back_at DATETIME NULL,
  rollback_note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_release_live_applies_release (release_candidate_id, applied_at),
  KEY idx_release_live_applies_status (status),
  CONSTRAINT fk_release_live_applies_release FOREIGN KEY (release_candidate_id) REFERENCES release_candidates(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
