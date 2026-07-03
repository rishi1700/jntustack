CREATE TABLE IF NOT EXISTS release_apply_plans (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  release_candidate_id BIGINT UNSIGNED NOT NULL,
  plan_payload_json JSON NOT NULL,
  changed_files_json JSON NOT NULL,
  warnings_json JSON NULL,
  validation_summary_json JSON NULL,
  rollback_notes_json JSON NULL,
  created_by VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_release_apply_plans_release (release_candidate_id),
  KEY idx_release_apply_plans_created_at (created_at),
  CONSTRAINT fk_release_apply_plans_release FOREIGN KEY (release_candidate_id) REFERENCES release_candidates(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
