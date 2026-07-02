import 'dotenv/config';

const VALID_CONTENT_SOURCES = new Set(['json', 'db']);

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parsePort(value) {
  const raw = clean(value);
  if (!raw) return 3306;
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid DB_PORT "${raw}". Expected a TCP port number.`);
  }
  return port;
}

export function getContentSource(env = process.env) {
  const requested = clean(env.CONTENT_SOURCE).toLowerCase() || 'json';
  if (!VALID_CONTENT_SOURCES.has(requested)) {
    throw new Error(`Invalid CONTENT_SOURCE "${requested}". Expected "json" or "db".`);
  }
  return requested;
}

export function getDbConfig(env = process.env) {
  const config = {
    host: clean(env.DB_HOST),
    user: clean(env.DB_USER),
    password: clean(env.DB_PASSWORD),
    database: clean(env.DB_NAME),
    port: parsePort(env.DB_PORT),
  };

  const required = {
    DB_HOST: config.host,
    DB_USER: config.user,
    DB_PASSWORD: config.password,
    DB_NAME: config.database,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  return {
    ...config,
    configured: missing.length === 0,
    missing,
  };
}

export function getRuntimeConfig(env = process.env) {
  return {
    contentSource: getContentSource(env),
    db: getDbConfig(env),
  };
}

export function getAdminConfig(env = process.env) {
  const enabled = clean(env.ADMIN_ENABLED).toLowerCase() === 'true';
  return {
    enabled,
    email: clean(env.ADMIN_EMAIL),
    passwordHash: clean(env.ADMIN_PASSWORD_HASH),
    password: clean(env.ADMIN_PASSWORD),
    sessionSecret: clean(env.ADMIN_SESSION_SECRET),
  };
}
