const SUPPORTED_ENTITY_TYPES = new Set(['subject', 'college', 'branch_profile']);

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, stripUndefined(entry)])
    );
  }
  return value;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function valuesEqual(left, right) {
  return stableJson(stripUndefined(left)) === stableJson(stripUndefined(right));
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasValue(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.values(value).some(entry => hasValue(entry));
  return true;
}

function isThinValue(value) {
  return !hasValue(value);
}

function addSafetyWarning(warnings, {
  code,
  message,
  path = '',
  severity = 'warning',
  blocking = false,
  before = undefined,
  attempted = undefined,
  action = 'review',
}) {
  warnings.push(stripUndefined({
    code,
    severity,
    blocking,
    path,
    message,
    before,
    attempted,
    action,
  }));
}

function primitiveDiff(path, before, after, changes) {
  if (!valuesEqual(before, after)) {
    changes.push({ path, before, after });
  }
}

function diffObjects(before, after, basePath = '') {
  const changes = [];
  const keys = new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ]);

  for (const key of [...keys].sort()) {
    const path = basePath ? `${basePath}.${key}` : key;
    const left = before?.[key];
    const right = after?.[key];
    if (
      left && right &&
      typeof left === 'object' &&
      typeof right === 'object' &&
      !Array.isArray(left) &&
      !Array.isArray(right)
    ) {
      changes.push(...diffObjects(left, right, path));
    } else {
      primitiveDiff(path, left, right, changes);
    }
  }

  return changes;
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function findSubject(content, key) {
  const normalized = normalizeKey(key);
  return (content.data.subjects || []).find(subject => {
    return [
      subject.id,
      subject.seo?.slug,
      subject.subject_code,
      subject.name,
    ].some(candidate => normalizeKey(candidate) === normalized);
  }) || null;
}

function collegeStableKey(college) {
  return [
    college.affiliated_to || '',
    college.short_code || '',
    college.name || '',
    college.location?.district || '',
  ].join(':');
}

function findCollege(content, key) {
  const normalized = normalizeKey(key);
  return (content.colleges || []).find(college => {
    return [
      collegeStableKey(college),
      college.short_code,
      college.name,
      college.official_website,
    ].some(candidate => normalizeKey(candidate) === normalized);
  }) || null;
}

function findBranchProfile(content, key) {
  const normalized = normalizeKey(key);
  return (content.branchProfiles || []).find(profile => {
    return [
      profile.branch,
      profile.branch_name,
      profile.tagline,
    ].some(candidate => normalizeKey(candidate) === normalized);
  }) || null;
}

function findExisting(content, entityType, entityKey) {
  if (entityType === 'subject') return findSubject(content, entityKey);
  if (entityType === 'college') return findCollege(content, entityKey);
  if (entityType === 'branch_profile') return findBranchProfile(content, entityKey);
  return null;
}

function proposedFromParsedPayload(parsedPayload, entityType, entityKey, proposedPayload = null) {
  if (proposedPayload && typeof proposedPayload === 'object') return stripUndefined(proposedPayload);
  return stripUndefined({
    entity_type: entityType,
    entity_key: entityKey,
    evidence_status: 'needs_review',
    parsed_payload: parsedPayload || {},
  });
}

const ALWAYS_PRESERVE_PATHS = new Set([
  'seo',
  'notes',
]);

const PRESERVE_IF_THIN_PATHS = new Set([
  'units',
  'course_outcomes',
  'resources',
]);

function joinPath(basePath, key) {
  return basePath ? `${basePath}.${key}` : key;
}

function preserveWarningCode(pathName) {
  if (ALWAYS_PRESERVE_PATHS.has(pathName)) return 'existing_rich_field_preserved';
  if (PRESERVE_IF_THIN_PATHS.has(pathName)) return 'thin_parser_field_preserved';
  return 'thin_parser_value_preserved';
}

function conservativeMergeValue(existing, proposed, pathName, safety) {
  const existingHasValue = hasValue(existing);
  const proposedIsThin = isThinValue(proposed);

  if (ALWAYS_PRESERVE_PATHS.has(pathName) && existingHasValue) {
    if (!valuesEqual(existing, proposed)) {
      safety.preserved_paths.push(pathName);
      addSafetyWarning(safety.warnings, {
        code: preserveWarningCode(pathName),
        path: pathName,
        message: `${pathName} was preserved from existing content instead of replacing it with parser output.`,
        before: existing,
        attempted: proposed,
        action: 'preserved_existing',
      });
    }
    return clone(existing);
  }

  if (PRESERVE_IF_THIN_PATHS.has(pathName) && existingHasValue && proposedIsThin) {
    safety.preserved_paths.push(pathName);
    addSafetyWarning(safety.warnings, {
      code: preserveWarningCode(pathName),
      path: pathName,
      message: `${pathName} exists in current content and parser output did not provide a richer value, so the existing value was preserved.`,
      before: existing,
      attempted: proposed,
      action: 'preserved_existing',
    });
    return clone(existing);
  }

  if (
    pathName === 'source' &&
    existing?.status === 'verified' &&
    proposed?.status &&
    proposed.status !== 'verified'
  ) {
    const warning = {
      code: 'verified_source_downgrade_blocked',
      path: 'source.status',
      message: `Existing source.status is verified; parser output attempted ${proposed.status}. The existing verified source was preserved. Approval requires explicit reviewer override.`,
      severity: 'blocking',
      blocking: true,
      before: existing.status,
      attempted: proposed.status,
      action: 'blocked_downgrade',
    };
    safety.blocked_changes.push(warning);
    addSafetyWarning(safety.warnings, warning);
    return clone(existing);
  }

  if (proposed === undefined) return clone(existing);

  if (existingHasValue && proposedIsThin) {
    safety.preserved_paths.push(pathName);
    addSafetyWarning(safety.warnings, {
      code: preserveWarningCode(pathName),
      path: pathName,
      message: `${pathName} has an existing value and parser output was empty, so the existing value was preserved.`,
      before: existing,
      attempted: proposed,
      action: 'preserved_existing',
    });
    return clone(existing);
  }

  if (isPlainObject(existing) && isPlainObject(proposed)) {
    const merged = {};
    const keys = new Set([...Object.keys(existing), ...Object.keys(proposed)]);
    for (const key of keys) {
      merged[key] = conservativeMergeValue(existing[key], proposed[key], joinPath(pathName, key), safety);
    }
    return stripUndefined(merged);
  }

  return clone(proposed);
}

function conservativeMerge(existingPayload, proposedPayload) {
  const safety = {
    operation: 'merge_update',
    warnings: [],
    preserved_paths: [],
    blocked_changes: [],
    destructive_change_count: 0,
  };
  const proposed = conservativeMergeValue(existingPayload, proposedPayload, '', safety);
  safety.preserved_paths = [...new Set(safety.preserved_paths.filter(Boolean))];
  safety.destructive_change_count = safety.blocked_changes.length;
  return { proposedPayload: stripUndefined(proposed), safety };
}

function addModeDiff({ proposed, entityType, entityKey }) {
  return {
    algorithm: 'safe-entity-diff',
    operation: 'add',
    match: {
      strategy: 'exact_key',
      entity_type: entityType,
      entity_key: entityKey,
      found_existing: false,
    },
    change_count: 1,
    changes: [{
      path: '/',
      before: null,
      after: proposed,
    }],
    safety: {
      operation: 'add',
      warnings: [],
      preserved_paths: [],
      blocked_changes: [],
      destructive_change_count: 0,
    },
  };
}

export function createStructuredDiff({ content, parsedPayload, proposedPayload = null, entityType, entityKey }) {
  if (!SUPPORTED_ENTITY_TYPES.has(entityType)) {
    throw new Error(`Unsupported diff entity type: ${entityType}`);
  }
  if (!entityKey || !String(entityKey).trim()) {
    throw new Error('Entity key is required.');
  }

  const existing = findExisting(content, entityType, entityKey);
  const proposed = proposedFromParsedPayload(parsedPayload, entityType, entityKey, proposedPayload);

  if (!existing) {
    const diff = addModeDiff({ proposed, entityType, entityKey });
    return {
      existingPayload: null,
      proposedPayload: proposed,
      diff,
      confidence: {
        operation: 'add',
        match_strategy: 'exact_key_absent',
        match_confidence: 'new_entity',
        extraction_confidence: 'needs_review',
        requires_human_review: true,
        no_auto_proposal: true,
      },
    };
  }

  const existingPayload = stripUndefined(existing);
  const merged = conservativeMerge(existingPayload, proposed);
  const finalProposed = merged.proposedPayload;
  const changes = diffObjects(existingPayload, finalProposed);
  const operation = changes.length ? 'merge_update' : 'no_change';

  return {
    existingPayload,
    proposedPayload: finalProposed,
    diff: {
      algorithm: 'safe-entity-diff',
      operation,
      match: {
        strategy: 'exact_key',
        entity_type: entityType,
        entity_key: entityKey,
        found_existing: true,
      },
      change_count: changes.length,
      changes,
      safety: {
        ...merged.safety,
        operation,
      },
    },
    confidence: {
      operation,
      match_strategy: 'exact_key',
      match_confidence: 'high',
      extraction_confidence: 'needs_review',
      requires_human_review: true,
      no_auto_proposal: true,
    },
  };
}
