import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDbPool, describeDbError, getDbPool } from '../lib/db.js';
import { exportDbContent, loadJsonContent, parityReport } from '../lib/db-json.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = path.join(ROOT, 'data');

function printSetupHelp() {
  console.error('');
  console.error('MySQL is required for this command.');
  console.error('Set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, and optionally DB_PORT.');
  console.error('Then run: npm run db:migrate && npm run db:import-json');
}

try {
  const pool = await getDbPool({ requireConfigured: true });
  const jsonContent = loadJsonContent(DATA_DIR);
  const dbContent = await exportDbContent(pool);
  const report = parityReport(jsonContent, dbContent);

  console.log('DB parity check');
  console.log('---------------');
  console.log(`JSON counts: ${JSON.stringify(report.counts.json)}`);
  console.log(`DB counts  : ${JSON.stringify(report.counts.db)}`);
  for (const check of report.checks) {
    console.log(`${check.ok ? 'ok  ' : 'FAIL'} ${check.name}${check.details ? ` (${check.details})` : ''}`);
  }

  if (!report.ok) process.exitCode = 1;
} catch (err) {
  console.error('DB parity check failed:', JSON.stringify(describeDbError(err), null, 2));
  if (err?.name === 'DatabaseConfigError' || err?.code === 'ER_NO_SUCH_TABLE' || err?.code === 'ER_BAD_FIELD_ERROR') {
    printSetupHelp();
  }
  process.exitCode = 1;
} finally {
  await closeDbPool();
}
