import mysql from 'mysql2/promise';
import { getRuntimeConfig } from './config.js';

let pool = null;

export class DatabaseConfigError extends Error {
  constructor(message, missing = []) {
    super(message);
    this.name = 'DatabaseConfigError';
    this.missing = missing;
  }
}

export function describeDbError(err) {
  return {
    name: err?.name || 'Error',
    code: err?.code,
    errno: err?.errno,
    sqlState: err?.sqlState,
    message: err?.message || String(err),
  };
}

function dbConfigForUse({ requireConfigured = false } = {}) {
  const runtime = getRuntimeConfig();
  const db = runtime.db;

  if (!db.configured) {
    if (requireConfigured || runtime.contentSource === 'db') {
      throw new DatabaseConfigError(
        `Database configuration is incomplete. Missing: ${db.missing.join(', ')}`,
        db.missing
      );
    }
    return null;
  }

  return db;
}

export function isDbConfigured() {
  return getRuntimeConfig().db.configured;
}

export async function getDbPool(options = {}) {
  const db = dbConfigForUse(options);
  if (!db) return null;
  if (pool) return pool;

  pool = mysql.createPool({
    host: db.host,
    user: db.user,
    password: db.password,
    database: db.database,
    port: db.port,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    charset: 'utf8mb4',
    timezone: 'Z',
  });

  return pool;
}

export async function testDbConnection(options = {}) {
  const dbPool = await getDbPool(options);
  if (!dbPool) {
    return { ok: false, skipped: true, reason: 'Database env is not configured and CONTENT_SOURCE=json.' };
  }

  try {
    const [rows] = await dbPool.query('SELECT 1 AS ok');
    return { ok: rows?.[0]?.ok === 1 };
  } catch (err) {
    return { ok: false, error: describeDbError(err) };
  }
}

export async function closeDbPool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
