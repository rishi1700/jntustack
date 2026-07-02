import { normalizeEntityKey } from '../proposal-validation.js';
import { extractBranchProfilePayload } from './branch-profile-extractor.js';
import { extractCollegePayload } from './college-extractor.js';
import { extractSubjectPayload } from './subject-extractor.js';

const EXTRACTORS = {
  subject: extractSubjectPayload,
  college: extractCollegePayload,
  branch_profile: extractBranchProfilePayload,
};

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

export function supportedEntityExtractors() {
  return Object.keys(EXTRACTORS);
}

export function extractEntityPayload({ parsedPayload, entityType, entityKey = '', hints = {}, candidateIndex = null }) {
  const extractor = EXTRACTORS[entityType];
  if (!extractor) throw new Error(`Unsupported extraction entity type: ${entityType}`);
  const normalizedEntityKey = normalizeEntityKey(entityType, entityKey);
  const result = extractor({
    parsedPayload,
    entityKey: normalizedEntityKey || entityKey,
    hints,
    candidateIndex,
  });
  return {
    entityType,
    entityKey: normalizedEntityKey || entityKey || null,
    extractedPayload: stripUndefined(result.payload || {}),
    confidence: {
      ...(result.confidence || {}),
      entity_type: entityType,
      entity_key: normalizedEntityKey || entityKey || null,
      hints: stripUndefined(hints || {}),
      candidate_index: candidateIndex == null || candidateIndex === '' ? null : Number(candidateIndex),
      evidence_status: 'needs_review',
    },
  };
}
