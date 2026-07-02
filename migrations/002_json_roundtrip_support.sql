ALTER TABLE sources
  ADD UNIQUE KEY uq_sources_checksum (checksum);

ALTER TABLE branches
  ADD COLUMN status ENUM('verified', 'needs_verification', 'placeholder') NOT NULL DEFAULT 'verified' AFTER specializations_json,
  ADD COLUMN source_id BIGINT UNSIGNED NULL AFTER status,
  ADD KEY idx_branches_status (status),
  ADD CONSTRAINT fk_branches_source FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL;

ALTER TABLE colleges
  ADD COLUMN stable_key VARCHAR(512) NULL AFTER id,
  ADD UNIQUE KEY uq_colleges_stable_key (stable_key);

CREATE TABLE IF NOT EXISTS branch_profiles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  branch_id BIGINT UNSIGNED NULL,
  branch_code VARCHAR(64) NOT NULL,
  tagline VARCHAR(255) NOT NULL,
  core_focus_json JSON NOT NULL,
  suits_students_who_json JSON NOT NULL,
  less_good_fit_if_json JSON NULL,
  career_paths_json JSON NOT NULL,
  further_study_paths_json JSON NULL,
  related_branches_json JSON NULL,
  data_disclaimer TEXT NULL,
  source_id BIGINT UNSIGNED NULL,
  status ENUM('verified', 'needs_verification', 'placeholder') NOT NULL DEFAULT 'needs_verification',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_branch_profiles_branch_code (branch_code),
  KEY idx_branch_profiles_status (status),
  CONSTRAINT fk_branch_profiles_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  CONSTRAINT fk_branch_profiles_source FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
