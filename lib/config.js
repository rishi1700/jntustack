import 'dotenv/config';
import path from 'node:path';

const VALID_CONTENT_SOURCES = new Set(['json', 'db']);
const VALID_CONTENT_PUBLICATION_MODES = new Set(['legacy', 'github_pr']);

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

export function getContentPublicationMode(env = process.env) {
  const requested = clean(env.CONTENT_PUBLICATION_MODE).toLowerCase() || 'github_pr';
  if (!VALID_CONTENT_PUBLICATION_MODES.has(requested)) {
    throw new Error(
      `Invalid CONTENT_PUBLICATION_MODE "${requested}". Expected "legacy" or "github_pr".`
    );
  }
  return requested;
}

export function getGitHubPublicationTrustReady(env = process.env) {
  return clean(env.GITHUB_PUBLICATION_TRUST_READY).toLowerCase() === 'true';
}

export function getAssetStoragePublicationReadiness(env = process.env) {
  const provider = clean(env.ASSET_STORAGE_PROVIDER).toLowerCase() || 'local';

  if (provider === 'local') {
    const storageRoot = clean(env.ASSET_STORAGE_ROOT);
    const expectedStoreId = clean(env.ASSET_STORAGE_EXPECTED_ID);
    const persistenceVerified = clean(env.ASSET_STORAGE_PERSISTENCE_VERIFIED).toLowerCase() === 'true';
    const absoluteRoot = Boolean(storageRoot && path.isAbsolute(storageRoot));
    const validExpectedStoreId = /^[A-Za-z0-9._-]{16,128}$/.test(expectedStoreId);
    return {
      provider,
      ready: absoluteRoot && validExpectedStoreId && persistenceVerified,
      persistenceVerified,
      absoluteRoot,
      validExpectedStoreId,
      missing: [
        ...(!absoluteRoot ? ['ASSET_STORAGE_ROOT'] : []),
        ...(!validExpectedStoreId ? ['ASSET_STORAGE_EXPECTED_ID'] : []),
        ...(!persistenceVerified ? ['ASSET_STORAGE_PERSISTENCE_VERIFIED'] : []),
      ],
    };
  }

  if (provider === 'r2') {
    const required = {
      R2_ACCOUNT_ID: clean(env.R2_ACCOUNT_ID),
      R2_ACCESS_KEY_ID: clean(env.R2_ACCESS_KEY_ID),
      R2_SECRET_ACCESS_KEY: clean(env.R2_SECRET_ACCESS_KEY),
      R2_BUCKET: clean(env.R2_BUCKET || env.R2_BUCKET_NAME),
    };
    const missing = Object.entries(required)
      .filter(([, value]) => !value)
      .map(([key]) => key);
    return {
      provider,
      ready: missing.length === 0,
      persistenceVerified: missing.length === 0,
      absoluteRoot: null,
      validExpectedStoreId: null,
      missing,
    };
  }

  return {
    provider,
    ready: false,
    persistenceVerified: false,
    absoluteRoot: null,
    validExpectedStoreId: null,
    missing: ['ASSET_STORAGE_PROVIDER'],
  };
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
    contentPublicationMode: getContentPublicationMode(env),
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

export function getAdminTestConfig(env = process.env) {
  return {
    enabled: clean(env.ADMIN_TEST_TOOLS).toLowerCase() === 'true',
  };
}

export function getAskConfig(env = process.env) {
  return {
    enabled: clean(env.ASK_ENABLED).toLowerCase() === 'true',
  };
}
