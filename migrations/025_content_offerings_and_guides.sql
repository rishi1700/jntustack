ALTER TABLE subjects
  ADD COLUMN branch_codes_json JSON NULL AFTER branch_id,
  ADD COLUMN offerings_json JSON NULL AFTER year_sem_label,
  ADD COLUMN offering_categories_json JSON NULL AFTER category,
  ADD COLUMN publication_mode ENUM('page', 'listing_only') NOT NULL DEFAULT 'page' AFTER resources_json,
  ADD COLUMN listing_url VARCHAR(2048) NULL AFTER publication_mode;

CREATE TABLE IF NOT EXISTS guides (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  stable_id VARCHAR(255) NOT NULL,
  regulation_id BIGINT UNSIGNED NULL,
  name VARCHAR(255) NOT NULL,
  intro TEXT NULL,
  aliases_json JSON NULL,
  sections_json JSON NOT NULL,
  seo_slug VARCHAR(255) NOT NULL,
  seo_title VARCHAR(255) NOT NULL,
  meta_description VARCHAR(512) NOT NULL,
  source_id BIGINT UNSIGNED NULL,
  status ENUM('verified', 'needs_verification', 'placeholder') NOT NULL DEFAULT 'needs_verification',
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_guides_stable_id (stable_id),
  UNIQUE KEY uq_guides_seo_slug (seo_slug),
  KEY idx_guides_status (status),
  CONSTRAINT fk_guides_regulation FOREIGN KEY (regulation_id) REFERENCES regulations(id) ON DELETE SET NULL,
  CONSTRAINT fk_guides_source FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE content_proposals
  MODIFY entity_type ENUM('university', 'regulation', 'branch', 'subject', 'college', 'branch_profile', 'guide') NOT NULL;

ALTER TABLE diff_results
  MODIFY entity_type ENUM('subject', 'college', 'branch_profile', 'guide') NOT NULL;

ALTER TABLE extraction_results
  MODIFY entity_type ENUM('subject', 'college', 'branch_profile', 'guide') NOT NULL;

ALTER TABLE pipeline_runs
  MODIFY entity_type ENUM('subject', 'college', 'branch_profile', 'guide') NOT NULL;

ALTER TABLE content_revisions
  MODIFY entity_type ENUM('subject', 'college', 'branch_profile', 'guide') NOT NULL;
