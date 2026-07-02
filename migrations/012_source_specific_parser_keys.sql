UPDATE discovery_sources
SET parser_key = 'tirumala-syllabus-html'
WHERE source_key = 'tirumala-source'
  AND (parser_key IS NULL OR parser_key = '');

UPDATE discovery_sources
SET parser_key = 'lbrce-syllabus-html'
WHERE source_key = 'lbrce-source'
  AND (parser_key IS NULL OR parser_key = '');
