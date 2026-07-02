import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDbPool, describeDbError, getDbPool } from '../lib/db.js';
import { exportDbContent, writeExportedJson } from '../lib/db-json.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_OUT = path.join(ROOT, 'tmp', 'db-export');
const outDir = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_OUT;

function printSetupHelp() {
  console.error('');
  console.error('MySQL is required for this command.');
  console.error('Set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, and optionally DB_PORT.');
  console.error('Then run: npm run db:migrate && npm run db:import-json');
}

try {
  const pool = await getDbPool({ requireConfigured: true });
  const content = await exportDbContent(pool);
  fs.rmSync(outDir, { recursive: true, force: true });
  const dataDir = writeExportedJson(content, outDir);
  console.log('Exported MySQL content to JSON-compatible files');
  console.log('------------------------------------------------');
  console.log(`Output directory : ${dataDir}`);
  console.log(`Subjects         : ${content.subjects.length}`);
  console.log(`Colleges         : ${content.colleges.length}`);
  console.log(`Branch profiles  : ${content.branchProfiles.length}`);
} catch (err) {
  console.error('DB export failed:', JSON.stringify(describeDbError(err), null, 2));
  if (err?.name === 'DatabaseConfigError' || err?.code === 'ER_NO_SUCH_TABLE' || err?.code === 'ER_BAD_FIELD_ERROR') {
    printSetupHelp();
  }
  process.exitCode = 1;
} finally {
  await closeDbPool();
}
