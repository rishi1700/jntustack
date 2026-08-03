# Content Operations Runbook

Last updated: 2026-07-26 after reconciling the completed 2026-07-18 trust-root
bootstrap, protected-main cutover, production deploy, and database parity.

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
- Storage errors must fail closed under every provider. Never copy evidence to a
  different provider as a silent fallback.
- Production local evidence must use an absolute `ASSET_STORAGE_ROOT` outside
  the deployed `nodejs` tree and `public_html`. Never acknowledge persistence
  until the same marker survives two distinct deployments.
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
npm run test:deployment-provenance
npm run test:db-json-prune
npm run test:source-security
npm run test:publishing
npm run test:publication-artifact
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

### JSON → MySQL mirror maintenance

Use **Advanced → System checks → JSON → MySQL mirror maintenance** when remote
MySQL access from a workstation is unavailable. The action runs inside the
authenticated Hostinger application and does not expose MySQL publicly.

1. Run **Check parity** first. It is read-only and is the default after every
   page load and result.
2. Use **Sync JSON into MySQL** for an idempotent upsert. It never deletes.
   If its writes commit but a later parity/audit check fails, the result is
   `committed_with_postcheck_attention`; run parity before another sync.
3. Use **Preview obsolete mirror rows** to inspect every obsolete/missing count,
   bounded key list, and foreign-key blocker without writing content or audit
   rows.
4. Use **Sync and prune obsolete mirror rows** only after reviewing that
   preview. Copy its exact plan-bound
   `DELETE_OBSOLETE_MIRROR_RECORDS:<sha256>` token; a static phrase, stale
   preview, or changed candidate set is rejected. Apply also requires a full
   authoritative import, the approved baseline counts, no retained foreign-key
   references, before-image audit rows, and exact post-prune stable-ID equality.
   The destructive transaction also writes a request/plan-bound
   `content_sync.authoritative_prune_committed` marker after its final assertions
   and before `COMMIT`. On a lost COMMIT acknowledgement, the application opens
   a fresh connection. The exact marker proves whether the transaction
   committed. A matching authoritative-content digest, fresh exact-key snapshot,
   parity, and `CONTENT_SOURCE=json` are additionally required for
   `committed_reconciled`; marker evidence with a failed post-check is reported
   as `committed_with_postcheck_attention` and must not be reapplied.

The route additionally requires the owner session, same-origin request
validation, and a per-session/action CSRF token. It has bounded request, query,
and log sizes plus application and MariaDB locks. Primary maintenance is capped
at 45 seconds, fresh-connection reconciliation at 8 seconds, and final
diagnostics at 3 seconds (about 56 seconds maximum end to end). Write attempts
record a started audit and then attempt a completed or failed audit when the
outcome is conclusive; the result states when an unsafe connection prevented
that follow-up audit. A lost START acknowledgement discards the connection and
is a failed phase start because no phase callback/data work ran. A lost COMMIT
or ROLLBACK acknowledgement is inconclusive and is never mislabeled failed. If
durable proof is absent or unavailable, rerun parity and a fresh prune preview
before deciding whether to retry. Keep `CONTENT_SOURCE=json`; the operation
refuses to run otherwise and never changes the serving source.

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
- The selected production design stores local bytes under an absolute private
  Hostinger filesystem root. MySQL remains the canonical inventory for each
  asset's provider, immutable key, checksum, size, and provenance.
- A physical move to the persistent root must preserve every existing local
  `storage_key` exactly and verify both source and destination against the
  MySQL checksum. It must not silently rename keys, change providers, or delete
  the old copy.
- R2 remains an optional private alternative. R2 rows are read privately and
  checksum-verified before parsing; there is never a public bucket URL or
  silent local fallback.
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

Confirm all 26 migrations are applied, including
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

ASSET_STORAGE_PROVIDER=local
ASSET_STORAGE_ROOT=/absolute/hostinger/account/path/jntustack-private-assets
ASSET_STORAGE_EXPECTED_ID=<stable-private-store-id>
ASSET_STORAGE_PERSISTENCE_VERIFIED=false
```

This is the fail-closed preparation template. Current production completed
these gates and runs with both `ASSET_STORAGE_PERSISTENCE_VERIFIED=true` and
`GITHUB_PUBLICATION_TRUST_READY=true`; do not toggle either gate as part of a
normal content release.

### Hostinger persistent asset root

The selected architecture is the existing Hostinger MySQL database plus a
private Hostinger filesystem directory for immutable asset bytes. MySQL stores
provider/key/checksum inventory and workflow metadata; it does not contain the
source files themselves.

1. In hPanel, create or identify a private account directory whose absolute
   path is outside both the deployed `nodejs` release tree and `public_html`.
   The path shown above is a placeholder, not a known Hostinger account path.
   Do not use a relative path, the repository checkout, `dist/`, `tmp/`, or the
   repository-local `storage/` directory. The application rejects a configured
   root, descendant directory, or file that is owned by another user or grants
   any group/world permission; use mode `0700` for directories and `0600` for
   files, including migrated objects.
2. Assign a stable, non-secret identity of 16–128 letters, numbers, dots,
   underscores, or hyphens in `ASSET_STORAGE_EXPECTED_ID`. Keep the same ID for
   the lifetime of that store; a different root must receive a different ID.
3. Set `ASSET_STORAGE_PERSISTENCE_VERIFIED=false`. Keep
   `GITHUB_PUBLICATION_TRUST_READY=false` throughout preparation, migration,
   and testing.
4. Deploy commit A and open **Advanced → System checks**. The bounded
   write/read/checksum/delete probe must pass. The first check atomically seeds
   `health/deployment-persistence.json` and reports
   `seeded_waiting_for_new_deploy`.
5. On the same deployment, another check must report
   `waiting_for_new_deploy`; this is not persistence proof.
6. Deploy a distinct commit B with exactly the same `ASSET_STORAGE_ROOT` and
   `ASSET_STORAGE_EXPECTED_ID`. System checks must read the commit-A marker and
   report `verified_not_acknowledged`.
7. Record both commit SHAs, the expected store ID, and the verification time.
   Only then set `ASSET_STORAGE_PERSISTENCE_VERIFIED=true` and restart/redeploy.
   System checks must report `verified` and publication readiness. This setting
   is the operator's explicit acknowledgement; do not set it merely to clear a
   warning.

The persistence marker is bounded, private, and store-ID-bound. Do not edit,
copy between roots, or regenerate it manually. A missing/invalid marker, same
deployment SHA, store-ID mismatch, symlinked path, failed I/O probe, or false
acknowledgement keeps publication blocked.

### MySQL inventory and key-preserving checksum migration

Before moving any existing local objects, take a MySQL backup and export a
private provider/key inventory. These queries expose no credentials, but their
output is operational evidence and must not be committed:

```sql
SELECT COALESCE(NULLIF(TRIM(storage_provider), ''), 'local') AS effective_provider,
       COUNT(*) AS rows_total,
       COUNT(DISTINCT storage_key) AS distinct_keys,
       SUM(storage_key IS NULL OR TRIM(storage_key) = '') AS missing_keys,
       SUM(COALESCE(sha256_checksum, checksum) IS NULL
           OR COALESCE(sha256_checksum, checksum)
              NOT REGEXP '^[0-9A-Fa-f]{64}$') AS invalid_checksums
FROM source_assets
GROUP BY effective_provider
ORDER BY effective_provider;

SELECT COALESCE(NULLIF(TRIM(storage_provider), ''), 'local') AS effective_provider,
       storage_key,
       COUNT(DISTINCT LOWER(COALESCE(sha256_checksum, checksum))) AS checksum_count
FROM source_assets
WHERE storage_key IS NOT NULL AND TRIM(storage_key) <> ''
GROUP BY effective_provider, storage_key
HAVING COUNT(DISTINCT LOWER(COALESCE(sha256_checksum, checksum))) > 1;

SELECT id,
       COALESCE(NULLIF(TRIM(storage_provider), ''), 'local') AS effective_provider,
       storage_key,
       LOWER(COALESCE(sha256_checksum, checksum)) AS expected_sha256,
       file_size, download_status
FROM source_assets
ORDER BY effective_provider, storage_key, id;
```

The conflicting-checksum query must return zero rows. Resolve missing keys,
invalid checksums, unsafe keys, and conflicts through a separately reviewed
repair before copying bytes.

For each distinct row whose provider is `local`:

1. Treat `storage_key` as the immutable relative identity. It must be a safe
   `source-assets/...` key, never an absolute path or a path containing `..`.
2. Hash the old object and require exact equality with
   `LOWER(COALESCE(sha256_checksum, checksum))`.
3. Copy it to `ASSET_STORAGE_ROOT/<storage_key>` without changing any key
   segment. Use private directories/files and never overwrite a different
   checksum.
4. Hash the destination, compare size, and record the result in a private
   migration manifest.
5. Leave `source_assets.id`, `storage_provider`, `storage_key`, checksum fields,
   duplicate/version links, and parse provenance unchanged. This is a physical
   root migration, not a provider or identity migration.

After every expected local key has a verified destination, switch the app to
the absolute root, run System checks, open representative asset records, and
run representative parsers. Keep the old copy read-only through the rollback
window. Do not delete it until the two-deploy persistence check and the staging
restore drill below both pass. Existing R2 rows, if any, remain R2 rows and
still require R2 credentials; moving R2 objects to local is a separate reviewed
provider migration.

### Asset and database backup/restore

Treat MySQL and `ASSET_STORAGE_ROOT` as one recoverable evidence set:

1. Pause asset writes or record a clear cutoff time. Create a consistent MySQL
   logical dump using hPanel export or a protected client configuration; never
   put the database password in shell history.
2. Create a private archive of the complete asset root, including the
   persistence marker, plus a manifest of every relative key, byte size, and
   SHA-256. Hash the archive and the database dump.
3. Copy the dump, archive, manifests, and checksums to encrypted off-host
   storage. A file under the deployed checkout, `tmp/`, `public_html`, or the
   same Hostinger filesystem is not an off-host backup.
4. Record cutoff time, asset count/bytes, store ID, database dump checksum,
   archive checksum, operator, and off-host retention location.

Do **not** claim that Hostinger automatic/account backups cover an external
`ASSET_STORAGE_ROOT` until a documented Hostinger restore proves that exact
path is included. Even after that proof, retain an independent off-host copy.

Before production cutover and periodically thereafter, perform a staging
restore drill:

1. Restore the logical dump into an isolated staging database and extract the
   asset archive into a new isolated absolute root.
2. Configure staging with its own DB credentials and the restored root. Keep
   `CONTENT_SOURCE=json`, `GITHUB_PUBLICATION_TRUST_READY=false`, and all
   production GitHub App/publication credentials disconnected.
3. Re-run the provider/key inventory. Require the same counts, zero key/checksum
   conflicts, every local key present, and every restored SHA-256 equal to its
   MySQL checksum.
4. Run System checks and representative asset reads/parsers. Verify duplicate
   and supersession chains still resolve to the same keys.
5. Record restore duration, checks performed, failures, fixes, and final
   pass/fail. A backup is not operationally verified until this drill passes.

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

Cloudflare R2 is an optional alternative, not the selected production store. If
it is deliberately selected, replace the local variables with
`ASSET_STORAGE_PROVIDER=r2`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, and `R2_BUCKET`. `R2_ENDPOINT` is optional; the adapter
derives the standard account endpoint. Keep the bucket private, scope the token
to object read/write for that bucket, and complete the same inventory,
off-host-backup, and staging-restore discipline. There is no local fallback
when `ASSET_STORAGE_PROVIDER=r2`.

Register a repository-only GitHub App with:

- Metadata: read
- Contents: read and write
- Pull requests: read and write
- Checks: read
- Commit statuses: read

Do not grant Administration, Workflows, Actions write, or branch-protection
bypass permissions. Store the private key as base64 in the deployment secret
rather than committing a PEM file.

The repository trust boundary was completed on 2026-07-18:

1. The separate trust-root-only bootstrap (`008a0c2`) added
   `.github/CODEOWNERS`, pinned workflows, and the base-owned artifact verifier
   before application/content code.
2. `main` was protected with strict, up-to-date `verify` and
   `publication-integrity` checks bound to GitHub Actions; one code-owner
   approval; stale-review dismissal; last-push approval by someone other than
   the pusher; conversation resolution; linear history; administrator
   enforcement; and no force pushes or deletions.
3. The implementation cutover reached `main` at `962f05d`; both required jobs
   passed, Hostinger deployed the commit, and all 413 sitemap URLs returned HTTP
   200.
4. Production MySQL reached 26/26 migrations and exact JSON parity after the
   verified backup, import, and audited removal of 21 obsolete mirror rows.
5. The selected persistent asset root passed its distinct-deploy survival
   proof, all 10 legacy assets were recovered under unchanged keys, the paired
   off-host restore drill passed, and the notes-only publisher trial completed.

Keep the GitHub App off reviewer and bypass lists. Require at least one human
approval for every PR, and do not weaken the completed branch controls. The
publication-integrity job runs from the trusted base branch and never executes
PR code. GitHub secret scanning, push protection, and Dependabot security
updates are enabled, and the required verification workflow rejects
high-severity npm audit findings; keep those controls enabled.

Publication is active in guarded GitHub-PR mode. The dedicated publication key
(`2026-07`), matching Actions public-key ring, repository-only GitHub App
credentials, and private signing key are deployed. The persistent root proof,
explicit acknowledgement, key-preserving migration, paired restore drill, and
notes-only production trial are complete. Production runs with
`GITHUB_PUBLICATION_TRUST_READY=true`, but that gate authorizes review-PR
creation only: it does not authorize automatic merge, direct writes to `main`,
or branch-protection bypass.

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

The notes-only trial is complete. Keep the first real content publication small
and operator-observed. Confirm its deterministic artifact, required CI, human
merge, Hostinger deployment, `/release.json` attestation, JSON-to-MySQL import,
and final parity before increasing batch size.

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
the GitHub/persistent-evidence workflow has completed its trial and operated
reliably under human review. `/api/ask` also remains disabled.
