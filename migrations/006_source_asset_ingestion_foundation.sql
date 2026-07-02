ALTER TABLE source_assets
  ADD COLUMN source_url VARCHAR(2048) NULL AFTER discovery_source_id,
  ADD COLUMN original_filename VARCHAR(255) NULL AFTER source_url,
  ADD COLUMN file_size BIGINT UNSIGNED NULL AFTER content_type,
  ADD COLUMN sha256_checksum CHAR(64) NULL AFTER file_size,
  ADD COLUMN etag VARCHAR(255) NULL AFTER sha256_checksum,
  ADD COLUMN last_modified VARCHAR(255) NULL AFTER etag,
  ADD COLUMN local_storage_path VARCHAR(1024) NULL AFTER last_modified,
  ADD COLUMN downloaded_at DATETIME NULL AFTER local_storage_path,
  ADD COLUMN download_status ENUM('stored', 'duplicate', 'failed') NOT NULL DEFAULT 'stored' AFTER downloaded_at,
  ADD COLUMN download_error TEXT NULL AFTER download_status,
  ADD COLUMN duplicate_of_asset_id BIGINT UNSIGNED NULL AFTER download_error,
  ADD KEY idx_source_assets_sha256 (sha256_checksum),
  ADD KEY idx_source_assets_download_status (download_status),
  ADD CONSTRAINT fk_source_assets_duplicate_of FOREIGN KEY (duplicate_of_asset_id) REFERENCES source_assets(id) ON DELETE SET NULL;

UPDATE source_assets
SET
  source_url = COALESCE(source_url, url),
  sha256_checksum = COALESCE(sha256_checksum, checksum),
  local_storage_path = COALESCE(local_storage_path, storage_path),
  downloaded_at = COALESCE(downloaded_at, fetched_at),
  download_status = CASE
    WHEN status = 'failed' THEN 'failed'
    WHEN local_storage_path IS NOT NULL OR storage_path IS NOT NULL THEN 'stored'
    ELSE download_status
  END;
