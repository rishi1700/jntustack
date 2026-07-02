ALTER TABLE review_events
  MODIFY action ENUM('create', 'reject', 'mark_needs_verification', 'request_changes', 'note') NOT NULL;
