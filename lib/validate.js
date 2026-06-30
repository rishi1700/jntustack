import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import fs from 'node:fs';

/**
 * Loads schema + data from disk and validates the data against the schema.
 * Throws (and halts the build) if the data is structurally invalid.
 * This is a build-time gate, not a documentation suggestion -- a malformed
 * record cannot reach dist/ no matter what generated or wrote it.
 */
export function loadAndValidate(schemaPath, dataPath) {
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const valid = validate(data);

  if (!valid) {
    console.error('Schema validation FAILED -- build aborted:');
    for (const err of validate.errors) {
      console.error(`  ${err.instancePath || '(root)'} ${err.message}`);
    }
    throw new Error(`${validate.errors.length} schema violation(s) found.`);
  }

  return data;
}
