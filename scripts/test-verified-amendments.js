import assert from 'node:assert/strict';
import { loadContent } from '../lib/content-store/index.js';
import {
  VERIFIED_AMENDMENT_CONFIRMATION,
  isVerifiedReviewDiff,
  prepareVerifiedProvenanceAmendment,
} from '../lib/verified-amendments.js';
import { resolveSubjectTargetForExport } from '../lib/proposal-export.js';

const root = process.cwd();
const content = await loadContent({ root });
const entityKey = 'r23-cse-3-1-principles-of-operating-systems';
const current = content.data.subjects.find(subject => subject.id === entityKey);
assert.ok(current);

const sourceUrl = 'https://www.jntuk.edu.in/jntuk_uploads/notification/5340571783322882922.pdf';
const proposedPayload = JSON.parse(JSON.stringify(current));
proposedPayload.source = {
  origin_url: sourceUrl,
  retrieved_date: '2026-08-03',
  status: 'verified',
  college_source_note: 'The placement, credits, and five units are confirmed by the official JNTUK open-elective syllabus.',
  additional_sources: [{
    origin_url: current.source.origin_url,
    label: 'Official JNTUK R23 CSE syllabus previously reviewed',
  }, {
    origin_url: 'https://jntuk.edu.in/jntuk_uploads/notification/8650351779382116914.pdf',
    label: 'Official JNTUK R23 Information Technology course structure and syllabus',
  }],
};

const sourceAsset = {
  id: 46,
  discoverySourceId: 1,
  sourceUrl,
  resolvedUrl: sourceUrl,
  sha256Checksum: '73bdd6f0ec4bf6078ad92ff641a11cfaeb3b92b8ffaa54079b80a8bb277f607b',
  downloadStatus: 'stored',
};
const discoverySource = { id: 1, enabled: true, trustLevel: 'official' };

const prepared = prepareVerifiedProvenanceAmendment({
  root,
  content,
  entityType: 'subject',
  entityKey,
  proposedPayload,
  sourceAsset,
  sourceAssetFileStatus: { exists: true },
  discoverySource,
  reviewerNote: 'Official JNTUK evidence checked against the existing verified subject.',
  confirmationPhrase: VERIFIED_AMENDMENT_CONFIRMATION,
});
assert.equal(prepared.proposedPayload.source.status, 'verified');
assert.equal(prepared.diff.workflow.type, 'verified_amendment');
assert.equal(prepared.diff.workflow.source_asset_id, 46);
assert.equal(prepared.diff.workflow.existing_publication_unchanged, true);
assert.ok(prepared.diff.changes.length > 0);
assert.ok(prepared.diff.changes.every(change => change.path.startsWith('source.')));
assert.equal(isVerifiedReviewDiff(prepared.diff), true);
assert.equal(isVerifiedReviewDiff({ workflow: { type: 'verified_promotion' } }), true);

const exportTarget = await resolveSubjectTargetForExport({
  root,
  entityKey,
  payload: proposedPayload,
  existing: true,
});
assert.equal(exportTarget.dataFileHint, 'data/subjects-cse.json');
assert.ok(exportTarget.index >= 0);

assert.throws(() => prepareVerifiedProvenanceAmendment({
  root,
  content,
  entityType: 'subject',
  entityKey,
  proposedPayload: { ...proposedPayload, name: 'Changed academic title' },
  sourceAsset,
  sourceAssetFileStatus: { exists: true },
  discoverySource,
  reviewerNote: 'Not source only.',
  confirmationPhrase: VERIFIED_AMENDMENT_CONFIRMATION,
}), /source fields only/);

assert.throws(() => prepareVerifiedProvenanceAmendment({
  root,
  content,
  entityType: 'subject',
  entityKey,
  proposedPayload,
  sourceAsset,
  sourceAssetFileStatus: { exists: true },
  discoverySource,
  reviewerNote: 'Missing confirmation.',
  confirmationPhrase: '',
}), /AMEND VERIFIED SOURCE/);

assert.throws(() => prepareVerifiedProvenanceAmendment({
  root,
  content,
  entityType: 'subject',
  entityKey,
  proposedPayload,
  sourceAsset,
  sourceAssetFileStatus: { exists: false },
  discoverySource: { ...discoverySource, trustLevel: 'supplemental' },
  reviewerNote: 'Bad evidence.',
  confirmationPhrase: VERIFIED_AMENDMENT_CONFIRMATION,
}), /persistent storage.*enabled official/);

console.log('Verified provenance amendment tests passed.');
