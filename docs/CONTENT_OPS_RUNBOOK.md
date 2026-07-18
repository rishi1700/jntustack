# Content Operations Runbook

Last updated: 2026-07-18 after the immutable evidence-storage and GitHub PR
publishing foundation was introduced.

This runbook is for controlled content work. It does not authorize broad rewrites, unverified publishing, crawler/scheduler work, `/api/ask`, or DB-backed serving.

## Hard Rules

- Never publish `needs_verification` content.
- Never mark a subject `verified` without human source review.
- Never expose `/api/ask` without rate limiting and final model testing.
- Never switch `CONTENT_SOURCE=db` until explicitly approved.
- Never assume `entity_key == URL slug`; use `seo.slug || id` for public URL checks.
- After any legacy guarded live apply, immediately sync Git and update the DB mirror.
- Do not manually edit live JSON if the guarded apply workflow has failed; use resume, recovery, or rollback paths.
- GitHub publication creates a review PR only. The publisher must never merge, bypass branch protection, or write directly to `main`.
- In R2 mode, storage errors must fail closed. Never copy evidence into local storage as a silent fallback.
- Do not turn an official listing into a standalone page when the source does
  not provide enough content for one. Use `publication.mode = "listing_only"`.

## Simple Admin Workflow

The primary admin navigation follows owner tasks rather than database tables:

1. **Today** shows the next safe action and any blocked automation, review, release, or Git reconciliation work.
2. **Start an update** fetches an official URL or stores an uploaded source file, then runs the guarded parse → extract → validate → diff pipeline.
3. **Review** combines existing `needs_verification` drafts and DB-backed proposed changes. Automation stops here for a human decision.
4. **Publish** prepares a small approved release, seals its durable plan, creates
   a review PR, and tracks CI, human merge, Hostinger deploy, and attestation.
5. **Content** provides the read-only libraries and source freshness review cadence.

Parsers, extraction rows, diffs, source assets, revisions, checks, cleanup, and recovery tools remain available under **Advanced**. Use them when a guided run stops or when an audit needs the raw artifact trail.

Freshness is calculated from recorded source retrieval dates. The default review window is 180 days and can be changed with `CONTENT_REVIEW_DAYS` (30–730). A “current” label means the source was reviewed within that window; it does not prove the upstream document is unchanged. Open the official source before approving any content change.

## Current Content and Search Contract

The validated inventory is 436 source-verified subject records. Publication is
separate from source verification:

- 403 records use page mode and generate canonical subject pages.
- 33 records use `listing_only`: 30 internship/project milestones and three
  Entrepreneurship Development & Venture Creation listings. They appear on
  branch/semester hubs but generate no standalone page, Course structured data,
  sitemap entry, or standalone search document.
- One verified `/r23-internships-and-projects/` guide supplies the useful public
  destination for the internship milestones.

Shared subjects may use `offerings[]`. Each row keeps branch codes, year,
semester, and credits together. Review and diff the whole offering row; never
flatten branch and semester into independent lists, because doing so invents
invalid combinations.

Public search contains 786 documents: 403 subjects, 376 colleges, six branch
profiles, and one guide. The shared deterministic ranker uses weighted primary,
metadata, heading, and body fields; IDF; exact phrase bonuses; typed intent; and
exact academic/district filters. Branch and semester must match the same
offering. Listing-only and unverified records are excluded as standalone
results, while internship listing contexts feed the single guide. Do not add a
second browser/server matcher, embeddings, or an external search service
without a separately reviewed search migration.

## Standard Commands

Local checks:

```sh
npm run test:parsers
npm run test:admin-ui
npm run test:source-security
npm run test:publishing
npm run build
npm run test:retrieve
npm run test:content-store
npm run audit:site
```

### Migration interruption safety

Run schema migrations manually against a staging clone first and take a verified
database backup before production. The migration runner serializes execution with
a MySQL named lock and records every SQL statement in
`schema_migration_steps` as `running`, `applied`, or `failed`. This makes an
implicit-commit DDL interruption visible instead of blindly replaying an
already-applied `ALTER TABLE`.

If `npm run db:status` reports a partial migration, stop publication and inspect:

```sql
SELECT migration_id, step_index, statement_checksum, status, last_error,
       started_at, applied_at
FROM schema_migration_steps
WHERE migration_id = '026_github_publication_foundation'
ORDER BY step_index;
```

Compare the numbered statement in the migration file with `information_schema`
and the staging clone. If the statement was fully applied, an operator may mark
that exact step `applied`; if it was definitely not applied, delete only that
step row and rerun. If its outcome is partial or uncertain, restore the backup or
perform a separately reviewed schema repair—never delete the step row and hope a
rerun is safe. Do not set `GITHUB_PUBLICATION_TRUST_READY=true` until migration
026 is recorded as fully applied.

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
   - storage provider and immutable storage key
   - local path for legacy/local assets, or R2 ETag for remote assets
   - download/fetch status
4. If metadata exists but the storage object is missing or corrupt, use the asset
   repair action. Same-checksum corruption uses a new immutable recovery key.
   Changed source bytes create a new `source_assets` version linked through
   `supersedes_asset_id`; the original checksum, row, and parse provenance remain
   immutable. Every outcome records audit events.

Safe source fetch constraints:

- HTTP/HTTPS only.
- Source URL must belong to the configured source domain.
- Every resolved address is validated and the accepted address is pinned into
  the HTTP(S) connection; private/reserved IPv4, mapped IPv4, unsafe IPv6, and
  DNS-rebinding targets are blocked.
- Every redirect is revalidated and requested/resolved URLs are stored separately.
- Credential-bearing or sensitive-token query URLs are rejected rather than
  persisted in admin/audit data.
- Absolute request/body deadlines and response-size limits block stalled or
  oversized downloads.
- Re-fetch reuses an exact existing version; changed official bytes create a
  linked immutable version rather than mutating evidence in place.
- New assets use content-addressed keys (`source-assets/sha256/...`) through the configured storage adapter.
- Existing local rows remain readable after the R2 cutover. They are not silently migrated or deleted.
- R2 assets are read privately and checksum-verified before parsing; they do not need a public bucket URL or persistent local copy.
- A missing checksum, oversized object, or checksum mismatch creates a failed parse result and blocks downstream proposal creation. Repair from the official source instead of bypassing the check.

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
- release has no existing active GitHub publication or legacy live-apply row

Tmp files under `tmp/release-apply-plans/` are convenience artifacts only. MySQL is canonical.

## Legacy Guarded Live Apply (Recovery Only)

Do not start a new production release here after GitHub PR mode is enabled.
This path remains documented so releases created before cutover can be audited,
recovered, verified, or rolled back safely.

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

## Legacy Git Sync

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

- Subject records: 436
- Verified: 436
- Standalone subject pages: 403
- Verified listing-only records: 33
- Needs verification: 0
- Editorial guides: 1
- Colleges: 376
- Branch profiles: 6
- Search docs: 786
- Sitemap URLs: 413
- Migration files: 26

## GitHub PR Publication Mode

The GitHub publisher is the fail-safe default for new releases. Existing rows
migrated with `publication_mode=legacy` retain their recovery workflow. Set
`CONTENT_PUBLICATION_MODE=legacy` only as an explicit cutover-recovery override.

Apply all 26 migrations, including
`026_github_publication_foundation.sql`, then set:

```sh
CONTENT_PUBLICATION_MODE=github_pr
GITHUB_PUBLICATION_TRUST_READY=false

GITHUB_APP_ID=...
GITHUB_APP_INSTALLATION_ID=...
GITHUB_APP_PRIVATE_KEY_BASE64=...
GITHUB_REPOSITORY_OWNER=...
GITHUB_REPOSITORY_NAME=...
GITHUB_DEFAULT_BRANCH=main
PUBLICATION_SIGNING_KEY_ID=2026-07
PUBLICATION_SIGNING_PRIVATE_KEY_BASE64=...

ASSET_STORAGE_PROVIDER=r2
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=jntustack-source-evidence
```

Create a dedicated publication-signing key. Do not reuse the GitHub App key and
never commit the private key:

```sh
umask 077
PUBLICATION_KEY_DIR="$(mktemp -d)"
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$PUBLICATION_KEY_DIR/private.pem"
openssl pkey -in "$PUBLICATION_KEY_DIR/private.pem" -pubout -out "$PUBLICATION_KEY_DIR/public.pem"
base64 < "$PUBLICATION_KEY_DIR/private.pem" | tr -d '\n'
base64 < "$PUBLICATION_KEY_DIR/public.pem" | tr -d '\n'
```

Put the private base64 value and key ID in the deployment environment. Add the
matching public value as a GitHub Actions repository variable named
`PUBLICATION_SIGNING_PUBLIC_KEYS_JSON`:

```json
{"2026-07":"<base64-SPKI-public-PEM>"}
```

After both values are stored in their secret/configuration systems, securely
delete the temporary directory (`rm -rf "$PUBLICATION_KEY_DIR"`). PEM files are
also ignored by git as a final guard; do not generate or retain private keys in
the repository working tree.

For rotation, add the new public key before switching the deployment key and
retain each old public key until every database publication with that
`signing_key_id` is terminal and no retry or open PR can still use it. A
`preparing` or `failed` row may not have a PR yet but still reuses its original
signed bytes. The exact signed manifest bytes are stored with the publication,
so interrupted retries do not change identity during rotation.

`R2_ENDPOINT` is optional; the adapter derives the standard account endpoint.
Keep the bucket private and scope the token to object read/write for that bucket.
There is no local fallback when `ASSET_STORAGE_PROVIDER=r2`.

Register a repository-only GitHub App with:

- Metadata: read
- Contents: read and write
- Pull requests: read and write
- Checks: read
- Commit statuses: read

Do not grant Administration, Workflows, Actions write, or branch-protection
bypass permissions. Protect `main`, require pull requests and code-owner review,
require branches to be up to date, bind both the `verify` and
`publication-integrity` required checks to GitHub Actions, dismiss stale
approvals, require approval of the most recent push by someone other than its
pusher, prohibit direct and force pushes, and configure no bypass actors. Require
at least one human approval on every PR; keep the GitHub App off the reviewer and
bypass lists. The latter check runs from the trusted base branch and never
executes PR code.
Store the private key as base64 in the deployment secret rather than committing
a PEM file.

GitHub returned `403` when branch protection was checked for the current private
repository on 2026-07-18 because the account plan does not provide it. Publication
is therefore an installed but inactive foundation: upgrade the account or make
the repository public, configure and independently verify the rules above, and
only then set `GITHUB_PUBLICATION_TRUST_READY=true`. The publisher refuses to
create PRs while this gate is false. `CODEOWNERS` protects trust-root paths once
code-owner enforcement is available, and workflow actions are pinned by full
commit SHA.

The current `main` branch does not yet contain the base-owned verifier, so the
first protected publication PR cannot bootstrap it. Make a separately reviewed,
one-time trust-root change containing only `.github/CODEOWNERS`, the pinned
workflows, and `scripts/verify-publication-artifact.js`; verify that exact diff
and every action SHA out of band. Do not include content or application changes
in this bootstrap. After it lands, enable and independently test the rules,
configure the public-key ring, and only then rebase and sign publication work.

Publication requires the exact confirmation phrase:

```text
CREATE REVIEW PR
```

For each approved release, the publisher:

1. Reads the current `main` commit and reviewed target files through the App.
2. Replays the approved patch and rejects stale before-values.
3. Seals a canonical artifact hash plus before/after file hashes and byte sizes in MySQL, then signs the complete manifest with the dedicated publication key.
4. Creates one deterministic branch, one commit, and one review PR.
5. Adds `data/release-artifact.json` and `data/release.json`; required CI verifies the exact base, parent, repository, branch, changed paths, hashes, and sizes before merge. The build exposes the marker as `/release.json` for deployment verification.
6. Waits for a human merge. It exposes no automatic merge operation.
7. Verifies `/release.json`, `/health`, and `/sitemap.xml` after Hostinger deploys.

Important publication states:

- `pr_open`: awaiting checks/review/human merge.
- `ci_failed`: PR stays open but is not mergeable under branch protection.
- `blocked_stale_base`: terminal for this release; close the PR and prepare a fresh release candidate and human review.
- `tampered`: deterministic branch/head/content changed; do not merge it.
- `closed_unmerged`: terminal; prepare a new reviewed release if still needed.
- `deploy_pending`: merged, waiting for Hostinger attestation.
- `verification_inconclusive`: a timeout, network error, 5xx, oversized response, older live release, or invalid temporary response prevented a safe conclusion. Retry later; do not recommend a revert.
- `verification_failed`: a valid marker names this exact release but carries a different artifact hash. This is a conclusive mismatch, so prepare a revert PR rather than editing live JSON.
- `deployed`: live release ID and artifact hash match the reviewed PR.
- `superseded`: a valid newer release is already live. Keep this as historical evidence; no revert is recommended.

Before enabling this for real content, run a notes-only or listing-only trial whose
public output is unchanged. Confirm deterministic retry behavior, required CI,
human merge, Hostinger deployment, live attestation, and fail-closed behavior with
temporarily invalid credentials.

Local foundation check:

```sh
npm run test:publishing
npm run test:publication-artifact
```

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

## Deployment and Search Console Observation

Use Search Console as the only traffic/indexing measurement system for this
release. Do not add GA4, Plausible, or another analytics script. Google controls
crawl and indexing timing; the operational goal is an accepted sitemap,
eligible canonical pages, no technical warnings, and a recorded trend—not a
promise that all URLs will be indexed.

Maintain one release observation row with the deploy time, release ID/artifact
hash, sitemap status, indexed/excluded totals, top exclusion reasons,
impressions, clicks, CTR, average position, inspected URLs, and notes. Record
the same fields on every checkpoint so deltas are comparable.

### Day 0 — Deploy and baseline

1. Confirm the reviewed PR is human-merged and required `verify` CI passed.
2. Wait for Hostinger, then verify HTTP 200 for `/`, `/health`, `/release.json`,
   `/sitemap.xml`, the internship guide, and representative changed canonical
   subject pages. Confirm `/release.json` matches the reviewed release ID and
   artifact hash.
3. Confirm the sitemap contains exactly 413 URLs, includes all 403 subject
   pages and the guide, and excludes all 33 listing-only records and every
   legacy redirect source.
4. Test representative retired semester-specific URLs for direct HTTP 301 to
   their neutral canonical target. Confirm there are no chains or loops.
5. In Search Console, resubmit `https://jntustack.com/sitemap.xml`. Record its
   status, last-read time, and discovered-page count.
6. Record the Page indexing baseline: indexed, not indexed, and every displayed
   exclusion reason/count. Record the Performance baseline for clicks,
   impressions, CTR, and average position using the same date window that will
   be used later.
7. Use URL Inspection on a small priority cohort: the internship guide, both
   newly completed R16 pages, representative neutral first-year canonicals, and
   one unchanged control page. Confirm the declared/selected canonical and
   crawl eligibility. Request indexing only for eligible canonical pages that
   are new or materially changed.
8. Never request indexing for listing-only rows, draft/entity-key URLs, redirect
   sources, or URLs absent from the sitemap.

### Day 7 — Early crawl check

1. Record the same sitemap, Page indexing, and Performance fields and calculate
   deltas from day 0.
2. Reinspect the priority cohort plus two random changed pages. Note whether
   Google has discovered, crawled, selected the intended canonical, or reported
   a technical issue.
3. If a technical issue exists—robots blocking, redirect error, canonical
   mismatch, server error, or sitemap inconsistency—fix and redeploy it through
   the normal review-PR workflow. Do not churn content merely because a valid
   page is still “Discovered - currently not indexed.”

### Day 14 — Trend and query check

1. Repeat the measurements and compare day 0 → 7 → 14.
2. Review Search Console Pages and Queries reports for the guide, R16 pages,
   neutral first-year pages, and representative branch hubs. Record emerging
   impressions even when clicks remain zero.
3. Validate a Search Console issue only when its sample URLs share a real
   technical cause. Record “no technical defect observed” when crawl eligibility
   and canonical signals are correct.

### Day 28 — Cohort decision

1. Record the final checkpoint and summarize four-week changes in indexed
   pages, exclusion reasons, impressions, clicks, CTR, and average position.
2. Classify each priority URL as indexed, crawled-not-indexed,
   discovered-not-indexed, or technically blocked.
3. Open follow-up work only for evidence-backed technical or content-quality
   patterns. Keep monitoring healthy but slow-indexing URLs instead of repeatedly
   requesting indexing.
4. Preserve the completed observation row as the baseline for the next release.

## Deferred Automation and Monetization

Natural-language content requests, LLM generation, n8n orchestration, Telegram
approval, automatic merge/rollback, and the affiliate-books pilot remain design
notes only. They must not be connected to the production publishing path until
the GitHub/R2 workflow has completed its trial and operated reliably under
human review. `/api/ask` also remains disabled.
