import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDbPool, describeDbError, getDbPool, testDbConnection } from '../lib/db.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MIGRATIONS_DIR = path.join(ROOT, 'migrations');

const MIGRATIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id VARCHAR(255) PRIMARY KEY,
  checksum CHAR(64) NOT NULL,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const MIGRATION_STEPS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migration_steps (
  migration_id VARCHAR(255) NOT NULL,
  step_index INT UNSIGNED NOT NULL,
  statement_checksum CHAR(64) NOT NULL,
  status ENUM('running', 'applied', 'failed') NOT NULL,
  last_error TEXT NULL,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  applied_at TIMESTAMP NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (migration_id, step_index),
  KEY idx_schema_migration_steps_status (status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

function usage() {
  console.log('Usage: node scripts/db.js <migrate|status>');
}

function printSetupHelp() {
  console.error('');
  console.error('MySQL is required for this command.');
  console.error('Set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, and optionally DB_PORT.');
}

function checksum(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function listMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(file => /^\d+.*\.sql$/.test(file))
    .sort()
    .map(file => {
      const fullPath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(fullPath, 'utf-8');
      return {
        id: file.replace(/\.sql$/, ''),
        file,
        fullPath,
        sql,
        checksum: checksum(sql),
      };
    });
}

function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let quote = null;
  let escaped = false;

  for (const ch of sql) {
    current += ch;

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '\'' || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }

    if (ch === ';') {
      const statement = current.slice(0, -1).trim();
      if (statement) statements.push(statement);
      current = '';
    }
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

async function ensureMigrationsTable(pool) {
  await pool.query(MIGRATIONS_TABLE_SQL);
  await pool.query(MIGRATION_STEPS_TABLE_SQL);
}

async function loadApplied(pool) {
  const [rows] = await pool.query('SELECT id, checksum, applied_at FROM schema_migrations ORDER BY id');
  return new Map(rows.map(row => [row.id, row]));
}

async function status() {
  const connection = await testDbConnection({ requireConfigured: true });
  if (!connection.ok) {
    console.error('Database connection failed:', JSON.stringify(connection.error || connection, null, 2));
    process.exitCode = 1;
    return;
  }

  const pool = await getDbPool({ requireConfigured: true });
  await ensureMigrationsTable(pool);
  const applied = await loadApplied(pool);
  const migrations = listMigrations();
  const [stepRows] = await pool.query(
    `SELECT migration_id, step_index, status
     FROM schema_migration_steps
     ORDER BY migration_id, step_index`
  );
  const stepsByMigration = new Map();
  for (const step of stepRows) {
    if (!stepsByMigration.has(step.migration_id)) stepsByMigration.set(step.migration_id, []);
    stepsByMigration.get(step.migration_id).push(step);
  }

  console.log('Database status');
  console.log('---------------');
  console.log(`Migrations found   : ${migrations.length}`);
  console.log(`Migrations applied : ${applied.size}`);

  for (const migration of migrations) {
    const row = applied.get(migration.id);
    const partialSteps = stepsByMigration.get(migration.id) || [];
    const state = !row && partialSteps.length
      ? `partial (${partialSteps.filter(step => step.status === 'applied').length}/${splitSqlStatements(migration.sql).length}; ${partialSteps.at(-1).status})`
      : !row
        ? 'pending'
      : row.checksum === migration.checksum
        ? 'applied'
        : 'checksum mismatch';
    console.log(`${state.padEnd(18)} ${migration.file}`);
  }
}

async function migrate() {
  const pool = await getDbPool({ requireConfigured: true });
  const connection = await pool.getConnection();
  let lockAcquired = false;
  let reusable = true;
  try {
    let lockRows;
    try {
      [lockRows] = await connection.query(
        `SELECT GET_LOCK('jntustack:schema-migrations', 15) AS acquired`
      );
    } catch (error) {
      // MySQL may have granted the session lock even if the response was lost.
      reusable = false;
      throw error;
    }
    if (Number(lockRows?.[0]?.acquired) !== 1) {
      throw new Error('Another schema migration process is already running.');
    }
    lockAcquired = true;
    await ensureMigrationsTable(connection);
    const applied = await loadApplied(connection);
    const migrations = listMigrations();
    let ran = 0;

    for (const migration of migrations) {
      const row = applied.get(migration.id);
      if (row) {
        if (row.checksum !== migration.checksum) {
          throw new Error(`Migration checksum changed after apply: ${migration.file}`);
        }
        continue;
      }

      console.log(`Applying ${migration.file}`);
      const statements = splitSqlStatements(migration.sql);
      for (let index = 0; index < statements.length; index++) {
        const statement = statements[index];
        const statementChecksum = checksum(statement);
        const [existingRows] = await connection.query(
          `SELECT statement_checksum, status
           FROM schema_migration_steps
           WHERE migration_id = ? AND step_index = ?
           LIMIT 1`,
          [migration.id, index + 1]
        );
        const existing = existingRows[0];
        if (existing) {
          if (existing.statement_checksum !== statementChecksum) {
            throw new Error(`Migration step checksum changed: ${migration.file} step ${index + 1}.`);
          }
          if (existing.status === 'applied') continue;
          throw new Error(
            `Migration ${migration.file} step ${index + 1} is ${existing.status} and its DDL outcome is uncertain. `
            + 'Follow the migration recovery runbook before retrying.'
          );
        }

        await connection.query(
          `INSERT INTO schema_migration_steps
            (migration_id, step_index, statement_checksum, status)
           VALUES (?, ?, ?, 'running')`,
          [migration.id, index + 1, statementChecksum]
        );
        try {
          await connection.query(statement);
          await connection.query(
            `UPDATE schema_migration_steps
             SET status = 'applied', applied_at = CURRENT_TIMESTAMP, last_error = NULL
             WHERE migration_id = ? AND step_index = ?`,
            [migration.id, index + 1]
          );
        } catch (error) {
          await connection.query(
            `UPDATE schema_migration_steps
             SET status = 'failed', last_error = ?
             WHERE migration_id = ? AND step_index = ?`,
            [String(error?.message || error).slice(0, 4000), migration.id, index + 1]
          ).catch(() => {});
          throw error;
        }
      }
      await connection.query(
        'INSERT INTO schema_migrations (id, checksum) VALUES (?, ?)',
        [migration.id, migration.checksum]
      );
      ran++;
    }

    console.log(ran === 0 ? 'No pending migrations.' : `Applied ${ran} migration(s).`);
  } finally {
    if (lockAcquired) {
      try {
        const [releaseRows] = await connection.query(
          `SELECT RELEASE_LOCK('jntustack:schema-migrations') AS released`
        );
        reusable = Number(releaseRows?.[0]?.released) === 1;
      } catch {
        reusable = false;
      }
    }
    if (reusable) connection.release();
    else connection.destroy();
  }
}

async function main() {
  const command = process.argv[2];
  if (!['migrate', 'status'].includes(command)) {
    usage();
    process.exitCode = 1;
    return;
  }

  try {
    if (command === 'status') await status();
    if (command === 'migrate') await migrate();
  } catch (err) {
    console.error('Database command failed:', JSON.stringify(describeDbError(err), null, 2));
    if (err?.name === 'DatabaseConfigError') printSetupHelp();
    process.exitCode = 1;
  } finally {
    await closeDbPool();
  }
}

main();
