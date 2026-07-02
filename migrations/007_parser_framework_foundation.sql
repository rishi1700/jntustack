CREATE TABLE IF NOT EXISTS parse_results (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  asset_id BIGINT UNSIGNED NOT NULL,
  parser_key VARCHAR(128) NOT NULL,
  parsed_payload_json JSON NULL,
  confidence_json JSON NULL,
  parser_version VARCHAR(64) NOT NULL,
  status ENUM('success', 'error') NOT NULL DEFAULT 'success',
  error_message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_parse_results_asset (asset_id, created_at),
  KEY idx_parse_results_parser (parser_key),
  KEY idx_parse_results_status (status),
  CONSTRAINT fk_parse_results_asset FOREIGN KEY (asset_id) REFERENCES source_assets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
