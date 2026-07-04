UPDATE discovery_sources
SET parser_key = 'lbrce-r23-syllabus-pdf'
WHERE source_key = 'lbrce-source'
  AND (parser_key IS NULL OR parser_key IN ('', 'lbrce-syllabus-html'));

INSERT INTO audit_log
  (actor, action, entity_type, entity_id, before_json, after_json)
SELECT
  'migration:022_lbrce_r23_pdf_parser_key',
  'discovery_source.parser_key_updated',
  'discovery_source',
  CAST(id AS CHAR),
  NULL,
  JSON_OBJECT(
    'source_key', source_key,
    'parser_key', parser_key,
    'note', 'Suggest LBRCE R23 PDF syllabus parser for manually uploaded/fetched source assets.'
  )
FROM discovery_sources
WHERE source_key = 'lbrce-source'
  AND parser_key = 'lbrce-r23-syllabus-pdf';
