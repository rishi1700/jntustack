CREATE TABLE IF NOT EXISTS diff_results (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  parse_result_id BIGINT UNSIGNED NOT NULL,
  entity_type ENUM('subject', 'college', 'branch_profile') NOT NULL,
  entity_key VARCHAR(255) NOT NULL,
  existing_payload_json JSON NULL,
  proposed_payload_json JSON NULL,
  diff_json JSON NULL,
  confidence_json JSON NULL,
  status ENUM('success', 'error') NOT NULL DEFAULT 'success',
  error_message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_diff_results_parse_result (parse_result_id, created_at),
  KEY idx_diff_results_entity (entity_type, entity_key),
  KEY idx_diff_results_status (status),
  CONSTRAINT fk_diff_results_parse_result FOREIGN KEY (parse_result_id) REFERENCES parse_results(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
