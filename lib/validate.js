import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import fs from 'node:fs';

/**
 * Validates an already-assembled dataset object against the schema on disk.
 * Throws (and halts the build) if the data is structurally invalid.
 * This is a build-time gate, not a documentation suggestion -- a malformed
 * record cannot reach dist/ no matter what generated or wrote it.
 *
 * The dataset is now assembled in build.js by merging data/shared.json
 * (regulations + branches) with every data/subjects-*.json file, so this takes
 * the merged object directly rather than reading a single data file itself.
 */
export function validateData(schemaPath, data) {
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));

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
