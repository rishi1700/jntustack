ALTER TABLE extraction_results
  ADD COLUMN mapped_category VARCHAR(64) NULL AFTER validation_errors_json,
  ADD COLUMN mapped_by VARCHAR(255) NULL AFTER mapped_category,
  ADD COLUMN mapped_at DATETIME NULL AFTER mapped_by,
  ADD COLUMN mapping_note TEXT NULL AFTER mapped_at,
  ADD COLUMN mapping_evidence_json JSON NULL AFTER mapping_note,
  ADD KEY idx_extraction_results_mapped_category (mapped_category);
