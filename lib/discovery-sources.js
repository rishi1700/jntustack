import { describeDbError, getDbPool } from './db.js';

export const SOURCE_KINDS = [
  'university_official',
  'college_official',
  'exam_portal',
  'syllabus_repository',
  'other',
];

export const TRUST_LEVELS = [
  'official',
  'affiliated',
  'supplemental',
  'unknown',
];

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBool(value) {
  return value === true || value === 'true' || value === '1' || value === 'on' || value === 1;
}

function normalizeId(value) {
  const raw = clean(value);
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('IDs must be positive integers when provided.');
  }
  return parsed;
}

function normalizeUrl(value) {
  const raw = clean(value);
  if (!raw) throw new Error('Base URL is required.');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Base URL must be a valid URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Base URL must use http or https.');
  }
  return parsed.href;
}

function sourceFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    sourceKey: row.source_key,
    name: row.name,
    baseUrl: row.base_url,
    universityId: row.university_id,
    universityCode: row.university_code,
    branchId: row.branch_id,
    branchCode: row.branch_code,
    sourceKind: row.source_kind,
    trustLevel: row.trust_level,
    enabled: Boolean(row.enabled),
    crawlEnabled: Boolean(row.crawl_enabled),
    parserKey: row.parser_key,
    notes: row.notes,
    lastCheckedAt: row.last_checked_at,
    lastSuccessAt: row.last_success_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function runFromRow(row) {
  return {
    id: row.id,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    itemsDiscovered: row.items_discovered,
    assetsCreated: row.assets_created,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

function normalizeSourceInput(input = {}) {
  const sourceKey = clean(input.source_key || input.sourceKey);
  const name = clean(input.name);
  const sourceKind = clean(input.source_kind || input.sourceKind) || 'other';
  const trustLevel = clean(input.trust_level || input.trustLevel) || 'unknown';

  if (!sourceKey) throw new Error('Source key is required.');
  if (!/^[a-z0-9][a-z0-9-]{1,126}[a-z0-9]$/.test(sourceKey)) {
    throw new Error('Source key must be lowercase letters, numbers, and hyphens.');
  }
  if (!name) throw new Error('Name is required.');
  if (!SOURCE_KINDS.includes(sourceKind)) {
    throw new Error(`Unsupported source kind: ${sourceKind}`);
  }
  if (!TRUST_LEVELS.includes(trustLevel)) {
    throw new Error(`Unsupported trust level: ${trustLevel}`);
  }

  return {
    sourceKey,
    name,
    baseUrl: normalizeUrl(input.base_url || input.baseUrl),
    universityId: normalizeId(input.university_id || input.universityId),
    branchId: normalizeId(input.branch_id || input.branchId),
    sourceKind,
    trustLevel,
    enabled: normalizeBool(input.enabled),
    crawlEnabled: normalizeBool(input.crawl_enabled || input.crawlEnabled),
    parserKey: clean(input.parser_key || input.parserKey) || null,
    notes: clean(input.notes) || null,
  };
}

export async function listDiscoverySources({ limit = 200 } = {}) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute(
    `SELECT ds.*, u.code AS university_code, b.code AS branch_code
     FROM discovery_sources ds
     LEFT JOIN universities u ON u.id = ds.university_id
     LEFT JOIN branches b ON b.id = ds.branch_id
     ORDER BY ds.enabled DESC, ds.name
     LIMIT ?`,
    [limit]
  );
  return rows.map(sourceFromRow);
}

export async function getDiscoverySource(id) {
  const pool = await getDbPool({ requireConfigured: true });
  const [rows] = await pool.execute(
    `SELECT ds.*, u.code AS university_code, b.code AS branch_code
     FROM discovery_sources ds
     LEFT JOIN universities u ON u.id = ds.university_id
     LEFT JOIN branches b ON b.id = ds.branch_id
     WHERE ds.id = ?`,
    [id]
  );
  const source = sourceFromRow(rows[0]);
  if (!source) return null;

  const [runs] = await pool.execute(
    `SELECT id, status, started_at, finished_at, items_discovered, assets_created, error_message, created_at
     FROM crawl_runs
     WHERE discovery_source_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 25`,
    [id]
  );
  return { ...source, crawlRuns: runs.map(runFromRow) };
}

export async function createDiscoverySource({ input, actor = null }) {
  const values = normalizeSourceInput(input);
  const pool = await getDbPool({ requireConfigured: true });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      `INSERT INTO discovery_sources
        (source_key, name, base_url, university_id, branch_id, source_kind, trust_level,
         enabled, crawl_enabled, parser_key, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        values.sourceKey,
        values.name,
        values.baseUrl,
        values.universityId,
        values.branchId,
        values.sourceKind,
        values.trustLevel,
        values.enabled ? 1 : 0,
        values.crawlEnabled ? 1 : 0,
        values.parserKey,
        values.notes,
      ]
    );
    const id = result.insertId;
    const [afterRows] = await conn.execute('SELECT * FROM discovery_sources WHERE id = ?', [id]);
    await conn.execute(
      `INSERT INTO audit_log
        (actor, action, entity_type, entity_id, before_json, after_json)
       VALUES (?, 'discovery_source.create', 'discovery_source', ?, NULL, ?)`,
      [actor, String(id), JSON.stringify(afterRows[0])]
    );
    await conn.commit();
    return id;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function updateDiscoverySource({ id, input, actor = null }) {
  const values = normalizeSourceInput(input);
  const pool = await getDbPool({ requireConfigured: true });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [beforeRows] = await conn.execute('SELECT * FROM discovery_sources WHERE id = ? FOR UPDATE', [id]);
    const before = beforeRows[0];
    if (!before) throw new Error(`Discovery source not found: ${id}`);

    await conn.execute(
      `UPDATE discovery_sources
       SET source_key = ?, name = ?, base_url = ?, university_id = ?, branch_id = ?,
           source_kind = ?, trust_level = ?, enabled = ?, crawl_enabled = ?,
           parser_key = ?, notes = ?
       WHERE id = ?`,
      [
        values.sourceKey,
        values.name,
        values.baseUrl,
        values.universityId,
        values.branchId,
        values.sourceKind,
        values.trustLevel,
        values.enabled ? 1 : 0,
        values.crawlEnabled ? 1 : 0,
        values.parserKey,
        values.notes,
        id,
      ]
    );

    const [afterRows] = await conn.execute('SELECT * FROM discovery_sources WHERE id = ?', [id]);
    await conn.execute(
      `INSERT INTO audit_log
        (actor, action, entity_type, entity_id, before_json, after_json)
       VALUES (?, 'discovery_source.update', 'discovery_source', ?, ?, ?)`,
      [actor, String(id), JSON.stringify(before), JSON.stringify(afterRows[0])]
    );
    await conn.commit();
    return sourceFromRow(afterRows[0]);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function setDiscoverySourceEnabled({ id, enabled, note = '', actor = null }) {
  const nextEnabled = normalizeBool(enabled);
  const cleanNote = clean(note);
  if (!nextEnabled && !cleanNote) {
    throw new Error('A reviewer note is required when disabling a source.');
  }
  const pool = await getDbPool({ requireConfigured: true });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [beforeRows] = await conn.execute('SELECT * FROM discovery_sources WHERE id = ? FOR UPDATE', [id]);
    const before = beforeRows[0];
    if (!before) throw new Error(`Discovery source not found: ${id}`);

    await conn.execute('UPDATE discovery_sources SET enabled = ? WHERE id = ?', [nextEnabled ? 1 : 0, id]);
    const [afterRows] = await conn.execute('SELECT * FROM discovery_sources WHERE id = ?', [id]);
    await conn.execute(
      `INSERT INTO audit_log
        (actor, action, entity_type, entity_id, before_json, after_json)
       VALUES (?, ?, 'discovery_source', ?, ?, ?)`,
      [
        actor,
        nextEnabled ? 'discovery_source.enable' : 'discovery_source.disable',
        String(id),
        JSON.stringify(before),
        JSON.stringify({ source: afterRows[0], reviewer_note: cleanNote || null }),
      ]
    );
    await conn.commit();
    return sourceFromRow(afterRows[0]);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export function discoverySourceErrorSummary(err) {
  const safe = describeDbError(err);
  if (err?.name === 'DatabaseConfigError') {
    return 'Source management requires MySQL configuration. Set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, and run migrations.';
  }
  if (safe.code === 'ER_NO_SUCH_TABLE' || safe.code === 'ER_BAD_FIELD_ERROR') {
    return 'Source management tables are missing or out of date. Run npm run db:migrate.';
  }
  if (safe.code === 'ER_DUP_ENTRY') {
    return 'A source with that key already exists.';
  }
  if (safe.code === 'ER_NO_REFERENCED_ROW_2') {
    return 'Referenced university or branch ID does not exist.';
  }
  return `${safe.code ? `${safe.code}: ` : ''}${safe.message}`;
}
