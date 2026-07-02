ALTER TABLE content_proposals
  ADD COLUMN parse_result_id BIGINT UNSIGNED NULL AFTER source_id,
  ADD COLUMN diff_result_id BIGINT UNSIGNED NULL AFTER parse_result_id,
  ADD UNIQUE KEY uq_content_proposals_diff_result (diff_result_id),
  ADD KEY idx_content_proposals_parse_result (parse_result_id),
  ADD CONSTRAINT fk_content_proposals_parse_result FOREIGN KEY (parse_result_id) REFERENCES parse_results(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_content_proposals_diff_result FOREIGN KEY (diff_result_id) REFERENCES diff_results(id) ON DELETE SET NULL;

ALTER TABLE review_events
  MODIFY action ENUM('create', 'create_from_diff', 'reject', 'mark_needs_verification', 'request_changes', 'note') NOT NULL;
