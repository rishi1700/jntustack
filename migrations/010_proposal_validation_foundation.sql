ALTER TABLE content_proposals
  ADD COLUMN validation_status ENUM('not_validated', 'passed', 'failed') NOT NULL DEFAULT 'not_validated' AFTER diff_result_id,
  ADD COLUMN validation_errors_json JSON NULL AFTER validation_status,
  ADD COLUMN normalized_payload_json JSON NULL AFTER validation_errors_json,
  ADD KEY idx_content_proposals_validation_status (validation_status);
