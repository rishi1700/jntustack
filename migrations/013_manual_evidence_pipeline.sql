CREATE TABLE IF NOT EXISTS pipeline_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  asset_id BIGINT UNSIGNED NOT NULL,
  parser_key VARCHAR(128) NOT NULL,
  entity_type ENUM('subject', 'college', 'branch_profile') NOT NULL,
  entity_key VARCHAR(255) NULL,
  status ENUM('running', 'success', 'validation_failed', 'error') NOT NULL DEFAULT 'running',
  steps_json JSON NULL,
  error_message TEXT NULL,
  created_by VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_pipeline_runs_asset (asset_id, created_at),
  KEY idx_pipeline_runs_status (status),
  CONSTRAINT fk_pipeline_runs_asset FOREIGN KEY (asset_id) REFERENCES source_assets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
