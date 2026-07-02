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

function usage() {
  console.log('Usage: node scripts/db.js <migrate|status>');
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

  console.log('Database status');
  console.log('---------------');
  console.log(`Migrations found   : ${migrations.length}`);
  console.log(`Migrations applied : ${applied.size}`);

  for (const migration of migrations) {
    const row = applied.get(migration.id);
    const state = !row
      ? 'pending'
      : row.checksum === migration.checksum
        ? 'applied'
        : 'checksum mismatch';
    console.log(`${state.padEnd(18)} ${migration.file}`);
  }
}

async function migrate() {
  const pool = await getDbPool({ requireConfigured: true });
  await ensureMigrationsTable(pool);
  const applied = await loadApplied(pool);
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
    for (const statement of statements) {
      await pool.query(statement);
    }
    await pool.query(
      'INSERT INTO schema_migrations (id, checksum) VALUES (?, ?)',
      [migration.id, migration.checksum]
    );
    ran++;
  }

  console.log(ran === 0 ? 'No pending migrations.' : `Applied ${ran} migration(s).`);
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
    process.exitCode = 1;
  } finally {
    await closeDbPool();
  }
}

main();
