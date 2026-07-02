CREATE TABLE IF NOT EXISTS proposal_exports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  proposal_id BIGINT UNSIGNED NOT NULL,
  export_path VARCHAR(1024) NOT NULL,
  export_payload_json JSON NOT NULL,
  validation_status ENUM('not_validated', 'passed', 'failed') NOT NULL DEFAULT 'not_validated',
  validation_errors_json JSON NULL,
  created_by VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_proposal_exports_proposal (proposal_id, created_at),
  KEY idx_proposal_exports_validation_status (validation_status),
  CONSTRAINT fk_proposal_exports_proposal FOREIGN KEY (proposal_id) REFERENCES content_proposals(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
