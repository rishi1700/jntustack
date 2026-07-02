CREATE TABLE IF NOT EXISTS extraction_results (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  parse_result_id BIGINT UNSIGNED NOT NULL,
  entity_type ENUM('subject', 'college', 'branch_profile') NOT NULL,
  entity_key VARCHAR(255) NULL,
  extracted_payload_json JSON NULL,
  confidence_json JSON NULL,
  validation_status ENUM('not_validated', 'passed', 'failed') NOT NULL DEFAULT 'not_validated',
  validation_errors_json JSON NULL,
  status ENUM('success', 'error') NOT NULL DEFAULT 'success',
  error_message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_extraction_results_parse_result (parse_result_id, created_at),
  KEY idx_extraction_results_entity (entity_type, entity_key),
  KEY idx_extraction_results_validation_status (validation_status),
  KEY idx_extraction_results_status (status),
  CONSTRAINT fk_extraction_results_parse_result FOREIGN KEY (parse_result_id) REFERENCES parse_results(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE diff_results
  ADD COLUMN extraction_result_id BIGINT UNSIGNED NULL AFTER parse_result_id,
  ADD KEY idx_diff_results_extraction_result (extraction_result_id),
  ADD CONSTRAINT fk_diff_results_extraction_result FOREIGN KEY (extraction_result_id) REFERENCES extraction_results(id) ON DELETE SET NULL;
