import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDbPool, describeDbError, getDbPool } from '../lib/db.js';
import { importJsonContent } from '../lib/db-json.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = path.join(ROOT, 'data');

function printSetupHelp() {
  console.error('');
  console.error('MySQL is required for this command.');
  console.error('Set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, and optionally DB_PORT.');
  console.error('Then run: npm run db:migrate');
}

try {
  const pool = await getDbPool({ requireConfigured: true });
  const conn = await pool.getConnection();
  try {
    const result = await importJsonContent(conn, DATA_DIR);
    console.log('Imported JSON content into MySQL');
    console.log('--------------------------------');
    console.log(`Universities    : ${result.universities}`);
    console.log(`Regulations     : ${result.regulations}`);
    console.log(`Branches        : ${result.branches}`);
    console.log(`Subjects        : ${result.subjects}`);
    console.log(`Colleges        : ${result.colleges}`);
    console.log(`Branch profiles : ${result.branchProfiles}`);
  } finally {
    conn.release();
  }
} catch (err) {
  console.error('JSON import failed:', JSON.stringify(describeDbError(err), null, 2));
  if (err?.name === 'DatabaseConfigError' || err?.code === 'ER_NO_SUCH_TABLE' || err?.code === 'ER_BAD_FIELD_ERROR') {
    printSetupHelp();
  }
  process.exitCode = 1;
} finally {
  await closeDbPool();
}
