import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDbPool, describeDbError, getDbPool } from '../lib/db.js';
import { exportDbContent, importJsonContent, loadJsonContent, parityReport } from '../lib/db-json.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = path.join(ROOT, 'data');

function printSetupHelp() {
  console.error('');
  console.error('MySQL is required for this command.');
  console.error('Set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, and optionally DB_PORT.');
  console.error('Then run: npm run db:migrate');
}

function parseArgs(argv) {
  const options = {
    verify: false,
    subjects: false,
    colleges: false,
    branchProfiles: false,
    guides: false,
    file: null,
    queryTimeoutMs: undefined,
  };

  for (const arg of argv) {
    if (arg === '--verify') options.verify = true;
    else if (arg === '--subjects') options.subjects = true;
    else if (arg === '--colleges') options.colleges = true;
    else if (arg === '--branch-profiles') options.branchProfiles = true;
    else if (arg === '--guides') options.guides = true;
    else if (arg.startsWith('--file=')) options.file = arg.slice('--file='.length);
    else if (arg.startsWith('--query-timeout-ms=')) options.queryTimeoutMs = Number(arg.slice('--query-timeout-ms='.length));
    else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function printImportSummary(result) {
  console.log('Imported JSON content into MySQL');
  console.log('--------------------------------');
  console.log(`Scope           : ${result.scope}${result.file ? ` (${result.file})` : ''}`);
  console.log(`Universities    : ${result.universities}`);
  console.log(`Regulations     : ${result.regulations}`);
  console.log(`Branches        : ${result.branches}`);
  console.log(`Subjects        : ${result.subjects}`);
  console.log(`Colleges        : ${result.colleges}`);
  console.log(`Branch profiles : ${result.branchProfiles}`);
  console.log(`Guides          : ${result.guides}`);
  console.log(`Sources touched : ${result.sourcesTouched}`);
  console.log(`Last phase      : ${result.lastCompletedPhase || 'none'}`);
}

function printParityReport(report) {
  console.log('');
  console.log('DB parity verification');
  console.log('----------------------');
  console.log(`JSON counts: ${JSON.stringify(report.counts.json)}`);
  console.log(`DB counts  : ${JSON.stringify(report.counts.db)}`);
  for (const check of report.checks) {
    console.log(`${check.ok ? 'ok  ' : 'FAIL'} ${check.name}${check.details ? ` (${check.details})` : ''}`);
  }
}

let lastImportResult = null;

try {
  const options = parseArgs(process.argv.slice(2));
  const pool = await getDbPool({ requireConfigured: true });
  const conn = await pool.getConnection();
  try {
    lastImportResult = await importJsonContent(conn, DATA_DIR, {
      subjects: options.subjects,
      colleges: options.colleges,
      branchProfiles: options.branchProfiles,
      guides: options.guides,
      file: options.file,
      queryTimeoutMs: options.queryTimeoutMs,
      logger: message => console.log(`[db:import-json] ${message}`),
    });
    printImportSummary(lastImportResult);
  } finally {
    conn.release();
  }

  if (options.verify) {
    const jsonContent = loadJsonContent(DATA_DIR);
    const dbContent = await exportDbContent(pool);
    const report = parityReport(jsonContent, dbContent);
    printParityReport(report);
    if (!report.ok) {
      process.exitCode = 1;
    }
  }
} catch (err) {
  console.error('JSON import failed:', JSON.stringify(describeDbError(err), null, 2));
  if (err?.currentPhase || err?.importPhase || err?.lastCompletedPhase || lastImportResult?.lastCompletedPhase) {
    console.error(`Import phase: ${err?.currentPhase || err?.importPhase || 'unknown'}`);
    console.error(`Last completed phase: ${err?.lastCompletedPhase || lastImportResult?.lastCompletedPhase || 'none'}`);
  }
  if (err?.name === 'DatabaseConfigError' || err?.code === 'ER_NO_SUCH_TABLE' || err?.code === 'ER_BAD_FIELD_ERROR') {
    printSetupHelp();
  }
  process.exitCode = 1;
} finally {
  await closeDbPool();
}
