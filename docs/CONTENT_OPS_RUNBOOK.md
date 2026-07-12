# Content Operations Runbook

Last updated: 2026-07-11 after the official CSE/ECE/IT source passes and
immediate content-integrity corrections.

This runbook is for controlled content work. It does not authorize broad rewrites, unverified publishing, crawler/scheduler work, `/api/ask`, or DB-backed serving.

## Hard Rules

- Never publish `needs_verification` content.
- Never mark a subject `verified` without human source review.
- Never expose `/api/ask` without rate limiting and final model testing.
- Never switch `CONTENT_SOURCE=db` until explicitly approved.
- Never assume `entity_key == URL slug`; use `seo.slug || id` for public URL checks.
- After every guarded live apply, immediately sync Git and update the DB mirror.
- Do not manually edit live JSON if the guarded apply workflow has failed; use resume, recovery, or rollback paths.

## Standard Commands

Local checks:

```sh
npm run test:parsers
npm run build
npm run test:retrieve
npm run test:content-store
npm run audit:site
```

DB checks with Hostinger env loaded:

```sh
NODE_OPTIONS=--dns-result-order=ipv4first npm run db:import-json -- --verify
NODE_OPTIONS=--dns-result-order=ipv4first npm run db:parity
NODE_OPTIONS=--dns-result-order=ipv4first npm run test:content-store
NODE_OPTIONS=--dns-result-order=ipv4first npm run db:status
```

Keep `CONTENT_SOURCE=json` unless a task explicitly approves DB serving.

## PDF Fetch or Upload

Use the admin source workflow, not ad hoc content edits:

1. Configure or select the correct discovery source.
2. Fetch the PDF URL or upload the asset through admin.
3. Confirm the asset row stores:
   - source URL
   - content type
   - checksum
   - file size
   - storage path
   - download/fetch status
4. If metadata exists but the storage file is missing, use the asset repair action. The repair flow should reuse the existing row, re-download the file, refresh checksum/size/content metadata, and record audit events.

Safe source fetch constraints:

- HTTP/HTTPS only.
- Source URL must belong to the configured source domain.
- Private/local IP targets are blocked.
- Large downloads are blocked.
- Re-fetch should repair stale metadata instead of inserting duplicate rows.

## Parse

Choose the parser that matches the asset and source:

- `pdf-text-basic` for raw PDF text review.
- `tirumala-r23-syllabus-pdf` for Tirumala R23 course-structure candidates.
- `lbrce-r23-syllabus-pdf` for LBRCE R23 course-structure candidates.
- `html-basic` for basic HTML review.
- `tirumala-syllabus-html` for Tirumala HTML/text evidence.

Do not use `lbrce-syllabus-html`; it is registered but unavailable.

Parser output is evidence, not content. A successful parse does not create public pages.

## Extract

Run extraction only after parse output is reviewed enough to identify likely entities.

Subject extraction produces `needs_verification` payloads by default. It must not create verified payloads directly.

For LBRCE category mapping:

- Use mapping only when source evidence and reviewer notes justify it.
- Keep ambiguous categories unresolved or request changes.
- Do not map categories by convenience.

## Validate

Validate proposed payloads against `data/schema.json`.

Validation must pass before approval, release inclusion, export, draft apply, or live apply.

For verified promotion proposals, release review blocks missing public metadata:

- `missing_source_retrieved_date`
- `missing_public_source_caveat`

Fix metadata through the supported proposal/review workflow before live apply.

## Diff

Generate structured diffs from extraction or manual proposal payloads.

Expected safe operations:

- New draft content: `add` to `/subjects/-` with `source.status = "needs_verification"`.
- Verified promotion: `replace` of an existing subject where the only intended content change is `source.status`.

Review diff output for:

- duplicate entity keys
- wrong target file
- unintended slug changes
- fabricated units/outcomes/resources
- source metadata loss
- replace operations touching the wrong subject

## Proposal

Create proposals from clean diffs or the verified promotion workflow.

New parser/extraction proposals must stay `needs_verification`.

Approve for draft only after:

- validation passed
- source/provenance is visible
- operation is understood
- reviewer note records the evidence and caveats

Do not auto-create or auto-approve proposals.

## Verified Promotion

Use `/admin/verification-reviews` for subjects already in JSON as `needs_verification`.

Reviewer must confirm:

- source opened and reviewed
- title matches source
- regulation, branch, year, and semester are correct
- category/type are correct or explicitly reviewer-classified
- credits are correct
- no fabricated units/outcomes/resources were added
- source URL is present
- `retrieved_date` is present
- public `college_source_note` is present
- caveat text is appropriate for the source

Required confirmation phrase:

```text
PROMOTE TO VERIFIED
```

Verified promotion creates a proposal only. It does not edit live JSON.

## Release Candidate

Create one release candidate for a small coherent batch.

Add only approved proposals with passed validation.

Generate:

1. Proposal exports.
2. Draft applies.
3. Immutable revisions.
4. Release review summary.

Release review must have zero blocking warnings before marking ready.

Informational same-file safe-add warnings are acceptable only when release review marks them non-blocking and all adds are append-only with unique keys.

## Durable Apply Plan

Generate a durable apply plan only after the release candidate is `ready_for_review`.

Confirm:

- plan exists in MySQL
- warning count is expected
- changed files are expected
- operations are expected
- entity keys are correct
- canonical public URLs derive from `seo.slug || id`
- release has no existing active live apply row

Tmp files under `tmp/release-apply-plans/` are convenience artifacts only. MySQL is canonical.

## Guarded Live Apply

Use the live admin apply-plan page only.

Required confirmation phrase:

```text
APPLY LIVE JSON
```

The guarded live apply:

1. Creates a `release_live_applies` row.
2. Creates backups.
3. Writes `data/*.json`.
4. Marks the release partial until verification.
5. Requires separate verification.

After apply, start live verification from the live apply page. A successful apply should end as:

- status: `published_pending_deploy`
- phase: `completed`
- verification: `passed`
- backup path present

If anything fails, do not manually edit files. Use the built-in verification, recovery, or rollback path and report the exact phase and error.

## Git Sync

After every successful live apply:

1. Sync or reconstruct the live JSON changes into local Git.
2. Verify exact intended changes only.
3. Update parity constants if counts changed.
4. Run local checks.
5. Import JSON to MySQL with verification.
6. Run DB parity.
7. Commit and push.
8. Wait for Hostinger deploy.
9. Verify live endpoints and canonical URLs.

Current expected JSON/build state:

- Subjects: 421
- Verified: 392
- Needs verification: 29
- Placeholder: 0
- Search docs: 774
- Sitemap URLs: 401

## DB Import and Parity

Run after Git sync:

```sh
NODE_OPTIONS=--dns-result-order=ipv4first npm run db:import-json -- --verify
NODE_OPTIONS=--dns-result-order=ipv4first npm run db:parity
NODE_OPTIONS=--dns-result-order=ipv4first npm run test:content-store
NODE_OPTIONS=--dns-result-order=ipv4first npm run db:status
```

If DB access fails:

- Check Hostinger remote DB allowlist for current IPv4 and IPv6 routes.
- Keep `CONTENT_SOURCE=json`.
- Do not treat DB import failure as permission to switch serving mode.

## Search Console Indexing Request

After deploy and live checks:

1. Open Google Search Console URL Inspection.
2. Inspect canonical `seo.slug` URLs only.
3. Request indexing for newly verified public pages.
4. Do not request indexing for draft, entity-key-shaped, or `needs_verification` URLs.
5. Confirm sitemap contains the canonical URLs and no drafts.

For RC13, the canonical URLs are:

- `https://jntustack.com/universal-human-values-jntuk-r23-ece-2-1/`
- `https://jntustack.com/microprocessors-and-microcontrollers-jntuk-r23-cse-3-1/`
