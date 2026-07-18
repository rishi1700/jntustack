ALTER TABLE source_assets
  ADD COLUMN resolved_url VARCHAR(2048) NULL AFTER source_url,
  ADD COLUMN supersedes_asset_id BIGINT UNSIGNED NULL AFTER duplicate_of_asset_id,
  ADD COLUMN storage_provider ENUM('local', 'r2') NOT NULL DEFAULT 'local' AFTER local_storage_path,
  ADD COLUMN storage_key VARCHAR(1024) NULL AFTER storage_provider,
  ADD COLUMN storage_etag VARCHAR(255) NULL AFTER storage_key,
  ADD COLUMN storage_verified_at DATETIME NULL AFTER storage_etag,
  DROP INDEX uq_source_assets_source_url,
  ADD KEY idx_source_assets_source_url (discovery_source_id, url(700)),
  ADD KEY idx_source_assets_resolved_url (discovery_source_id, resolved_url(700)),
  ADD UNIQUE KEY uq_source_assets_supersedes (supersedes_asset_id),
  ADD KEY idx_source_assets_storage (storage_provider, storage_key(191));

ALTER TABLE source_assets
  ADD CONSTRAINT fk_source_assets_supersedes
    FOREIGN KEY (supersedes_asset_id) REFERENCES source_assets(id) ON DELETE SET NULL;

UPDATE source_assets
SET storage_provider = 'local',
    storage_key = CASE
      WHEN LOWER(REPLACE(local_storage_path, CHAR(92), '/')) LIKE 'source-assets/%'
        THEN REPLACE(local_storage_path, CHAR(92), '/')
      WHEN LOWER(REPLACE(local_storage_path, CHAR(92), '/')) LIKE 'storage/source-assets/%'
        THEN SUBSTRING(REPLACE(local_storage_path, CHAR(92), '/'), 9)
      WHEN LOCATE('/storage/source-assets/', LOWER(REPLACE(local_storage_path, CHAR(92), '/'))) > 0
        THEN SUBSTRING(
          REPLACE(local_storage_path, CHAR(92), '/'),
          LOCATE('/storage/', LOWER(REPLACE(local_storage_path, CHAR(92), '/'))) + 9
        )
      ELSE NULL
    END
WHERE storage_key IS NULL
  AND local_storage_path IS NOT NULL;

ALTER TABLE release_apply_plans
  ADD COLUMN artifact_schema_version SMALLINT UNSIGNED NULL AFTER rollback_notes_json,
  ADD COLUMN base_git_sha VARCHAR(64) NULL AFTER artifact_schema_version,
  ADD COLUMN artifact_hash CHAR(64) NULL AFTER base_git_sha,
  ADD COLUMN before_file_hashes_json JSON NULL AFTER artifact_hash,
  ADD COLUMN after_file_hashes_json JSON NULL AFTER before_file_hashes_json,
  ADD COLUMN artifact_payload_json JSON NULL AFTER after_file_hashes_json,
  ADD KEY idx_release_apply_plans_artifact_hash (artifact_hash);

ALTER TABLE release_candidates
  ADD COLUMN publication_mode ENUM('legacy', 'github_pr') NOT NULL DEFAULT 'legacy' AFTER status,
  ADD KEY idx_release_candidates_publication_mode (publication_mode);

CREATE TABLE IF NOT EXISTS github_publications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  release_candidate_id BIGINT UNSIGNED NOT NULL,
  release_apply_plan_id BIGINT UNSIGNED NOT NULL,
  idempotency_key CHAR(64) NOT NULL,
  artifact_schema_version SMALLINT UNSIGNED NOT NULL,
  artifact_hash CHAR(64) NOT NULL,
  base_sha VARCHAR(64) NOT NULL,
  manifest_sha256 CHAR(64) NOT NULL,
  manifest_base64 MEDIUMTEXT NOT NULL,
  signing_key_id VARCHAR(64) NOT NULL,
  repository_full_name VARCHAR(255) NOT NULL,
  default_branch VARCHAR(255) NOT NULL,
  branch_name VARCHAR(255) NOT NULL,
  head_sha VARCHAR(64) NULL,
  merge_sha VARCHAR(64) NULL,
  pr_number BIGINT UNSIGNED NULL,
  pr_url VARCHAR(2048) NULL,
  status ENUM(
    'preparing',
    'pr_open',
    'blocked_stale_base',
    'tampered',
    'ci_failed',
    'closed_unmerged',
    'deploy_pending',
    'deployed',
    'verification_inconclusive',
    'verification_failed',
    'superseded',
    'failed'
  ) NOT NULL DEFAULT 'preparing',
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  verification_json JSON NULL,
  last_verification_attempt_json JSON NULL,
  created_by VARCHAR(255) NULL,
  pr_created_at DATETIME NULL,
  merged_at DATETIME NULL,
  last_checked_at DATETIME NULL,
  verified_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_github_publications_idempotency (idempotency_key),
  UNIQUE KEY uq_github_publications_release (release_candidate_id),
  UNIQUE KEY uq_github_publications_branch (branch_name),
  KEY idx_github_publications_release (release_candidate_id, id),
  KEY idx_github_publications_status (status, updated_at),
  KEY idx_github_publications_pr (pr_number),
  CONSTRAINT fk_github_publications_release
    FOREIGN KEY (release_candidate_id) REFERENCES release_candidates(id) ON DELETE RESTRICT,
  CONSTRAINT fk_github_publications_plan
    FOREIGN KEY (release_apply_plan_id) REFERENCES release_apply_plans(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
