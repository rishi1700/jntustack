ALTER TABLE content_proposals
  MODIFY status ENUM('draft', 'needs_review', 'needs_verification', 'changes_requested', 'approved', 'rejected', 'applied') NOT NULL DEFAULT 'draft';

CREATE TABLE IF NOT EXISTS review_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  proposal_id BIGINT UNSIGNED NOT NULL,
  actor VARCHAR(255) NULL,
  action ENUM('reject', 'mark_needs_verification', 'request_changes', 'note') NOT NULL,
  from_status VARCHAR(64) NULL,
  to_status VARCHAR(64) NULL,
  note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_review_events_proposal (proposal_id),
  KEY idx_review_events_created_at (created_at),
  CONSTRAINT fk_review_events_proposal FOREIGN KEY (proposal_id) REFERENCES content_proposals(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
