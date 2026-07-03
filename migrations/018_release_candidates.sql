CREATE TABLE IF NOT EXISTS release_candidates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(255) NOT NULL,
  status ENUM('draft', 'ready_for_review', 'rejected', 'applied_to_draft') NOT NULL DEFAULT 'draft',
  created_by VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_release_candidates_status (status),
  KEY idx_release_candidates_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS release_candidate_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  release_candidate_id BIGINT UNSIGNED NOT NULL,
  proposal_id BIGINT UNSIGNED NOT NULL,
  proposal_export_id BIGINT UNSIGNED NULL,
  draft_apply_id BIGINT UNSIGNED NULL,
  revision_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_release_candidate_items_proposal (release_candidate_id, proposal_id),
  KEY idx_release_candidate_items_release (release_candidate_id),
  KEY idx_release_candidate_items_proposal (proposal_id),
  KEY idx_release_candidate_items_export (proposal_export_id),
  KEY idx_release_candidate_items_draft (draft_apply_id),
  KEY idx_release_candidate_items_revision (revision_id),
  CONSTRAINT fk_release_candidate_items_release FOREIGN KEY (release_candidate_id) REFERENCES release_candidates(id) ON DELETE CASCADE,
  CONSTRAINT fk_release_candidate_items_proposal FOREIGN KEY (proposal_id) REFERENCES content_proposals(id) ON DELETE CASCADE,
  CONSTRAINT fk_release_candidate_items_export FOREIGN KEY (proposal_export_id) REFERENCES proposal_exports(id) ON DELETE SET NULL,
  CONSTRAINT fk_release_candidate_items_draft FOREIGN KEY (draft_apply_id) REFERENCES proposal_draft_applies(id) ON DELETE SET NULL,
  CONSTRAINT fk_release_candidate_items_revision FOREIGN KEY (revision_id) REFERENCES content_revisions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
