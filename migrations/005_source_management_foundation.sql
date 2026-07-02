CREATE TABLE IF NOT EXISTS discovery_sources (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_key VARCHAR(128) NOT NULL,
  name VARCHAR(255) NOT NULL,
  base_url VARCHAR(2048) NOT NULL,
  university_id BIGINT UNSIGNED NULL,
  branch_id BIGINT UNSIGNED NULL,
  source_kind VARCHAR(64) NOT NULL DEFAULT 'other',
  trust_level VARCHAR(64) NOT NULL DEFAULT 'unknown',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  crawl_enabled TINYINT(1) NOT NULL DEFAULT 0,
  parser_key VARCHAR(128) NULL,
  notes TEXT NULL,
  last_checked_at DATETIME NULL,
  last_success_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_discovery_sources_key (source_key),
  KEY idx_discovery_sources_enabled (enabled),
  KEY idx_discovery_sources_kind (source_kind),
  KEY idx_discovery_sources_trust (trust_level),
  CONSTRAINT fk_discovery_sources_university FOREIGN KEY (university_id) REFERENCES universities(id) ON DELETE SET NULL,
  CONSTRAINT fk_discovery_sources_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS source_assets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  discovery_source_id BIGINT UNSIGNED NOT NULL,
  url VARCHAR(2048) NOT NULL,
  asset_kind VARCHAR(64) NOT NULL DEFAULT 'page',
  content_type VARCHAR(255) NULL,
  checksum CHAR(64) NULL,
  storage_path VARCHAR(1024) NULL,
  fetched_at DATETIME NULL,
  status ENUM('discovered', 'fetched', 'failed', 'ignored') NOT NULL DEFAULT 'discovered',
  metadata_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_source_assets_source_url (discovery_source_id, url(700)),
  KEY idx_source_assets_status (status),
  KEY idx_source_assets_checksum (checksum),
  CONSTRAINT fk_source_assets_discovery_source FOREIGN KEY (discovery_source_id) REFERENCES discovery_sources(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crawl_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  discovery_source_id BIGINT UNSIGNED NOT NULL,
  status ENUM('queued', 'running', 'success', 'failed', 'cancelled') NOT NULL DEFAULT 'queued',
  started_at DATETIME NULL,
  finished_at DATETIME NULL,
  items_discovered INT UNSIGNED NOT NULL DEFAULT 0,
  assets_created INT UNSIGNED NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_crawl_runs_source_created (discovery_source_id, created_at),
  KEY idx_crawl_runs_status (status),
  CONSTRAINT fk_crawl_runs_discovery_source FOREIGN KEY (discovery_source_id) REFERENCES discovery_sources(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS discovered_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  discovery_source_id BIGINT UNSIGNED NOT NULL,
  crawl_run_id BIGINT UNSIGNED NULL,
  source_asset_id BIGINT UNSIGNED NULL,
  item_key VARCHAR(255) NULL,
  item_type VARCHAR(64) NOT NULL DEFAULT 'unknown',
  title VARCHAR(512) NULL,
  url VARCHAR(2048) NULL,
  status ENUM('discovered', 'ignored', 'needs_review', 'proposal_created', 'failed') NOT NULL DEFAULT 'discovered',
  confidence DECIMAL(5,4) NULL,
  raw_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_discovered_items_source_key (discovery_source_id, item_key),
  KEY idx_discovered_items_status (status),
  KEY idx_discovered_items_type (item_type),
  CONSTRAINT fk_discovered_items_discovery_source FOREIGN KEY (discovery_source_id) REFERENCES discovery_sources(id) ON DELETE CASCADE,
  CONSTRAINT fk_discovered_items_crawl_run FOREIGN KEY (crawl_run_id) REFERENCES crawl_runs(id) ON DELETE SET NULL,
  CONSTRAINT fk_discovered_items_source_asset FOREIGN KEY (source_asset_id) REFERENCES source_assets(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO discovery_sources
  (source_key, name, base_url, university_id, source_kind, trust_level, enabled, crawl_enabled, parser_key, notes)
VALUES
  ('jntuk-official', 'JNTUK official', 'https://www.jntuk.edu.in/', (SELECT id FROM universities WHERE code = 'JNTUK' LIMIT 1), 'university_official', 'official', 1, 0, NULL, 'Official university website. Source registry only; no crawling is enabled.'),
  ('jntuh-official', 'JNTUH official', 'https://jntuh.ac.in/', (SELECT id FROM universities WHERE code = 'JNTUH' LIMIT 1), 'university_official', 'official', 1, 0, NULL, 'Official university website. Source registry only; no crawling is enabled.'),
  ('jntua-official', 'JNTUA official', 'https://www.jntua.ac.in/', (SELECT id FROM universities WHERE code = 'JNTUA' LIMIT 1), 'university_official', 'official', 1, 0, NULL, 'Official university website. Source registry only; no crawling is enabled.'),
  ('jntugv-official', 'JNTU-GV official', 'https://jntugv.edu.in/', (SELECT id FROM universities WHERE code = 'JNTUGV' LIMIT 1), 'university_official', 'official', 1, 0, NULL, 'Official university website. Source registry only; no crawling is enabled.'),
  ('tirumala-source', 'Tirumala source', 'https://www.tecnrt.org/', (SELECT id FROM universities WHERE code = 'JNTUK' LIMIT 1), 'college_official', 'affiliated', 1, 0, NULL, 'Affiliated autonomous-college source. Use as supporting evidence; do not treat as a university-wide syllabus source without review.'),
  ('lbrce-source', 'LBRCE source', 'https://www.lbrce.ac.in/', (SELECT id FROM universities WHERE code = 'JNTUK' LIMIT 1), 'college_official', 'affiliated', 1, 0, NULL, 'Affiliated autonomous-college source. Use as supporting evidence; do not treat as a university-wide syllabus source without review.')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  base_url = VALUES(base_url),
  university_id = COALESCE(VALUES(university_id), university_id),
  source_kind = VALUES(source_kind),
  trust_level = VALUES(trust_level),
  notes = VALUES(notes);

INSERT INTO audit_log
  (actor, action, entity_type, entity_id, before_json, after_json)
SELECT
  'migration:005_source_management_foundation',
  'discovery_source.seed',
  'discovery_source',
  CAST(id AS CHAR),
  NULL,
  JSON_OBJECT(
    'id', id,
    'source_key', source_key,
    'name', name,
    'base_url', base_url,
    'source_kind', source_kind,
    'trust_level', trust_level,
    'enabled', enabled,
    'crawl_enabled', crawl_enabled
  )
FROM discovery_sources
WHERE source_key IN (
  'jntuk-official',
  'jntuh-official',
  'jntua-official',
  'jntugv-official',
  'tirumala-source',
  'lbrce-source'
);
