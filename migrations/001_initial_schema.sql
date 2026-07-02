CREATE TABLE IF NOT EXISTS sources (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  origin_url VARCHAR(2048) NULL,
  source_type VARCHAR(64) NULL,
  source_name VARCHAR(255) NULL,
  retrieved_at DATETIME NULL,
  checksum CHAR(64) NULL,
  status ENUM('verified', 'needs_verification', 'placeholder', 'rejected', 'failed') NOT NULL DEFAULT 'needs_verification',
  caveat_text TEXT NULL,
  raw_asset_path VARCHAR(1024) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sources_status (status),
  KEY idx_sources_checksum (checksum)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS universities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(255) NOT NULL,
  state VARCHAR(128) NULL,
  status ENUM('active', 'legacy', 'unconfirmed') NOT NULL DEFAULT 'active',
  source_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_universities_code (code),
  CONSTRAINT fk_universities_source FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS regulations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(32) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  status ENUM('active', 'legacy', 'deprecated', 'unconfirmed') NOT NULL DEFAULT 'unconfirmed',
  effective_from VARCHAR(32) NULL,
  supersedes_id BIGINT UNSIGNED NULL,
  branch_groups_json JSON NULL,
  evaluation_scheme TEXT NULL,
  honors_minor_rules TEXT NULL,
  source_id BIGINT UNSIGNED NULL,
  last_verified_at DATE NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_regulations_code (code),
  CONSTRAINT fk_regulations_supersedes FOREIGN KEY (supersedes_id) REFERENCES regulations(id) ON DELETE SET NULL,
  CONSTRAINT fk_regulations_source FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS branches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  branch_group VARCHAR(64) NULL,
  specializations_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_branches_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subjects (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  stable_id VARCHAR(255) NOT NULL,
  regulation_id BIGINT UNSIGNED NULL,
  branch_id BIGINT UNSIGNED NULL,
  specialization_code VARCHAR(64) NULL,
  year TINYINT UNSIGNED NULL,
  semester TINYINT UNSIGNED NULL,
  year_sem_label VARCHAR(16) NULL,
  subject_code VARCHAR(64) NULL,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(64) NULL,
  subject_type VARCHAR(64) NULL,
  credits_json JSON NULL,
  units_json JSON NULL,
  course_outcomes_json JSON NULL,
  resources_json JSON NULL,
  seo_slug VARCHAR(255) NULL,
  seo_title VARCHAR(255) NULL,
  meta_description VARCHAR(512) NULL,
  legacy_subject_id BIGINT UNSIGNED NULL,
  source_id BIGINT UNSIGNED NULL,
  status ENUM('verified', 'needs_verification', 'placeholder') NOT NULL DEFAULT 'needs_verification',
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_subjects_stable_id (stable_id),
  UNIQUE KEY uq_subjects_seo_slug (seo_slug),
  KEY idx_subjects_status (status),
  KEY idx_subjects_branch_regulation (branch_id, regulation_id),
  CONSTRAINT fk_subjects_regulation FOREIGN KEY (regulation_id) REFERENCES regulations(id) ON DELETE SET NULL,
  CONSTRAINT fk_subjects_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  CONSTRAINT fk_subjects_legacy FOREIGN KEY (legacy_subject_id) REFERENCES subjects(id) ON DELETE SET NULL,
  CONSTRAINT fk_subjects_source FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS colleges (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  short_code VARCHAR(64) NULL,
  university_id BIGINT UNSIGNED NULL,
  city VARCHAR(128) NULL,
  district VARCHAR(128) NULL,
  state VARCHAR(128) NULL,
  college_type ENUM('Government', 'Private', 'Autonomous-Private', 'Constituent') NULL,
  branches_offered_json JSON NULL,
  official_website VARCHAR(2048) NULL,
  nirf_rank INT UNSIGNED NULL,
  source_id BIGINT UNSIGNED NULL,
  status ENUM('verified', 'needs_verification', 'placeholder') NOT NULL DEFAULT 'needs_verification',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_colleges_university_code_name (university_id, short_code, name),
  KEY idx_colleges_status (status),
  KEY idx_colleges_district (district),
  CONSTRAINT fk_colleges_university FOREIGN KEY (university_id) REFERENCES universities(id) ON DELETE SET NULL,
  CONSTRAINT fk_colleges_source FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS content_proposals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_type ENUM('university', 'regulation', 'branch', 'subject', 'college', 'branch_profile') NOT NULL,
  entity_key VARCHAR(255) NOT NULL,
  proposed_payload_json JSON NOT NULL,
  diff_json JSON NULL,
  source_id BIGINT UNSIGNED NULL,
  status ENUM('draft', 'needs_review', 'approved', 'rejected', 'applied') NOT NULL DEFAULT 'draft',
  created_by VARCHAR(255) NULL,
  reviewed_by VARCHAR(255) NULL,
  reviewed_at DATETIME NULL,
  review_note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_content_proposals_status (status),
  KEY idx_content_proposals_entity (entity_type, entity_key),
  CONSTRAINT fk_content_proposals_source FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor VARCHAR(255) NULL,
  action VARCHAR(128) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(255) NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_log_entity (entity_type, entity_id),
  KEY idx_audit_log_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
