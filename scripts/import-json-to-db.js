import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDbPool, describeDbError, getDbPool } from '../lib/db.js';
import {
  AUTHORITATIVE_PRUNE_CONFIRMATION,
  createAuthoritativePruneRequestId,
  exportDbContent,
  importJsonContent,
  loadJsonContent,
  normalizeImportOptions,
  parityReport,
} from '../lib/db-json.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = path.join(ROOT, 'data');

function printSetupHelp() {
  console.error('');
  console.error('MySQL is required for this command.');
  console.error('Set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, and optionally DB_PORT.');
  console.error('Then run: npm run db:migrate');
}

function printUsage() {
  console.log(`Usage: npm run db:import-json -- [options]

Imports the repository JSON mirror into MySQL. Existing rows are upserted and,
by default, rows absent from JSON are never deleted.

Scope and verification:
  --verify                 Verify JSON/DB parity after the import
  --subjects               Import only subjects
  --colleges               Import only colleges
  --branch-profiles        Import only branch profiles
  --guides                 Import only guides
  --file=data/<file>.json  Import one matching scoped JSON file
  --query-timeout-ms=<ms>  Override the per-query timeout

Authoritative pruning (full dataset only):
  --prune-dry-run          Read-only report of obsolete/missing mirror rows
  --prune                  Full import, then audit and delete obsolete mirror rows
  --confirm-prune=${AUTHORITATIVE_PRUNE_CONFIRMATION}:<sha256>
                           Required exact token printed by --prune-dry-run
  --prune-request-id=<uuid>
                           Optional unique request ID; generated when omitted

Pruning cannot be combined with --file or partial scope selectors. Run the
dry-run first, review every obsolete key and reference blocker, and paste its
plan-bound token unchanged. Any JSON or database plan drift invalidates it.

  --help                   Show this help`);
}

function parseArgs(argv) {
  const options = {
    help: false,
    verify: false,
    subjects: false,
    colleges: false,
    branchProfiles: false,
    guides: false,
    pruneDryRun: false,
    prune: false,
    pruneConfirmation: null,
    pruneRequestId: null,
    file: null,
    queryTimeoutMs: undefined,
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--verify') options.verify = true;
    else if (arg === '--subjects') options.subjects = true;
    else if (arg === '--colleges') options.colleges = true;
    else if (arg === '--branch-profiles') options.branchProfiles = true;
    else if (arg === '--guides') options.guides = true;
    else if (arg === '--prune-dry-run') options.pruneDryRun = true;
    else if (arg === '--prune') options.prune = true;
    else if (arg.startsWith('--confirm-prune=')) options.pruneConfirmation = arg.slice('--confirm-prune='.length);
    else if (arg.startsWith('--prune-request-id=')) options.pruneRequestId = arg.slice('--prune-request-id='.length);
    else if (arg.startsWith('--file=')) options.file = arg.slice('--file='.length);
    else if (arg.startsWith('--query-timeout-ms=')) options.queryTimeoutMs = Number(arg.slice('--query-timeout-ms='.length));
    else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function printImportSummary(result) {
  const dryRun = result.prune?.mode === 'dry-run';
  console.log(dryRun ? 'Inspected authoritative JSON pruning state' : 'Imported JSON content into MySQL');
  console.log(dryRun ? '------------------------------------------' : '--------------------------------');
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

function printPruneReport(report) {
  if (!report) return;
  console.log('');
  console.log(`Authoritative prune ${report.mode === 'dry-run' ? 'dry-run report' : 'result'}`);
  console.log('----------------------------------');
  for (const entity of report.entities) {
    console.log(
      `${entity.entityType.padEnd(16)} authoritative=${entity.authoritativeCount} current=${entity.currentCount} ` +
      `obsolete=${entity.obsoleteCount} missing=${entity.missingCount} deleted=${entity.deletedCount}`
    );
    if (entity.obsoleteKeys.length) {
      console.log(`  obsolete: ${entity.obsoleteKeys.join(', ')}`);
    }
    if (entity.missingKeys.length) {
      console.log(`  missing : ${entity.missingKeys.join(', ')}`);
    }
    for (const blocker of entity.referenceBlockers) {
      console.log(
        `  BLOCKED : ${blocker.count} row(s) in ${blocker.referencingTable}.${blocker.referencingColumn} ` +
        `(${blocker.referencingIds.join(', ')})`
      );
    }
  }
  console.log(`Totals: ${JSON.stringify(report.totals)}`);
  console.log(`Plan digest       : ${report.planDigest}`);
  console.log(`Confirmation token: ${report.confirmationToken}`);
  if (report.requestId) console.log(`Prune request ID  : ${report.requestId}`);
  if (report.commitEvidence) {
    console.log(`Commit evidence   : ${report.commitEvidence.action}`);
  }
  if (report.mode === 'dry-run') {
    console.log('Dry-run only: no content or audit rows were written.');
  }
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
  if (options.help) {
    printUsage();
  } else {
    if (options.prune && !options.pruneRequestId) {
      options.pruneRequestId = createAuthoritativePruneRequestId();
    }
    normalizeImportOptions({
      subjects: options.subjects,
      colleges: options.colleges,
      branchProfiles: options.branchProfiles,
      guides: options.guides,
      pruneDryRun: options.pruneDryRun,
      prune: options.prune,
      pruneConfirmation: options.pruneConfirmation,
      pruneRequestId: options.pruneRequestId,
      file: options.file,
      queryTimeoutMs: options.queryTimeoutMs,
    });
    const pool = await getDbPool({ requireConfigured: true });
    const conn = await pool.getConnection();
    let discardConnection = false;
    try {
      lastImportResult = await importJsonContent(conn, DATA_DIR, {
        subjects: options.subjects,
        colleges: options.colleges,
        branchProfiles: options.branchProfiles,
        guides: options.guides,
        pruneDryRun: options.pruneDryRun,
        prune: options.prune,
        pruneConfirmation: options.pruneConfirmation,
        pruneRequestId: options.pruneRequestId,
        file: options.file,
        queryTimeoutMs: options.queryTimeoutMs,
        logger: message => console.log(`[db:import-json] ${message}`),
      });
      printImportSummary(lastImportResult);
      printPruneReport(lastImportResult.prune);
    } catch (err) {
      discardConnection = (
        err?.connectionMustBeDiscarded === true ||
        (
          err?.reconciliationRequired === true &&
          (
            err?.commitOutcome === 'unknown' ||
            err?.rollbackOutcome === 'unknown' ||
            err?.transactionOutcome === 'unknown'
          )
        )
      );
      if (discardConnection) {
        try {
          await conn.destroy?.();
        } catch {
          // Never release a connection whose transaction outcome is unknown.
        }
      }
      throw err;
    } finally {
      if (!discardConnection) conn.release();
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
  }
} catch (err) {
  const outcomeUnknown = (
    err?.reconciliationRequired === true &&
    (
      err?.commitOutcome === 'unknown' ||
      err?.rollbackOutcome === 'unknown' ||
      err?.transactionOutcome === 'unknown'
    )
  );
  if (outcomeUnknown) {
    console.error(
      err?.rollbackOutcome === 'unknown'
        ? 'Database ROLLBACK acknowledgement was not received; the outcome is inconclusive and is not classified as failed.'
        : err?.code === 'AUTHORITATIVE_PRUNE_COMMIT_OUTCOME_UNKNOWN'
        ? 'Authoritative prune COMMIT outcome is unknown; it is not classified as failed.'
        : 'JSON import phase COMMIT outcome is unknown; it is not classified as failed.'
    );
    console.error('Reconciliation metadata:', JSON.stringify({
      code: err.code,
      commitOutcome: err.commitOutcome,
      rollbackOutcome: err.rollbackOutcome || null,
      transactionOutcome: err.transactionOutcome || null,
      reconciliationRequired: true,
      pruneRequestId: err.pruneRequestId,
      prunePlanDigest: err.prunePlanDigest,
      pruneConfirmationToken: err.pruneConfirmationToken,
      phase: err.importPhase || err.currentPhase,
      lastCompletedPhase: err.lastCompletedPhase || null,
      originalCode: err.originalCode || null,
      operationCode: err.operationCode || null,
      rollbackCode: err.rollbackCode || null,
    }, null, 2));
    console.error('Use a fresh database connection to look up the exact durable prune commit evidence before retrying.');
    process.exitCode = 2;
  } else {
    console.error('JSON import failed:', JSON.stringify(describeDbError(err), null, 2));
    process.exitCode = 1;
  }
  if (err?.currentPhase || err?.importPhase || err?.lastCompletedPhase || lastImportResult?.lastCompletedPhase) {
    console.error(`Import phase: ${err?.currentPhase || err?.importPhase || 'unknown'}`);
    console.error(`Last completed phase: ${err?.lastCompletedPhase || lastImportResult?.lastCompletedPhase || 'none'}`);
  }
  if (err?.name === 'DatabaseConfigError' || err?.code === 'ER_NO_SUCH_TABLE' || err?.code === 'ER_BAD_FIELD_ERROR') {
    printSetupHelp();
  }
} finally {
  await closeDbPool();
}
