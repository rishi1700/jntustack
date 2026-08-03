import { createStructuredDiff } from './diff-engine.js';
import { validateProposalPayload } from './proposal-validation.js';

export const VERIFIED_AMENDMENT_CONFIRMATION = 'AMEND VERIFIED SOURCE';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function withoutSource(value) {
  const copy = clone(value) || {};
  delete copy.source;
  return copy;
}

function canonicalUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    parsed.hash = '';
    if (parsed.pathname !== '/') parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.href;
  } catch {
    return '';
  }
}

function validChecksum(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || '').trim());
}

export function isVerifiedReviewDiff(diffValue) {
  const diff = typeof diffValue === 'string' ? JSON.parse(diffValue) : diffValue;
  return ['verified_promotion', 'verified_amendment'].includes(diff?.workflow?.type);
}

export function prepareVerifiedProvenanceAmendment({
  root = process.cwd(),
  content,
  entityType,
  entityKey,
  proposedPayload,
  sourceAsset,
  sourceAssetFileStatus,
  discoverySource,
  reviewerNote = '',
  confirmationPhrase = '',
}) {
  const errors = [];
  const current = entityType === 'subject'
    ? (content?.data?.subjects || []).find(subject => subject.id === entityKey || subject.seo?.slug === entityKey)
    : null;
  const validation = validateProposalPayload({
    root,
    entityType,
    payload: proposedPayload,
    allowVerifiedSource: true,
  });
  const proposed = validation.normalizedPayload;

  if (entityType !== 'subject') errors.push('Verified provenance amendments support existing subjects only.');
  if (!current) errors.push('The existing subject was not found.');
  if (current?.source?.status !== 'verified') errors.push('The existing subject must already be verified.');
  if (proposed?.source?.status !== 'verified') errors.push('The amended source status must remain verified.');
  if (validation.status !== 'passed') errors.push(...validation.errors.map(error => `${error.path}: ${error.message}`));
  if (current && stableJson(withoutSource(current)) !== stableJson(withoutSource(proposed))) {
    errors.push('Verified provenance amendments may change source fields only; all academic, SEO, routing, notes, and publication fields must remain identical.');
  }
  if (current && stableJson(current.source || {}) === stableJson(proposed?.source || {})) {
    errors.push('The proposed source metadata does not change the existing subject.');
  }
  if (!sourceAsset) errors.push('A source asset is required.');
  if (sourceAsset && !['stored', 'duplicate'].includes(sourceAsset.downloadStatus)) {
    errors.push('The source asset must have a stored or duplicate download status.');
  }
  if (!sourceAssetFileStatus?.exists) errors.push('The source asset file must be present in persistent storage.');
  if (!validChecksum(sourceAsset?.sha256Checksum)) errors.push('The source asset must have a valid SHA-256 checksum.');
  if (!discoverySource?.enabled || discoverySource?.trustLevel !== 'official') {
    errors.push('The source asset must belong to an enabled official discovery source.');
  }
  if (sourceAsset && discoverySource && Number(sourceAsset.discoverySourceId) !== Number(discoverySource.id)) {
    errors.push('The source asset and discovery source do not match.');
  }
  const proposedUrl = canonicalUrl(proposed?.source?.origin_url);
  const assetUrls = [sourceAsset?.sourceUrl, sourceAsset?.resolvedUrl].map(canonicalUrl).filter(Boolean);
  if (!proposedUrl || !assetUrls.includes(proposedUrl)) {
    errors.push('source.origin_url must match the stored asset source URL or resolved URL.');
  }
  if (!String(proposed?.source?.retrieved_date || '').trim()) errors.push('source.retrieved_date is required.');
  if (!String(proposed?.source?.college_source_note || '').trim()) errors.push('source.college_source_note is required.');
  if (!String(reviewerNote || '').trim()) errors.push('Reviewer note is required.');
  if (String(confirmationPhrase || '').trim() !== VERIFIED_AMENDMENT_CONFIRMATION) {
    errors.push(`Confirmation phrase must be exactly: ${VERIFIED_AMENDMENT_CONFIRMATION}.`);
  }

  if (errors.length) throw new Error(errors.join(' '));

  const structured = createStructuredDiff({ content, entityType, entityKey, proposedPayload: proposed });
  if (!structured.diff.changes.length || structured.diff.changes.some(change => !String(change.path).startsWith('source.'))) {
    throw new Error('The generated amendment diff must contain source-field changes only.');
  }
  return {
    proposedPayload: proposed,
    diff: {
      ...structured.diff,
      workflow: {
        type: 'verified_amendment',
        reviewer_note: String(reviewerNote).trim(),
        source_asset_id: Number(sourceAsset.id),
        source_asset_sha256: String(sourceAsset.sha256Checksum).toLowerCase(),
        confirmation_recorded: true,
        existing_publication_unchanged: true,
        elective_option_confirmed: true,
      },
    },
  };
}
