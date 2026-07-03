ALTER TABLE content_proposals
  MODIFY status ENUM('draft', 'needs_review', 'needs_verification', 'changes_requested', 'approved_for_draft', 'approved', 'rejected', 'applied') NOT NULL DEFAULT 'draft';

ALTER TABLE review_events
  MODIFY action ENUM('create', 'create_from_diff', 'reject', 'mark_needs_verification', 'request_changes', 'approve_for_draft', 'note') NOT NULL;
