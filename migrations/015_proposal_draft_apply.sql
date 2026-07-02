CREATE TABLE IF NOT EXISTS proposal_draft_applies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  proposal_export_id BIGINT UNSIGNED NOT NULL,
  proposal_id BIGINT UNSIGNED NOT NULL,
  draft_path VARCHAR(1024) NOT NULL,
  validation_status ENUM('passed', 'failed') NOT NULL DEFAULT 'failed',
  validation_errors_json JSON NULL,
  summary_json JSON NULL,
  created_by VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_proposal_draft_applies_export (proposal_export_id, created_at),
  KEY idx_proposal_draft_applies_proposal (proposal_id, created_at),
  KEY idx_proposal_draft_applies_validation_status (validation_status),
  CONSTRAINT fk_proposal_draft_applies_export FOREIGN KEY (proposal_export_id) REFERENCES proposal_exports(id) ON DELETE CASCADE,
  CONSTRAINT fk_proposal_draft_applies_proposal FOREIGN KEY (proposal_id) REFERENCES content_proposals(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
