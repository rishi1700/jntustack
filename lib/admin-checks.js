import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { getAskConfig, getContentSource, getDbConfig, getAdminConfig } from './config.js';
import { getDbPool, testDbConnection, describeDbError } from './db.js';
import { loadContent } from './content-store/index.js';

function listMigrationFiles(root) {
  const dir = path.join(root, 'migrations');
  if (!fsSync.existsSync(dir)) return [];
  return fsSync.readdirSync(dir)
    .filter(file => /^\d+.*\.sql$/.test(file))
    .sort();
}

function statusCounts(subjects) {
  return subjects.reduce((acc, subject) => {
    const status = subject.source?.status || 'missing';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
}

async function checkStorage(root) {
  const storagePath = path.join(root, 'storage', 'source-assets');
  try {
    await fs.mkdir(storagePath, { recursive: true });
    await fs.access(storagePath, fsSync.constants.R_OK | fsSync.constants.W_OK);
    return { ok: true, path: path.relative(root, storagePath) || '.', message: 'readable and writable' };
  } catch (err) {
    return {
      ok: false,
      path: path.relative(root, storagePath) || '.',
      message: err?.code === 'ENOENT' ? 'path is missing' : 'not readable/writable',
      code: err?.code,
    };
  }
}

function sanitizeDbError(error) {
  if (!error) return null;
  const summary = describeDbError(error);
  const messageByCode = {
    ER_ACCESS_DENIED_ERROR: 'Access denied for the configured database user. Check DB credentials and database remote-access rules.',
    ECONNREFUSED: 'Database host refused the connection. Check DB_HOST and DB_PORT.',
    ENOTFOUND: 'Database host could not be resolved. Check DB_HOST.',
    ETIMEDOUT: 'Database connection timed out. Check DB_HOST, DB_PORT, and firewall/remote access.',
  };
  return {
    name: summary.name,
    code: summary.code,
    errno: summary.errno,
    sqlState: summary.sqlState,
    message: messageByCode[summary.code] || 'Database check failed. Review DB credentials, host, port, and access rules.',
  };
}

async function readSearchIndex(root) {
  const filePath = path.join(root, 'dist', 'search-index.json');
  try {
    const docs = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    const byType = docs.reduce((acc, doc) => {
      const type = doc.type || 'unknown';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});
    return {
      ok: true,
      path: path.relative(root, filePath),
      total: docs.length,
      byType,
    };
  } catch (err) {
    return {
      ok: false,
      path: path.relative(root, filePath),
      message: err?.code === 'ENOENT' ? 'search index is missing' : 'search index could not be read',
      code: err?.code,
    };
  }
}

async function checkDb(root) {
  const db = getDbConfig();
  const migrationFiles = listMigrationFiles(root);
  const base = {
    configured: db.configured,
    missing: db.missing,
    expectedMigrations: migrationFiles.length,
    appliedMigrations: null,
    pendingMigrations: null,
    ok: false,
    skipped: !db.configured,
  };

  if (!db.configured) {
    return {
      ...base,
      message: `Database env is incomplete. Missing: ${db.missing.join(', ')}`,
    };
  }

  const connection = await testDbConnection({ requireConfigured: true });
  if (!connection.ok) {
    return {
      ...base,
      skipped: false,
      message: 'Database connection failed.',
      error: sanitizeDbError(connection.error),
    };
  }

  try {
    const pool = await getDbPool({ requireConfigured: true });
    const [rows] = await pool.query('SELECT id FROM schema_migrations ORDER BY id');
    const applied = new Set(rows.map(row => row.id));
    const expected = migrationFiles.map(file => file.replace(/\.sql$/, ''));
    const pending = expected.filter(id => !applied.has(id));
    return {
      ...base,
      ok: pending.length === 0,
      skipped: false,
      connected: true,
      appliedMigrations: rows.length,
      pendingMigrations: pending,
      message: pending.length ? `${pending.length} pending migration(s).` : 'connected; migrations current',
    };
  } catch (err) {
    return {
      ...base,
      skipped: false,
      connected: true,
      message: 'Database connected, but migration status could not be read.',
      error: sanitizeDbError(err),
    };
  }
}

export async function getAdminChecks({ root }) {
  const admin = getAdminConfig();
  const ask = getAskConfig();
  const contentSource = getContentSource();

  const [content, db, storage, searchIndex] = await Promise.all([
    loadContent({ root }),
    checkDb(root),
    checkStorage(root),
    readSearchIndex(root),
  ]);

  const countsByStatus = statusCounts(content.data.subjects);
  return {
    generatedAt: new Date().toISOString(),
    runtime: {
      contentSource,
      adminEnabled: admin.enabled,
      adminConfigured: Boolean(admin.email && (admin.passwordHash || admin.password)),
      askEnabled: ask.enabled,
      nodeVersion: process.version,
    },
    db,
    storage,
    content: {
      source: content.source,
      subjectsTotal: content.data.subjects.length,
      subjectsVerified: countsByStatus.verified || 0,
      subjectsNeedsVerification: countsByStatus.needs_verification || 0,
      subjectsPlaceholder: countsByStatus.placeholder || 0,
      collegesTotal: content.colleges.length,
      branchProfilesTotal: content.branchProfiles.length,
    },
    searchIndex,
  };
}
