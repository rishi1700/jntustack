import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const SUPPORTED_ENTITY_TYPES = new Set(['subject', 'college', 'branch_profile']);
const SAFE_SOURCE_STATUS = 'needs_verification';

let validatorCache = null;

function cleanString(value) {
  return value.trim().replace(/\s+/g, ' ');
}

function slugify(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function deepNormalize(value) {
  if (Array.isArray(value)) return value.map(item => deepNormalize(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, deepNormalize(child)])
    );
  }
  if (typeof value === 'string') return cleanString(value);
  return value;
}

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  return JSON.parse(value);
}

function getValidators(root) {
  if (validatorCache) return validatorCache;
  const schemaPath = path.join(root, 'data', 'schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  ajv.addSchema(schema);
  validatorCache = {
    subject: ajv.getSchema(`${schema.$id}#/definitions/Subject`),
    college: ajv.getSchema(`${schema.$id}#/definitions/College`),
    branch_profile: ajv.getSchema(`${schema.$id}#/definitions/BranchProfile`),
  };
  return validatorCache;
}

function ajvErrors(validate) {
  return (validate.errors || []).map(err => ({
    path: err.instancePath || '/',
    message: err.message || 'is invalid',
    keyword: err.keyword,
    params: err.params || {},
  }));
}

function normalizeSource(payload, { allowVerifiedSource = false } = {}) {
  const next = { ...payload };
  const source = next.source && typeof next.source === 'object' ? { ...next.source } : {};
  if (!source.status || (source.status === 'verified' && !allowVerifiedSource)) source.status = SAFE_SOURCE_STATUS;
  next.source = source;
  return next;
}

export function normalizeEntityKey(entityType, entityKey) {
  const key = cleanString(String(entityKey || ''));
  if (!key) return '';
  if (entityType === 'subject') return slugify(key);
  if (entityType === 'branch_profile') return key.toUpperCase();
  return key;
}

export function normalizeProposalPayload(entityType, payload, options = {}) {
  let normalized = deepNormalize(parseJson(payload, {}));
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) return normalized;

  normalized = normalizeSource(normalized, options);

  if (entityType === 'subject') {
    if (normalized.id) normalized.id = slugify(normalized.id);
    if (normalized.regulation) normalized.regulation = String(normalized.regulation).toUpperCase();
    if (normalized.branch) normalized.branch = String(normalized.branch).toUpperCase();
    if (normalized.specialization) normalized.specialization = String(normalized.specialization).toUpperCase();
    if (normalized.seo && typeof normalized.seo === 'object' && normalized.seo.slug) {
      normalized.seo = { ...normalized.seo, slug: slugify(normalized.seo.slug) };
    }
  }

  if (entityType === 'college') {
    if (normalized.affiliated_to) normalized.affiliated_to = String(normalized.affiliated_to).toUpperCase();
    if (normalized.short_code) normalized.short_code = String(normalized.short_code).toUpperCase();
  }

  if (entityType === 'branch_profile' && normalized.branch) {
    normalized.branch = String(normalized.branch).toUpperCase();
  }

  return normalized;
}

function workflowErrors(entityType, payload, { allowVerifiedSource = false } = {}) {
  const errors = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return [{ path: '/', message: 'Proposal payload must be a JSON object.', keyword: 'type', params: {} }];
  }
  if (payload.source?.status === 'verified' && !allowVerifiedSource) {
    errors.push({
      path: '/source/status',
      message: 'Proposal payloads cannot enter review as verified. Use needs_verification until a future approval workflow applies verification.',
      keyword: 'verified_only_guard',
      params: { entityType },
    });
  }
  return errors;
}

export function validateProposalPayload({ root, entityType, payload, allowVerifiedSource = false }) {
  if (!SUPPORTED_ENTITY_TYPES.has(entityType)) {
    return {
      status: 'failed',
      errors: [{ path: '/entity_type', message: `Unsupported proposal type: ${entityType}`, keyword: 'enum', params: {} }],
      normalizedPayload: payload,
    };
  }

  const normalizedPayload = normalizeProposalPayload(entityType, payload, { allowVerifiedSource });
  const validate = getValidators(root)[entityType];
  const valid = validate(normalizedPayload);
  const errors = [
    ...ajvErrors(validate),
    ...workflowErrors(entityType, normalizedPayload, { allowVerifiedSource }),
  ];

  return {
    status: valid && errors.length === 0 ? 'passed' : 'failed',
    errors,
    normalizedPayload,
  };
}
