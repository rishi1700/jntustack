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

export function createStructuredDiff({ content, parsedPayload, proposedPayload = null, entityType, entityKey }) {
  if (!SUPPORTED_ENTITY_TYPES.has(entityType)) {
    throw new Error(`Unsupported diff entity type: ${entityType}`);
  }
  if (!entityKey || !String(entityKey).trim()) {
    throw new Error('Entity key is required.');
  }

  const existing = findExisting(content, entityType, entityKey);
  if (!existing) {
    throw new Error(`No exact ${entityType} match found for key: ${entityKey}`);
  }

  const existingPayload = stripUndefined(existing);
  const proposed = proposedFromParsedPayload(parsedPayload, entityType, entityKey, proposedPayload);
  const changes = diffObjects(existingPayload, proposed);

  return {
    existingPayload,
    proposedPayload: proposed,
    diff: {
      algorithm: 'exact-key-json-compare',
      match: {
        strategy: 'exact_key',
        entity_type: entityType,
        entity_key: entityKey,
      },
      change_count: changes.length,
      changes,
    },
    confidence: {
      match_strategy: 'exact_key',
      match_confidence: 'high',
      extraction_confidence: 'needs_review',
      requires_human_review: true,
      no_auto_proposal: true,
    },
  };
}
