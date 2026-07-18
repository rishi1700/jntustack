import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildSearchIndex } from './retrieve.js';
import { loadDataset, loadMergedColleges } from './dataset.js';

export const EXPECTED_PARITY_COUNTS = {
  subjects: 436,
  verifiedSubjects: 436,
  subjectPages: 403,
  listingSubjects: 33,
  colleges: 376,
  branchProfiles: 6,
  guides: 1,
  searchDocs: 786,
};

const REPRESENTATIVE_SUBJECT_SLUGS = [
  'data-warehousing-and-data-mining-jntuk-r23-cse-3-1',
  'computer-networks-jntuk-r23-cse-3-1',
  'environmental-science-jntuk-r23-ce-2-1',
];

const REPRESENTATIVE_BRANCHES = ['CSE', 'ECE', 'MECH'];
const REPRESENTATIVE_COLLEGE_CODES = ['JNTUK', 'JNTUH', 'JNTUA', 'JNTUGV'];

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function checksum(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function json(value) {
  return value == null ? null : JSON.stringify(value);
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  return JSON.parse(value);
}

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function stripNullish(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
}

function sourcePayload(source, sourceType = 'content') {
  if (!source) return null;
  const payload = {
    origin_url: source.origin_url ?? source.source_url ?? null,
    retrieved_date: source.retrieved_date ?? source.last_verified ?? null,
    status: source.status ?? 'verified',
    college_source_note: source.college_source_note ?? null,
    source_type: sourceType,
  };
  if (!payload.origin_url && !payload.retrieved_date && !payload.college_source_note && !payload.status) {
    return null;
  }
  return payload;
}

function sourceFromRow(row, fallbackStatus) {
  return {
    origin_url: row.origin_url ?? null,
    retrieved_date: dateOnly(row.retrieved_at),
    status: fallbackStatus ?? row.source_status ?? 'needs_verification',
    ...(row.caveat_text ? { college_source_note: row.caveat_text } : {}),
  };
}

function collegeStableKey(college) {
  return [
    college.affiliated_to || '',
    college.short_code || '',
    college.name || '',
    college.location?.district || '',
  ].join(':');
}

function campusFileName(code) {
  return `colleges-${String(code).toLowerCase()}.json`;
}

function groupBy(items, keyFn) {
  const grouped = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }
  return grouped;
}

export function loadJsonContent(dataDir) {
  const { data } = loadDataset(dataDir);
  const { colleges, coverageNotes } = loadMergedColleges(dataDir);
  const { branch_profiles: branchProfiles } = JSON.parse(fs.readFileSync(path.join(dataDir, 'branch-guide-data.json'), 'utf-8'));
  return {
    shared: {
      regulations: data.regulations,
      branches: data.branches,
    },
    subjects: data.subjects,
    guides: data.guides || [],
    colleges,
    coverageNotes,
    branchProfiles,
  };
}

function cleanRelativeDataFile(file) {
  if (!file) return null;
  const normalized = String(file).replaceAll('\\', '/').replace(/^\.?\//, '');
  if (!normalized.startsWith('data/')) {
    throw new Error('--file must point to a data/ JSON file.');
  }
  if (normalized.includes('..')) {
    throw new Error('--file must not contain parent directory segments.');
  }
  return normalized;
}

function loadScopedContent(dataDir, { file = null } = {}) {
  const content = loadJsonContent(dataDir);
  const relativeFile = cleanRelativeDataFile(file);
  if (!relativeFile) return content;

  const absolute = path.join(path.dirname(dataDir), relativeFile);
  const basename = path.basename(relativeFile);
  const document = JSON.parse(fs.readFileSync(absolute, 'utf-8'));

  if (/^subjects-.*\.json$/.test(basename)) {
    return { ...content, subjects: document.subjects || [] };
  }
  if (/^colleges-.*\.json$/.test(basename)) {
    return { ...content, colleges: document.colleges || [] };
  }
  if (basename === 'branch-guide-data.json') {
    return { ...content, branchProfiles: document.branch_profiles || [] };
  }
  if (basename === 'guides.json') {
    return { ...content, guides: document.guides || [] };
  }
  throw new Error(`Unsupported scoped import file: ${relativeFile}`);
}

function normalizeImportOptions(options = {}) {
  const file = cleanRelativeDataFile(options.file || null);
  const explicitScopes = {
    subjects: Boolean(options.subjects),
    colleges: Boolean(options.colleges),
    branchProfiles: Boolean(options.branchProfiles),
    guides: Boolean(options.guides),
  };
  if (file) {
    const basename = path.basename(file);
    if (/^subjects-.*\.json$/.test(basename)) explicitScopes.subjects = true;
    else if (/^colleges-.*\.json$/.test(basename)) explicitScopes.colleges = true;
    else if (basename === 'branch-guide-data.json') explicitScopes.branchProfiles = true;
    else if (basename === 'guides.json') explicitScopes.guides = true;
  }
  if (file && [explicitScopes.subjects, explicitScopes.colleges, explicitScopes.branchProfiles, explicitScopes.guides].filter(Boolean).length > 1) {
    throw new Error('--file can only be combined with the matching scoped import flag.');
  }
  const hasScope = explicitScopes.subjects || explicitScopes.colleges || explicitScopes.branchProfiles || explicitScopes.guides;
  const full = !hasScope;
  return {
    file,
    full,
    subjects: full || explicitScopes.subjects,
    colleges: full || explicitScopes.colleges,
    branchProfiles: full || explicitScopes.branchProfiles,
    guides: full || explicitScopes.guides,
    logger: typeof options.logger === 'function' ? options.logger : () => {},
    queryTimeoutMs: Number.isFinite(Number(options.queryTimeoutMs)) ? Number(options.queryTimeoutMs) : 30000,
  };
}

function importSummary(content, scopes) {
  const universityCodes = [...new Set(content.colleges.map(c => c.affiliated_to).filter(Boolean))].sort();
  return {
    universities: scopes.colleges || scopes.full ? universityCodes.length : 0,
    regulations: scopes.subjects || scopes.branchProfiles || scopes.guides || scopes.full ? content.shared.regulations.length : 0,
    branches: scopes.subjects || scopes.branchProfiles || scopes.guides || scopes.full ? content.shared.branches.length : 0,
    subjects: scopes.subjects ? content.subjects.length : 0,
    colleges: scopes.colleges ? content.colleges.length : 0,
    branchProfiles: scopes.branchProfiles ? content.branchProfiles.length : 0,
    guides: scopes.guides ? content.guides.length : 0,
    sourcesTouched: 0,
    file: scopes.file,
    scope: scopes.full ? 'full' : [
      scopes.subjects ? 'subjects' : null,
      scopes.colleges ? 'colleges' : null,
      scopes.branchProfiles ? 'branch_profiles' : null,
      scopes.guides ? 'guides' : null,
    ].filter(Boolean).join(','),
  };
}

function chunks(items, size = 100) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function queryWithTimeout(ctx, sql, values = []) {
  return ctx.conn.query({ sql, timeout: ctx.queryTimeoutMs }, values);
}

async function runImportPhase(ctx, name, expectedCount, callback) {
  const started = Date.now();
  ctx.currentPhase = name;
  ctx.logger(`start ${name}${expectedCount == null ? '' : ` (${expectedCount})`}`);
  await queryWithTimeout(ctx, 'START TRANSACTION');
  try {
    const result = await callback();
    await queryWithTimeout(ctx, 'COMMIT');
    ctx.lastCompletedPhase = name;
    ctx.logger(`done ${name} in ${Date.now() - started}ms`);
    return result;
  } catch (err) {
    await queryWithTimeout(ctx, 'ROLLBACK').catch(() => {});
    err.importPhase = name;
    err.lastCompletedPhase = ctx.lastCompletedPhase;
    throw err;
  }
}

async function upsertSourceWithContext(ctx, source, sourceType) {
  const payload = sourcePayload(source, sourceType);
  if (!payload) return null;
  const hash = checksum(payload);
  const cacheKey = `${sourceType}:${hash}`;
  if (ctx.sourceCache.has(cacheKey)) return ctx.sourceCache.get(cacheKey);
  const retrievedAt = payload.retrieved_date || null;
  const status = payload.status || 'needs_verification';

  const [result] = await queryWithTimeout(ctx,
    `INSERT INTO sources
      (origin_url, source_type, source_name, retrieved_at, checksum, status, caveat_text)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      id = LAST_INSERT_ID(id),
      origin_url = VALUES(origin_url),
      source_type = VALUES(source_type),
      source_name = VALUES(source_name),
      retrieved_at = VALUES(retrieved_at),
      status = VALUES(status),
      caveat_text = VALUES(caveat_text)`,
    [
      payload.origin_url,
      sourceType,
      sourceType,
      retrievedAt,
      hash,
      status,
      payload.college_source_note,
    ]
  );
  ctx.sourceCache.set(cacheKey, result.insertId);
  ctx.summary.sourcesTouched += 1;
  return result.insertId;
}

async function loadReferenceMaps(ctx) {
  const [regRows] = await queryWithTimeout(ctx, 'SELECT id, code FROM regulations');
  const [branchRows] = await queryWithTimeout(ctx, 'SELECT id, code FROM branches');
  const [universityRows] = await queryWithTimeout(ctx, 'SELECT id, code FROM universities');
  return {
    regulationIdByCode: new Map(regRows.map(row => [row.code, row.id])),
    branchIdByCode: new Map(branchRows.map(row => [row.code, row.id])),
    universityIdByCode: new Map(universityRows.map(row => [row.code, row.id])),
  };
}

export async function importJsonContent(conn, dataDir, options = {}) {
  const scopes = normalizeImportOptions(options);
  const content = loadScopedContent(dataDir, scopes);
  const summary = importSummary(content, scopes);
  const ctx = {
    conn,
    logger: scopes.logger,
    queryTimeoutMs: scopes.queryTimeoutMs,
    sourceCache: new Map(),
    summary,
    currentPhase: 'not_started',
    lastCompletedPhase: null,
  };

  ctx.logger(`scope ${summary.scope}${summary.file ? ` (${summary.file})` : ''}`);
  await queryWithTimeout(ctx, 'SET SESSION innodb_lock_wait_timeout = 20').catch(() => {});

  try {
    const universityCodes = [...new Set(content.colleges.map(c => c.affiliated_to).filter(Boolean))].sort();
    const universityState = new Map();

    if (scopes.colleges) {
      await runImportPhase(ctx, 'universities', universityCodes.length, async () => {
        const statesByCode = new Map();
        for (const college of content.colleges) {
          if (!college.affiliated_to || !college.location?.state) continue;
          if (!statesByCode.has(college.affiliated_to)) statesByCode.set(college.affiliated_to, new Set());
          statesByCode.get(college.affiliated_to).add(college.location.state);
        }
        for (const code of universityCodes) {
          const states = [...(statesByCode.get(code) || [])];
          universityState.set(code, states.length === 1 ? states[0] : null);
          await queryWithTimeout(ctx,
            `INSERT INTO universities (code, name, state, status)
             VALUES (?, ?, ?, 'active')
             ON DUPLICATE KEY UPDATE name = VALUES(name), state = VALUES(state), status = VALUES(status)`,
            [code, code, universityState.get(code)]
          );
        }
      });
    }

    if (scopes.subjects || scopes.branchProfiles || scopes.guides) {
      await runImportPhase(ctx, 'regulations', content.shared.regulations.length, async () => {
        for (const regulation of content.shared.regulations) {
          const sourceId = await upsertSourceWithContext(ctx, {
            origin_url: regulation.source_url ?? null,
            retrieved_date: regulation.last_verified ?? null,
            status: regulation.status === 'unconfirmed' ? 'needs_verification' : 'verified',
          }, 'regulation');
          await queryWithTimeout(ctx,
            `INSERT INTO regulations
              (code, full_name, status, effective_from, branch_groups_json, evaluation_scheme, honors_minor_rules, source_id, last_verified_at, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
              full_name = VALUES(full_name),
              status = VALUES(status),
              effective_from = VALUES(effective_from),
              branch_groups_json = VALUES(branch_groups_json),
              evaluation_scheme = VALUES(evaluation_scheme),
              honors_minor_rules = VALUES(honors_minor_rules),
              source_id = VALUES(source_id),
              last_verified_at = VALUES(last_verified_at),
              notes = VALUES(notes)`,
            [
              regulation.code,
              regulation.full_name,
              regulation.status,
              regulation.effective_from ?? null,
              json(regulation.branch_groups ?? null),
              regulation.evaluation_scheme ?? null,
              regulation.honors_minor_rules ?? null,
              sourceId,
              regulation.last_verified ?? null,
              regulation.notes ?? null,
            ]
          );
        }

        const [regRows] = await queryWithTimeout(ctx, 'SELECT id, code FROM regulations');
        const regulationIdByCode = new Map(regRows.map(row => [row.code, row.id]));
        for (const regulation of content.shared.regulations) {
          await queryWithTimeout(ctx,
            'UPDATE regulations SET supersedes_id = ? WHERE code = ?',
            [regulation.supersedes ? regulationIdByCode.get(regulation.supersedes) ?? null : null, regulation.code]
          );
        }
      });

      await runImportPhase(ctx, 'branches', content.shared.branches.length, async () => {
        for (const branch of content.shared.branches) {
          const sourceId = await upsertSourceWithContext(ctx, branch.source, 'branch');
          await queryWithTimeout(ctx,
            `INSERT INTO branches (code, name, branch_group, specializations_json, status, source_id)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
              name = VALUES(name),
              branch_group = VALUES(branch_group),
              specializations_json = VALUES(specializations_json),
              status = VALUES(status),
              source_id = VALUES(source_id)`,
            [
              branch.code,
              branch.name,
              branch.group ?? null,
              json(branch.specializations ?? []),
              branch.source?.status ?? 'verified',
              sourceId,
            ]
          );
        }
      });
    }

    const refs = await loadReferenceMaps(ctx);

    if (scopes.subjects) {
      await runImportPhase(ctx, 'subjects', content.subjects.length, async () => {
        const phaseStarted = Date.now();
        const subjectRows = [];
        for (const subject of content.subjects) {
          const sourceId = await upsertSourceWithContext(ctx, subject.source, 'subject');
          subjectRows.push([
            subject.id,
            refs.regulationIdByCode.get(subject.regulation) ?? null,
            refs.branchIdByCode.get(subject.branch) ?? null,
            json(subject.branchCodes ?? null),
            subject.specialization ?? null,
            subject.year ?? null,
            subject.semester ?? null,
            subject.year_sem_label ?? null,
            json(subject.offerings ?? null),
            subject.subject_code ?? null,
            subject.name,
            subject.category,
            json(subject.offering_categories ?? null),
            subject.type,
            json(subject.credits ?? null),
            json(subject.units ?? []),
            json(subject.course_outcomes ?? []),
            json(subject.resources ?? {}),
            subject.publication?.mode || 'page',
            subject.publication?.listing_url ?? null,
            subject.seo?.slug ?? subject.id,
            subject.seo?.title ?? null,
            subject.seo?.meta_description ?? null,
            sourceId,
            subject.source?.status ?? 'needs_verification',
            subject.notes ?? null,
          ]);
        }

        let written = 0;
        for (const batch of chunks(subjectRows)) {
          await queryWithTimeout(ctx,
            `INSERT INTO subjects
              (stable_id, regulation_id, branch_id, branch_codes_json, specialization_code, year, semester, year_sem_label,
               offerings_json, subject_code, name, category, offering_categories_json, subject_type, credits_json,
               units_json, course_outcomes_json, resources_json, publication_mode, listing_url,
               seo_slug, seo_title, meta_description, source_id, status, notes)
             VALUES ?
             ON DUPLICATE KEY UPDATE
              regulation_id = VALUES(regulation_id),
              branch_id = VALUES(branch_id),
              branch_codes_json = VALUES(branch_codes_json),
              specialization_code = VALUES(specialization_code),
              year = VALUES(year),
              semester = VALUES(semester),
              year_sem_label = VALUES(year_sem_label),
              offerings_json = VALUES(offerings_json),
              subject_code = VALUES(subject_code),
              name = VALUES(name),
              category = VALUES(category),
              offering_categories_json = VALUES(offering_categories_json),
              subject_type = VALUES(subject_type),
              credits_json = VALUES(credits_json),
              units_json = VALUES(units_json),
              course_outcomes_json = VALUES(course_outcomes_json),
              resources_json = VALUES(resources_json),
              publication_mode = VALUES(publication_mode),
              listing_url = VALUES(listing_url),
              seo_slug = VALUES(seo_slug),
              seo_title = VALUES(seo_title),
              meta_description = VALUES(meta_description),
              source_id = VALUES(source_id),
              status = VALUES(status),
              notes = VALUES(notes)`,
            [batch]
          );
          written += batch.length;
          ctx.logger(`progress subjects ${written}/${subjectRows.length} in ${Date.now() - phaseStarted}ms`);
        }

        const [existingSubjectRows] = await queryWithTimeout(ctx, 'SELECT id, stable_id FROM subjects');
        const subjectIdByStableId = new Map(existingSubjectRows.map(row => [row.stable_id, row.id]));
        const legacyUpdates = content.subjects.map(subject => [
          subject.id,
          subject.legacy_equivalent_id ? subjectIdByStableId.get(subject.legacy_equivalent_id) ?? null : null,
        ]);
        for (const batch of chunks(legacyUpdates)) {
          const caseSql = batch.map(() => 'WHEN ? THEN ?').join(' ');
          const caseValues = batch.flatMap(([stableId, legacyId]) => [stableId, legacyId]);
          const stableIds = batch.map(([stableId]) => stableId);
          await queryWithTimeout(ctx,
            `UPDATE subjects
             SET legacy_subject_id = CASE stable_id ${caseSql} ELSE legacy_subject_id END
             WHERE stable_id IN (?)`,
            [...caseValues, stableIds]
          );
        }
      });
    }

    if (scopes.colleges) {
      await runImportPhase(ctx, 'colleges', content.colleges.length, async () => {
        const phaseStarted = Date.now();
        const refreshedRefs = await loadReferenceMaps(ctx);
        const collegeRows = [];
        for (const college of content.colleges) {
          const sourceId = await upsertSourceWithContext(ctx, college.source, 'college');
          collegeRows.push([
            collegeStableKey(college),
            college.name,
            college.short_code ?? null,
            refreshedRefs.universityIdByCode.get(college.affiliated_to) ?? null,
            college.location?.city ?? null,
            college.location?.district ?? null,
            college.location?.state ?? null,
            college.type ?? null,
            json(college.branches_offered ?? []),
            college.official_website ?? null,
            college.nirf_rank ?? null,
            sourceId,
            college.source?.status ?? 'needs_verification',
          ]);
        }

        let written = 0;
        for (const batch of chunks(collegeRows)) {
          await queryWithTimeout(ctx,
            `INSERT INTO colleges
              (stable_key, name, short_code, university_id, city, district, state, college_type,
               branches_offered_json, official_website, nirf_rank, source_id, status)
             VALUES ?
             ON DUPLICATE KEY UPDATE
              name = VALUES(name),
              short_code = VALUES(short_code),
              university_id = VALUES(university_id),
              city = VALUES(city),
              district = VALUES(district),
              state = VALUES(state),
              college_type = VALUES(college_type),
              branches_offered_json = VALUES(branches_offered_json),
              official_website = VALUES(official_website),
              nirf_rank = VALUES(nirf_rank),
              source_id = VALUES(source_id),
              status = VALUES(status)`,
            [batch]
          );
          written += batch.length;
          ctx.logger(`progress colleges ${written}/${collegeRows.length} in ${Date.now() - phaseStarted}ms`);
        }
      });
    }

    if (scopes.branchProfiles) {
      await runImportPhase(ctx, 'branch_profiles', content.branchProfiles.length, async () => {
        const refreshedRefs = await loadReferenceMaps(ctx);
        for (const profile of content.branchProfiles) {
          const sourceId = await upsertSourceWithContext(ctx, profile.source, 'branch_profile');
          await queryWithTimeout(ctx,
            `INSERT INTO branch_profiles
              (branch_id, branch_code, tagline, core_focus_json, suits_students_who_json,
               less_good_fit_if_json, career_paths_json, further_study_paths_json,
               related_branches_json, data_disclaimer, source_id, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
              branch_id = VALUES(branch_id),
              tagline = VALUES(tagline),
              core_focus_json = VALUES(core_focus_json),
              suits_students_who_json = VALUES(suits_students_who_json),
              less_good_fit_if_json = VALUES(less_good_fit_if_json),
              career_paths_json = VALUES(career_paths_json),
              further_study_paths_json = VALUES(further_study_paths_json),
              related_branches_json = VALUES(related_branches_json),
              data_disclaimer = VALUES(data_disclaimer),
              source_id = VALUES(source_id),
              status = VALUES(status)`,
            [
              refreshedRefs.branchIdByCode.get(profile.branch) ?? null,
              profile.branch,
              profile.tagline,
              json(profile.core_focus ?? []),
              json(profile.suits_students_who ?? []),
              json(profile.less_good_fit_if ?? []),
              json(profile.career_paths ?? []),
              json(profile.further_study_paths ?? []),
              json(profile.related_branches ?? []),
              profile.data_disclaimer ?? null,
              sourceId,
              profile.source?.status ?? 'needs_verification',
            ]
          );
        }
      });
    }

    if (scopes.guides) {
      await runImportPhase(ctx, 'guides', content.guides.length, async () => {
        const refreshedRefs = await loadReferenceMaps(ctx);
        for (const guide of content.guides) {
          const sourceId = await upsertSourceWithContext(ctx, guide.source, 'guide');
          await queryWithTimeout(ctx,
            `INSERT INTO guides
              (stable_id, regulation_id, name, intro, aliases_json, sections_json,
               seo_slug, seo_title, meta_description, source_id, status, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
              regulation_id = VALUES(regulation_id),
              name = VALUES(name),
              intro = VALUES(intro),
              aliases_json = VALUES(aliases_json),
              sections_json = VALUES(sections_json),
              seo_slug = VALUES(seo_slug),
              seo_title = VALUES(seo_title),
              meta_description = VALUES(meta_description),
              source_id = VALUES(source_id),
              status = VALUES(status),
              notes = VALUES(notes)`,
            [
              guide.id,
              refreshedRefs.regulationIdByCode.get(guide.regulation) ?? null,
              guide.name,
              guide.intro ?? null,
              json(guide.aliases ?? []),
              json(guide.sections ?? []),
              guide.seo?.slug ?? guide.id,
              guide.seo?.title ?? guide.name,
              guide.seo?.meta_description ?? '',
              sourceId,
              guide.source?.status ?? 'needs_verification',
              guide.notes ?? null,
            ]
          );
        }
      });
    }

    ctx.logger('import complete');
    return {
      ...summary,
      sourcesTouched: ctx.summary.sourcesTouched,
      lastCompletedPhase: ctx.lastCompletedPhase,
    };
  } catch (err) {
    err.currentPhase = ctx.currentPhase;
    err.lastCompletedPhase = ctx.lastCompletedPhase;
    throw err;
  }
}

export async function exportDbContent(conn) {
  const [regRows] = await conn.query(`
    SELECT r.*, s.origin_url, s.retrieved_at
    FROM regulations r
    LEFT JOIN sources s ON s.id = r.source_id
    ORDER BY r.code
  `);
  const regCodeById = new Map(regRows.map(row => [row.id, row.code]));
  const regulations = regRows.map(row => stripNullish({
    code: row.code,
    full_name: row.full_name,
    effective_from: row.effective_from,
    status: row.status,
    supersedes: row.supersedes_id ? regCodeById.get(row.supersedes_id) ?? null : null,
    branch_groups: parseJson(row.branch_groups_json, undefined),
    evaluation_scheme: row.evaluation_scheme ?? undefined,
    honors_minor_rules: row.honors_minor_rules ?? undefined,
    source_url: row.origin_url ?? null,
    last_verified: dateOnly(row.last_verified_at),
    notes: row.notes ?? null,
  }));

  const [branchRows] = await conn.query(`
    SELECT b.*, s.origin_url, s.retrieved_at, s.caveat_text
    FROM branches b
    LEFT JOIN sources s ON s.id = b.source_id
    ORDER BY b.code
  `);
  const branches = branchRows.map(row => stripNullish({
    code: row.code,
    name: row.name,
    group: row.branch_group,
    specializations: parseJson(row.specializations_json, []),
    source: sourceFromRow(row, row.status),
  }));

  const [subjectRows] = await conn.query(`
    SELECT su.*, r.code AS regulation_code, b.code AS branch_code, legacy.stable_id AS legacy_stable_id,
      src.origin_url, src.retrieved_at, src.caveat_text
    FROM subjects su
    LEFT JOIN regulations r ON r.id = su.regulation_id
    LEFT JOIN branches b ON b.id = su.branch_id
    LEFT JOIN subjects legacy ON legacy.id = su.legacy_subject_id
    LEFT JOIN sources src ON src.id = su.source_id
    ORDER BY b.code, su.year, su.semester, su.stable_id
  `);
  const subjects = subjectRows.map(row => {
    const offerings = parseJson(row.offerings_json, null);
    const branchCodes = parseJson(row.branch_codes_json, null);
    return stripNullish({
      id: row.stable_id,
      regulation: row.regulation_code,
      branch: offerings ? undefined : (row.branch_code ?? (branchCodes?.length ? null : undefined)),
      branchCodes: offerings ? undefined : (branchCodes?.length ? branchCodes : undefined),
      offerings: offerings || undefined,
      specialization: row.specialization_code ?? undefined,
      year: offerings ? undefined : row.year,
      semester: offerings ? undefined : row.semester,
      year_sem_label: offerings ? undefined : row.year_sem_label,
      subject_code: row.subject_code,
      name: row.name,
      category: row.category,
      offering_categories: parseJson(row.offering_categories_json, undefined),
      credits: offerings ? undefined : parseJson(row.credits_json, null),
      type: row.subject_type,
      units: parseJson(row.units_json, []),
      course_outcomes: parseJson(row.course_outcomes_json, []),
      resources: parseJson(row.resources_json, {}),
      publication: row.publication_mode === 'listing_only'
        ? { mode: 'listing_only', listing_url: row.listing_url ?? null }
        : undefined,
      seo: {
        slug: row.seo_slug,
        title: row.seo_title,
        meta_description: row.meta_description,
      },
      legacy_equivalent_id: row.legacy_stable_id ?? undefined,
      source: sourceFromRow(row, row.status),
      notes: row.notes ?? null,
    });
  });

  const [collegeRows] = await conn.query(`
    SELECT c.*, u.code AS university_code, src.origin_url, src.retrieved_at, src.caveat_text
    FROM colleges c
    LEFT JOIN universities u ON u.id = c.university_id
    LEFT JOIN sources src ON src.id = c.source_id
    ORDER BY u.code, c.name
  `);
  const colleges = collegeRows.map(row => ({
    name: row.name,
    short_code: row.short_code,
    affiliated_to: row.university_code,
    location: {
      city: row.city,
      district: row.district,
      state: row.state,
    },
    type: row.college_type,
    branches_offered: parseJson(row.branches_offered_json, []),
    official_website: row.official_website,
    nirf_rank: row.nirf_rank,
    source: sourceFromRow(row, row.status),
  }));

  const [profileRows] = await conn.query(`
    SELECT bp.*, src.origin_url, src.retrieved_at, src.caveat_text
    FROM branch_profiles bp
    LEFT JOIN sources src ON src.id = bp.source_id
    ORDER BY bp.branch_code
  `);
  const branchProfiles = profileRows.map(row => ({
    branch: row.branch_code,
    tagline: row.tagline,
    core_focus: parseJson(row.core_focus_json, []),
    suits_students_who: parseJson(row.suits_students_who_json, []),
    less_good_fit_if: parseJson(row.less_good_fit_if_json, []),
    career_paths: parseJson(row.career_paths_json, []),
    further_study_paths: parseJson(row.further_study_paths_json, []),
    related_branches: parseJson(row.related_branches_json, []),
    data_disclaimer: row.data_disclaimer,
    source: sourceFromRow(row, row.status),
  }));

  const [guideRows] = await conn.query(`
    SELECT g.*, r.code AS regulation_code, src.origin_url, src.retrieved_at, src.caveat_text
    FROM guides g
    LEFT JOIN regulations r ON r.id = g.regulation_id
    LEFT JOIN sources src ON src.id = g.source_id
    ORDER BY g.stable_id
  `);
  const guides = guideRows.map(row => stripNullish({
    id: row.stable_id,
    regulation: row.regulation_code,
    name: row.name,
    intro: row.intro ?? undefined,
    aliases: parseJson(row.aliases_json, []),
    sections: parseJson(row.sections_json, []),
    seo: {
      slug: row.seo_slug,
      title: row.seo_title,
      meta_description: row.meta_description,
    },
    source: sourceFromRow(row, row.status),
    notes: row.notes ?? null,
  }));

  return {
    shared: { regulations, branches },
    subjects,
    colleges,
    branchProfiles,
    guides,
  };
}

export function writeExportedJson(content, outDir) {
  const dataDir = path.join(outDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'shared.json'), `${JSON.stringify(content.shared, null, 2)}\n`);
  fs.writeFileSync(path.join(dataDir, 'branch-guide-data.json'), `${JSON.stringify({ branch_profiles: content.branchProfiles }, null, 2)}\n`);
  fs.writeFileSync(path.join(dataDir, 'guides.json'), `${JSON.stringify({ guides: content.guides || [] }, null, 2)}\n`);

  const subjectsByBranch = groupBy(content.subjects, subject => {
    if (subject.offerings?.some(offering => offering.year === 1) || subject.year === 1) return 'first-year';
    const idBranch = String(subject.id || '').match(/^r\d+-([a-z]+)-/)?.[1];
    return String(subject.branch || idBranch || subject.branchCodes?.[0] || 'unknown').toLowerCase();
  });
  for (const [branch, subjects] of [...subjectsByBranch.entries()].sort()) {
    fs.writeFileSync(path.join(dataDir, `subjects-${branch}.json`), `${JSON.stringify({ subjects }, null, 2)}\n`);
  }

  const collegesByCampus = groupBy(content.colleges, college => college.affiliated_to || 'unknown');
  for (const [code, colleges] of [...collegesByCampus.entries()].sort()) {
    fs.writeFileSync(path.join(dataDir, campusFileName(code)), `${JSON.stringify({ colleges }, null, 2)}\n`);
  }

  return dataDir;
}

export function dbContentToSearchDocs(content) {
  return buildSearchIndex({
    subjects: content.subjects,
    branches: content.shared?.branches || content.branches || [],
    colleges: content.colleges,
    branchProfiles: content.branchProfiles,
    guides: content.guides || [],
  });
}

export function parityReport(jsonContent, dbContent) {
  const jsonSearchDocs = dbContentToSearchDocs({
    subjects: jsonContent.subjects,
    branches: jsonContent.shared?.branches || [],
    colleges: jsonContent.colleges,
    branchProfiles: jsonContent.branchProfiles,
    guides: jsonContent.guides || [],
  });
  const dbSearchDocs = dbContentToSearchDocs(dbContent);

  const checks = [];
  const add = (name, ok, details = '') => checks.push({ name, ok, details });
  const jsonVerifiedSubjects = jsonContent.subjects.filter(s => s.source?.status === 'verified').length;
  const dbVerifiedSubjects = dbContent.subjects.filter(s => s.source?.status === 'verified').length;
  const dbPageSubjects = dbContent.subjects.filter(s => s.source?.status === 'verified' && (s.publication?.mode || 'page') === 'page').length;
  const dbListingSubjects = dbContent.subjects.filter(s => s.source?.status === 'verified' && s.publication?.mode === 'listing_only').length;

  add('subject count', dbContent.subjects.length === EXPECTED_PARITY_COUNTS.subjects && dbContent.subjects.length === jsonContent.subjects.length, `${dbContent.subjects.length}`);
  add('verified subject count', dbVerifiedSubjects === EXPECTED_PARITY_COUNTS.verifiedSubjects && dbVerifiedSubjects === jsonVerifiedSubjects, `${dbVerifiedSubjects}`);
  add('subject page count', dbPageSubjects === EXPECTED_PARITY_COUNTS.subjectPages, `${dbPageSubjects}`);
  add('listing-only subject count', dbListingSubjects === EXPECTED_PARITY_COUNTS.listingSubjects, `${dbListingSubjects}`);
  add('college count', dbContent.colleges.length === EXPECTED_PARITY_COUNTS.colleges && dbContent.colleges.length === jsonContent.colleges.length, `${dbContent.colleges.length}`);
  add('branch profile count', dbContent.branchProfiles.length === EXPECTED_PARITY_COUNTS.branchProfiles && dbContent.branchProfiles.length === jsonContent.branchProfiles.length, `${dbContent.branchProfiles.length}`);
  add('guide count', (dbContent.guides || []).length === EXPECTED_PARITY_COUNTS.guides && (dbContent.guides || []).length === (jsonContent.guides || []).length, `${(dbContent.guides || []).length}`);
  add('search index doc count', dbSearchDocs.length === EXPECTED_PARITY_COUNTS.searchDocs && dbSearchDocs.length === jsonSearchDocs.length, `${dbSearchDocs.length}`);

  for (const slug of REPRESENTATIVE_SUBJECT_SLUGS) {
    const jsonSubject = jsonContent.subjects.find(s => s.seo?.slug === slug);
    const dbSubject = dbContent.subjects.find(s => s.seo?.slug === slug);
    add(`subject slug ${slug}`, Boolean(jsonSubject && dbSubject && jsonSubject.source?.status === dbSubject.source?.status), dbSubject?.source?.status || 'missing');
  }

  for (const branch of REPRESENTATIVE_BRANCHES) {
    const jsonProfile = jsonContent.branchProfiles.find(p => p.branch === branch);
    const dbProfile = dbContent.branchProfiles.find(p => p.branch === branch);
    add(`branch profile ${branch}`, Boolean(jsonProfile && dbProfile && jsonProfile.source?.status === dbProfile.source?.status), dbProfile?.source?.status || 'missing');
  }

  for (const code of REPRESENTATIVE_COLLEGE_CODES) {
    const jsonCount = jsonContent.colleges.filter(c => c.affiliated_to === code).length;
    const dbCount = dbContent.colleges.filter(c => c.affiliated_to === code).length;
    add(`college campus ${code}`, jsonCount > 0 && jsonCount === dbCount, `${dbCount}`);
  }

  return {
    ok: checks.every(check => check.ok),
    checks,
    counts: {
      json: {
        subjects: jsonContent.subjects.length,
        verifiedSubjects: jsonVerifiedSubjects,
        colleges: jsonContent.colleges.length,
        branchProfiles: jsonContent.branchProfiles.length,
        guides: (jsonContent.guides || []).length,
        searchDocs: jsonSearchDocs.length,
      },
      db: {
        subjects: dbContent.subjects.length,
        verifiedSubjects: dbVerifiedSubjects,
        colleges: dbContent.colleges.length,
        branchProfiles: dbContent.branchProfiles.length,
        guides: (dbContent.guides || []).length,
        searchDocs: dbSearchDocs.length,
      },
    },
  };
}
