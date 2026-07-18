# JNTUStack

Domain: jntustack.com (primary, **registered 2026-06-30, expires
2027-06-30**) + jntustack.in (intended .com redirect, **not yet registered**).

Hosting: **Hostinger Node.js Apps** (hPanel, Business/Cloud plan), deployed
via GitHub. Not Cloudflare Pages -- that was the original plan, changed
mid-build, and the architecture below reflects the current (Hostinger)
target.

**Current repository state (2026-07-18):** the site deploys to Hostinger as a
Node.js/Express app via GitHub auto-deploy, entry `server.js`, Node 24. The
validated build contains 436 verified subject records: 403 standalone pages and
33 listing-only official milestones, plus one editorial guide, 376 colleges,
six branch profiles, 786 search documents, and 413 sitemap URLs. Production
public serving remains `CONTENT_SOURCE=json`; `/api/ask` remains disabled.

## What this is

A custom Node.js site: a static-site generator (no frontend framework, plain
template literals driven by `data/*.json`) plus a thin Express server that
serves the generated output and private admin workflows. `/api/ask` is
feature-gated and must remain disabled unless explicitly approved.

## Documentation map

- `README.md` -- setup, deployment notes, and common commands.
- `docs/CURRENT_STATE.md` -- current production state, counts, flags, parser
  support, and known risks.
- `docs/CONTENT_OPS_RUNBOOK.md` -- content/admin operating procedure from
  source evidence through Git sync, DB parity, and indexing requests.
- `docs/NLP_CONTENT_AUTOMATION.md` -- planned natural-language request,
  evidence, Telegram approval, and GitHub-first publishing design. This is a
  future design, not an active workflow.
- `docs/AFFILIATE_BOOKS_MONETIZATION.md` -- planned syllabus-bibliography and
  affiliate-books pilot, including evidence, disclosure, data separation, and
  rollout guardrails. This is not currently active.
- Original handoff notes -- historical context only. Do not use old handoff
  text as the source of truth for current counts or operations.

## Quick start (local)

```
npm install
npm run build      # generates dist/ AND dist/search-index.json
npm run test:retrieve
npm run test:publishing
npm start          # boots server.js on process.env.PORT (defaults to 3000)
```

Database utilities are present, but the public site still builds from JSON by
default. Leave `CONTENT_SOURCE` unset, or set `CONTENT_SOURCE=json`, unless you
are explicitly testing a future database-backed content adapter.

Tested and confirmed working: static file serving, `/health`, JSON content
builds, retrieval checks, and the admin login gate. `/api/ask` is not exposed
while `ASK_ENABLED=false`.

## Deploying to Hostinger

1. Push this repo to GitHub.
2. hPanel -> Websites -> Add Website -> Node.js Apps -> connect the repo.
   Hostinger should auto-detect Express from package.json; if not, select
   "Other" manually.
3. Keep `ASK_ENABLED=false` unless `/api/ask` is explicitly approved for
   production. Do not set or expose model API keys until that happens.
4. Hostinger sets `PORT` itself -- server.js already defers to
   `process.env.PORT`, don't hardcode a port anywhere.
5. The `postinstall` script runs `npm run build`, which generates `dist/` and
   `dist/search-index.json` on Hostinger deploy. Do not remove this unless the
   hPanel build command is configured to run the same build explicitly.
6. Connect jntustack.com to the deployed app. Current production uses GitHub
   auto-deploy, not manual archive upload.

### GitHub/R2 production publishing setup

New reviewed releases use the GitHub PR publisher by default. Existing rows
created before migration 026 remain `legacy`; set `CONTENT_PUBLICATION_MODE=legacy`
only as a deliberate cutover-recovery measure and never change it mid-release.

1. Confirm all 26 migrations are applied, including
   `026_github_publication_foundation.sql`. Production recorded 26/26 applied
   on 2026-07-18 after a verified logical backup.
2. Create the private Cloudflare R2 bucket `jntustack-source-evidence` and a
   bucket-scoped object read/write token. Do not expose a public bucket URL.
3. Register a repository-only GitHub App with Metadata read, Contents
   read/write, Pull Requests read/write, Checks read, and Commit statuses read.
   Do not grant Administration, Workflows, or branch-protection bypass permissions.
4. Protect `main`: require pull requests and code-owner review, require branches
   to be up to date, bind both the `verify` and `publication-integrity` required
   checks to GitHub Actions, dismiss stale approvals, require approval of the
   most recent push by someone other than its pusher, prohibit direct/force
   pushes, and configure no bypass actors. A human must approve and merge every
   publication PR; the GitHub App must never be a reviewer or bypass actor. The
   repository became public on 2026-07-18, making the required branch controls
   available; they must still be configured and independently verified before
   activating publication.
   Because the current `main` predates the trusted verifier, bootstrap only
   `.github/CODEOWNERS`, the pinned workflows, and
   `scripts/verify-publication-artifact.js` in a separately reviewed one-time
   trust-root change before enabling these rules. Do not combine that bootstrap
   with content. The bootstrap cannot approve itself; verify its exact diff and
   action SHAs out of band, then enable the rules and rebase/sign content work.
5. Configure Hostinger secrets:

   ```text
   CONTENT_PUBLICATION_MODE=github_pr
   GITHUB_PUBLICATION_TRUST_READY=false
   ASSET_STORAGE_PROVIDER=r2
   R2_ACCOUNT_ID=...
   R2_ACCESS_KEY_ID=...
   R2_SECRET_ACCESS_KEY=...
   R2_BUCKET=jntustack-source-evidence
   GITHUB_APP_ID=...
   GITHUB_APP_INSTALLATION_ID=...
   GITHUB_APP_PRIVATE_KEY_BASE64=...
   GITHUB_REPOSITORY_OWNER=...
   GITHUB_REPOSITORY_NAME=...
   GITHUB_DEFAULT_BRANCH=main
   PUBLICATION_SIGNING_KEY_ID=2026-07
   PUBLICATION_SIGNING_PRIVATE_KEY_BASE64=...
   ```

6. Add the matching public key as the GitHub Actions repository variable
   `PUBLICATION_SIGNING_PUBLIC_KEYS_JSON`, formatted as
   `{"2026-07":"<base64-SPKI-public-PEM>"}`. Keep retired public keys in this
   keyring until every database publication using that key ID is terminal with
   no retry or open PR remaining.
7. After branch controls are enabled and independently verified, change
   `GITHUB_PUBLICATION_TRUST_READY=true`. This explicit gate keeps PR creation
   disabled while the repository trust boundary is incomplete.
8. Run `npm run test:publishing` and `npm run test:publication-artifact`, then complete a notes-only/listing-only trial
   whose public output is unchanged. Confirm deterministic retry, required CI,
   human merge, Hostinger deployment, and `/release.json` attestation before
   using the path for real content.

R2 evidence is immutable and addressed by SHA-256. Missing, oversized, or
checksum-mismatched objects block the workflow, and production R2 mode never
falls back silently to local storage. Publication requires the exact phrase
`CREATE REVIEW PR`; the publisher can create a branch, commit, and review PR,
but it cannot merge or write directly to `main`. Workflow actions are pinned to
full commits and `CODEOWNERS` covers the publication trust-root files.

## Database foundation

MySQL support backs admin/review workflows and mirrors JSON content for parity.
It is not used by the public build or server boot path while production remains
`CONTENT_SOURCE=json`.

The content loader now has two adapter modes:

- `CONTENT_SOURCE=json` -- default and production-safe. Reads `data/*.json`
  through the existing glob-based loaders.
- `CONTENT_SOURCE=db` -- experimental. Reads the same normalized dataset shape
  from MySQL after migrations/import/parity have succeeded.

Production should remain `CONTENT_SOURCE=json` until DB mode is explicitly
approved. Do not set Hostinger production to `db` just because migrations exist.

## Admin dashboard

The private admin dashboard is disabled by default. When enabled, its primary
workflow is **Today → Start an update → Review → Publish → Content**. The guided
update path stores source evidence and wraps the existing parse, extraction,
validation, diff, and proposal pipeline without weakening human verification or
publishing gates. Technical artifact pages remain under the collapsed Advanced
navigation.

Today also reports source review cadence from recorded retrieval dates. This is
a freshness reminder, not remote change detection: the admin must still open the
official source before approving an update. The review window defaults to 180
days and can be configured with `CONTENT_REVIEW_DAYS` between 30 and 730 days.

Runtime/admin hardening:

- `server.js` logs startup status for `contentSource`, `adminEnabled`,
  `adminConfigured`, `askEnabled`, and Node version only. It never logs
  passwords, hashes, database hosts, or other secret values.
- If `ADMIN_ENABLED=true` but credentials are incomplete, startup logs a clear
  admin configuration error and `/admin` shows a protected configuration error.
- DB-backed admin pages show clear unavailable states when DB env is missing or
  the connection fails. The public JSON-backed site still boots with
  `CONTENT_SOURCE=json`.
- Protected admin checks live at `/admin/checks`. The page reports DB
  connection/migration status, content source, admin/ask flags, storage
  writability, and latest JSON/search-index counts.

Live admin verification checklist:

```
curl -I https://jntustack.com/
curl -I https://jntustack.com/health
curl -I https://jntustack.com/admin
curl -I https://jntustack.com/admin/sources
curl -I https://jntustack.com/admin/assets
curl -I https://jntustack.com/admin/proposals
curl -I https://jntustack.com/admin/revisions
```

Expected unauthenticated behavior:

- `/` returns 200.
- `/health` returns 200.
- `/admin` and protected admin pages redirect to `/admin/login`.
- After login, check `/admin/checks` first, then `/admin/sources`,
  `/admin/assets`, `/admin/proposals`, and `/admin/revisions`.

### Legacy live-apply git reconciliation

This section documents recovery for releases that already use guarded live
apply. It is not the desired path for new production releases after GitHub PR
mode is enabled. Guarded live JSON apply (`lib/release-live-apply.js`) writes straight to
`data/*.json` on whichever host it runs on and never gets git push/remote
credentials -- that's deliberate, to avoid widening attack surface. What it
does do, immediately after verification passes:

- Attempts a **local-only** `git commit`, scoped to exactly the files that
  apply wrote (never `git add -A`). Message format: `Live-apply RC<id>: sync
  <files> [<reviewer>]`.
- On success: `release_live_applies`/`release_candidates.status` advance to
  `committed_pending_push`, with the commit SHA recorded on the row and in
  `audit_log`. **This is fail-safe, not fail-closed**: the apply itself
  already succeeded and the data is already live by this point, so a commit
  failure never unwinds anything above it.
- On failure (most commonly: no `.git` directory on the deployed tree --
  whether that's actually true on the current production host is
  unconfirmed either way; this repo's primary deploy path is Hostinger's
  GitHub auto-deploy integration, whose internal mechanism isn't documented
  anywhere reachable): status stays at `published_pending_deploy(_recovered)`
  exactly as before, but `git_commit_error` is recorded loudly on the row,
  in `audit_log` (`release_live_apply.git_commit_failed`), and in a
  persistent banner on every admin page (see below).

**No deploy-time guard is possible from available tooling.** There is no
shell/file-read access to the live Hostinger host to run `git status` before
a redeploy, and if the host has no `.git` at all (the likely case for
archive-based redeploys), there'd be nothing to check anyway. The
reconciliation state in the DB (`committed_pending_push` /
`git_commit_error`) plus the admin UI banner are the actual guard now --
check the dashboard for a pending banner before redeploying.

The admin dashboard shows a persistent banner on every page whenever any
`release_live_applies` row is `committed_pending_push` (push these before
redeploying) or has a `git_commit_error` recorded (louder: data is live and
genuinely not in git anywhere -- reconcile by hand).

**Six historical rows** (`release_live_applies` ids 2-7, release candidates
7/9/10/11/12/13) predate this mechanism and are stuck at
`published_pending_deploy(_recovered)` with no automatic commit ever
attempted. They were manually cross-referenced against git history and the
live site during the 2026-07-07 session and confirmed already reconciled
(matched to commits `f69d855`/`00f38b0`/`25a8872`/`b96414d`/`6258f4b`/`29ac399`
by exact file-set and, for one, exact content diff; live slugs for the
verified ones confirmed HTTP 200). Nothing auto-migrates them -- run:

```
node scripts/reconcile-live-apply.js 2 3 4 5 6 7 \
  --note="<why you're confident these are reconciled>" \
  --actor=you@example.com
```

This only ever touches the exact ids passed in; there is no blanket/auto
mode, by design (see the script's header comment for the fuller rationale).

The admin review queue is also gated behind `ADMIN_ENABLED=true`, but it is
DB-backed and requires the MySQL migrations to be applied. Review actions only
update `content_proposals`, `review_events`, and `audit_log`; they do not write
to `data/*.json`, do not mark live content as verified, and do not publish
anything to the public site.

Admins can manually create proposals for `subject`, `college`, and
`branch_profile` records. Creation validates the proposed JSON payload and then
writes only to the proposal/review/audit tables. It is not a publishing path.

Source management is also DB-backed and gated behind `ADMIN_ENABLED=true`. It
stores trusted discovery-source configuration in `discovery_sources` plus future
pipeline tables (`source_assets`, `crawl_runs`, `discovered_items`). Source
records are evidence/configuration only: creating or editing a source does not
crawl, fetch, download, parse, create content proposals, write `data/*.json`, or
publish anything. All source create/update/enable/disable actions write to
`audit_log`.

Source assets are immutable raw materials stored before parsing. Manual admin
uploads currently accept PDF, HTML, ZIP, and image files, calculate a SHA-256
checksum, store metadata in `source_assets`, and place the object under a
content-addressed local or private-R2 key:

```
storage/
  source-assets/
    sha256/
      <first-two-hash-characters>/
        <full-sha256>
```

`storage/` is intentionally ignored by git and is never served from `public/`
or `dist/`. If the same SHA-256 checksum already exists, the upload records a
duplicate asset reference and reuses the existing immutable object instead of
writing another copy. If an official URL later returns changed bytes, repair
creates a linked new version rather than changing the original row. Assets are
treated as immutable because they are evidence: later
parsers and reviewers should be able to reproduce exactly what was available at
ingestion time. Updating content must create new proposals or new assets, not
rewrite historical raw material.

The parser framework is DB-backed and manual-only. Parsers are registered by
`parser_key`, run from an asset detail page, and write extracted evidence to
`parse_results`. Parser output is always review material: it does not create
content proposals, does not write `data/*.json`, does not mark anything
verified, and does not publish to the public site. Current parser support is
summarized in `docs/CURRENT_STATE.md`; use `pdf-text-basic` for raw PDF text
review and the source-specific Tirumala/LBRCE PDF parsers only for conservative
course-structure candidate extraction.

Diff results are the next review-only layer. A manual admin action can compare
a `parse_results` row against the current content loaded through the content
store for exact `subject`, `college`, or `branch_profile` keys. The diff engine
stores `existing_payload_json`, parsed/proposed evidence, structured changes,
and confidence metadata in `diff_results`. Diffs do not create proposals
automatically, do not publish, and do not write `data/*.json`.

Admins can manually create a review-queue proposal from a successful diff
result. This links the proposal back to its `parse_result_id` and
`diff_result_id`, copies the diff evidence into `content_proposals`, and records
`create_from_diff` review/audit events. The flow is intentionally:

```
source asset -> parse result -> diff result -> human-created proposal
```

The proposal still starts as `needs_review`; it is not verified, applied,
published, or written to `data/*.json`. Re-opening the same diff result links to
the existing proposal instead of creating a duplicate.

Proposal validation is a review gate, not a publishing path. Manual proposals
and proposals created from diffs are normalized and validated against the
current `data/schema.json` definitions where practical. Validation trims strings,
normalizes whitespace, normalizes subject slugs and branch codes, stores
`validation_status`, `validation_errors_json`, and `normalized_payload_json`,
and prevents ordinary proposal payloads from entering review as `verified`.
Admins can re-run validation from a proposal detail page. A validation pass
still does not approve verification, publish content, or write to
`data/*.json`; verified status requires the verified-promotion review workflow
and guarded release apply path.

Entity extraction sits between raw parser output and diffs. Parsing means
capturing raw evidence from an immutable source asset, such as title text,
headings, links, and a text preview. Extraction means manually asking the admin
workflow to shape that parsed evidence into a `subject`, `college`, or
`branch_profile` candidate. Extraction may use reviewer hints such as
university, regulation, branch, year, or semester, but it must stay
conservative: missing syllabus units, credits, rankings, dates, branches, or
college details remain missing and validation errors are stored for review.

Extraction results are stored in `extraction_results` with confidence metadata
and validation results. Admins can manually create a diff from a successful
extraction result, which compares the entity-shaped candidate against existing
content. Extraction still does not crawl, publish, create proposals
automatically, mark anything verified, or write to `data/*.json`.

Parsers can be generic or source-specific. Generic parsers such as `html-basic`
extract broad evidence from an uploaded asset without assuming source layout.
Source-specific parsers such as `tirumala-syllabus-html` are registered under
explicit parser keys and may be suggested from `discovery_sources.parser_key`.
They still run only when an admin manually starts them against an already stored
asset. Source-specific parser output remains evidence, not verified content.

PDF parsing uses `unpdf` for Node/serverless-friendly text extraction without
OS-level binaries. `pdf-parse` was evaluated first, but its current npm package
pulls in `@napi-rs/canvas`, which is riskier for Hostinger-style managed Node
hosting. `pdf-text-basic` extracts page text only; it does not create proposals
or publish content.

The first source-specific parser emits:

```
evidence_type: source_specific_subject_index
candidates: []
low_confidence_candidates: []
ignored_table_rows: []
source_url
parser_version
evidence_status: needs_review
```

Admins can inspect parsed candidate rows and manually extract one high-confidence
candidate into an `extraction_results` row. Source-specific parsers must keep
generic contact, staff, department, address, navigation, or unclear table rows
out of subject candidates. Unclear rows belong in `low_confidence_candidates` or
`ignored_table_rows` with a reason. Candidate extraction records audit evidence
and still uses validation; missing category/type/year/branch/regulation fields
remain missing unless they are clearly present in the uploaded evidence or
supplied as reviewer hints.

`tirumala-r23-syllabus-pdf` is the first syllabus-specific PDF parser. It reads
already stored PDF assets, extracts text, then looks only for clear
course-structure tables with `S.No`, `Category`, `Title`, `L`, `T`, `P`, and
`Credits` columns. High-confidence candidates require a clear title, category,
type, regulation, branch, year/semester context, and L/T/P values. Ambiguous
rows remain low-confidence or ignored evidence.

Manual source fetch is an evidence-ingestion path for one URL at a time. From a
discovery source detail page, an admin can fetch a URL that belongs to that
source's configured base domain. The fetcher stores the response as a
`source_assets` row, captures requested/resolved URLs, content type, size, ETag,
Last-Modified, checksum, version/duplicate status, and writes `source_fetch.*`
audit events. It validates every DNS result and redirect, pins the accepted
public address into the actual connection, rejects credential/sensitive-token
URLs, and enforces absolute time and size limits. Fetching does not crawl, schedule
jobs, parse, extract, create diffs, create proposals, publish, or write to
`data/*.json`.

The manual evidence pipeline is an admin-only convenience runner for one stored
asset. It can chain existing manual steps:

```
asset -> parser -> extraction + validation -> optional diff -> optional proposal
```

The pipeline is not a scheduler, crawler, or background job. It runs only from
an admin form, records a `pipeline_runs` row and audit events, and never
publishes content or marks anything verified. Proposal creation is controlled by
an explicit checkbox, default off. If extraction validation fails, the pipeline
does not create a proposal in this phase.

Proposal export is the first publishing-adjacent review step, but it still does
not publish. From a proposal detail page, an admin can export the normalized
proposal payload into `tmp/proposal-exports/<proposal-id>/`. The export writes a
review bundle containing `export.json`, `replacement.json`, and `patch.json`,
and stores metadata in `proposal_exports`. Exports validate the payload again
and include validation errors when present. They never modify `data/*.json`,
never modify `dist/`, never mark anything verified, and are intended only for
manual repo review.

Proposal approval is a reviewer accountability state, not a publishing path. A
proposal can be moved to `approved_for_draft` only after validation has passed
and the reviewer provides a note. Approval records the reviewer, timestamp,
validation status, proposal provenance, a `review_events` row, and
`proposal.approve_for_draft` audit evidence. If validation has not passed, the
approval is blocked and `proposal.approval_blocked` is recorded.

Approval still does not modify live `data/*.json`, does not modify `dist/`,
does not mark public content as verified, does not publish the site, and does
not switch `CONTENT_SOURCE` to `db`. It only says the proposal is ready for the
existing export, draft-apply, release candidate, durable apply-plan, and guarded
live-apply review steps.

Release candidates group proposals that were already approved for draft
preparation. From `/admin/release-candidates`, an admin can create a draft
release candidate, add only `approved_for_draft` proposals with passed
validation, export each item, apply each export to a temporary draft workspace,
and mark the candidate `ready_for_review`. These actions record audit events
such as `release_candidate.create`, `release_candidate.add_item`,
`release_candidate.remove_item`, and `release_candidate.ready_for_review`.

Release candidates are still not a publishing path. They do not modify live
`data/*.json`, do not modify `dist/`, do not commit code, do not run crawlers or
schedulers, and do not expose `/api/ask`. Export and draft-apply actions still
write only to `tmp/proposal-exports/` and `tmp/content-drafts/` for human
inspection.

Release review summaries give admins a combined view before any release is
marked ready for review. A summary includes item count, affected entity types,
files that would change, validation status per item, proposal/export/draft/
revision links, a combined diff summary, and blocking warnings for failed
validation, missing draft applies, missing revisions, duplicate entity keys, or
the same file being touched by multiple proposals. Warning codes distinguish
`missing_export`, `missing_draft_apply`, `missing_revision`, and
`validation_failed` so operators can tell missing review artifacts from payload
validation failures. Generating a summary records `release_review.generate` and
`release_review.warning` audit entries.

A release candidate can move to `ready_for_review` only when the generated
summary has no blocking warnings. Blocked attempts record
`release_candidate.ready_blocked`; successful readiness records
`release_candidate.ready_for_review`. This is still review state only and does
not publish or write live JSON files.

Release apply plans are the final human-review artifact before any future manual
apply step. A plan can only be generated for a release candidate already in
`ready_for_review`, and generation is blocked if the current release review
summary has warnings. MySQL is the canonical storage for apply plans in
`release_apply_plans`; each row stores the full plan payload, changed files,
warnings, validation summary, and rollback notes.

The generator may also write convenience artifacts under
`tmp/release-apply-plans/<release-candidate-id>/`, including ordered file
changes, before/after file snapshots, combined patch JSON, and rollback notes.
Those `tmp/` files are not canonical and may disappear after deploy/runtime
cleanup. The admin apply-plan page loads from MySQL first, so deploy cleanup
must not break review history. If an older plan exists only under `tmp/`, the
admin loader imports it into MySQL. If both DB and tmp are missing for a
recovered release, the page reconstructs a durable view from release, proposal,
export, and live-apply metadata and labels it as recovered.

Apply plans are explicitly `NOT APPLIED` and `NOT PUBLISHED`. They do not modify
live `data/*.json`, do not modify `dist/`, do not deploy, and do not mark
content verified. Apply-plan generation records `release_apply_plan.generate`;
blocked and error paths record `release_apply_plan.blocked` and
`release_apply_plan.error`.

Legacy live JSON apply is a guarded admin action from the release apply-plan
detail page. It requires:

- release candidate status `ready_for_review`
- an existing generated apply plan
- zero apply-plan/release-review warnings
- every proposal still `approved_for_draft`
- every proposal/export/draft validation still `passed`
- no duplicate entity keys or conflicting file changes
- reviewer note
- exact confirmation phrase `APPLY LIVE JSON`

The apply action is deliberately split into short, recoverable phases so
Hostinger request timeouts do not leave an untracked write:

1. Create a `release_live_applies` row before writing any JSON.
2. Record the release candidate, apply-plan path, planned changed files, reviewer
   note, actor, `started_at`, and a generated backup path.
3. Copy backups under
   `tmp/live-release-backups/<release-candidate-id>/<timestamp>/` and persist
   `backup_exists=1`.
4. Write the planned `data/*.json` changes and mark the apply `files_written`.
5. Stop the request and show the live apply detail page.
6. Start verification from that page. Verification runs as a background worker
   and records build/retrieval/audit output on the same live apply row.

For subject promotions, the public URL is generated from `seo.slug || id`, the
same rule used by `scripts/build.js`, `dist/sitemap.xml`, and
`dist/search-index.json`. Post-apply URL checks must use the canonical path shown
on the proposal, verification review, release apply-plan, or live-apply admin
page. Do not assume `entity_key` is the public URL slug.

Successful verification marks the apply and release candidate
`published_pending_deploy`. Recovered applies use
`published_pending_deploy_recovered`. Neither status deploys the site by itself.
A human must review the changed JSON, commit to Git, and push to GitHub for the
normal Hostinger auto-deploy. Do not run a second live apply while an apply is in
`started`, `backup_created`, `files_written`, or `verification_running`.

If Hostinger times out after the live apply row is created, open the latest live
apply record from the release/apply-plan page and continue from its visible
state:

- `started` or `backup_created`: inspect before retrying; no JSON should be
  assumed written until `files_written`.
- `files_written`: start or resume verification.
- `verification_running`: refresh the page; if it does not finish, start
  verification again. The row and backup path remain recorded.
- `failed`: if a backup exists, rollback can restore the changed JSON files.
- `manual_rollback_required`: no backup was recorded; use the recovery details
  to remove or restore the exact changed file/entity manually.

If Hostinger times out before any `release_live_applies` row is created but the
live JSON file changed, use the incident recovery form on the release candidate
or apply-plan page. Type `RECOVER PARTIAL APPLY`. Recovery does not write JSON;
it inspects the current live `data/*.json`, confirms the expected entity is
present, searches for a backup under `tmp/live-release-backups/`, creates a
recovery apply row, records `release_live_apply.recovered_partial`, and moves
the release candidate to `partial_applied_needs_review`. Then run verification
from the recovered live apply page.

Rollback is available only when a backup path exists and the operator types
`ROLLBACK LIVE JSON`. It restores the recorded files from backup and reruns
verification. If no backup exists, the UI shows manual rollback required with
the changed path and the recovery metadata identifies the entity key. Rollback
does not commit, push, deploy, crawl, schedule, expose `/api/ask`, or switch
`CONTENT_SOURCE`.

`needs_verification` records can be committed to JSON as draft content, but they
do not publish. `scripts/build.js` renders them only under `drafts/`, excludes
them from `dist/`, and `scripts/build-search-index.js` excludes them from
`dist/search-index.json`. A release that only adds `needs_verification` content
should keep the public verified subject count and search document count
unchanged.

Admin test tools are disabled by default and only appear when
`ADMIN_TEST_TOOLS=true`. The test page can create a clearly marked release dry
run using an entity key that starts with `test-`, then run the full controlled
path:

```
test proposal -> approve_for_draft -> release candidate -> export
  -> draft apply -> revision -> review summary -> ready_for_review
```

Test fixtures never write live `data/*.json`, never modify `dist/`, and are not
included in the public JSON-backed build. The cleanup action removes test
proposals, test release candidates, test exports, draft applies, revision
metadata, and the matching `tmp/proposal-exports/` and `tmp/content-drafts/`
fixture folders. Fixture create and cleanup operations record
`test_fixture.create` and `test_fixture.cleanup` audit entries.

Draft apply is the next controlled review step. From a proposal export detail
page, an admin can apply a passed export into
`tmp/content-drafts/<proposal-id>/`. This creates a full copied `data/` snapshot
inside the draft workspace, applies the replacement or patch to that copied
snapshot only, validates the draft dataset, writes `summary.json`, and stores
metadata in `proposal_draft_applies`. Draft apply does not modify live
`data/*.json`, does not modify `dist/`, does not commit anything, does not mark
content verified, and does not publish. The output is for human inspection
before any guarded live apply workflow.

Content revisions preserve immutable review history after a successful draft
apply. A revision stores the entity type/key, revision number, full content JSON
snapshot, source status, proposal/export/draft provenance, optional parent
revision, creator, and timestamp in `content_revisions`. Revisions can be listed,
opened, and compared in the admin UI, but they cannot be edited and they do not
publish anything. They exist so future approval/publish automation has a
complete audit trail before it is allowed to touch live content.

Target content lifecycle for new production releases:

```
Asset
  -> Parse
  -> Extract
  -> Validate
  -> Diff
  -> Proposal
  -> Approve for Draft
  -> Release Candidate
  -> Export
  -> Draft Apply
  -> Revision
  -> Release Review Summary
  -> Release Apply Plan
  -> Create Review PR
  -> Required GitHub CI
  -> Human Merge
  -> Hostinger Deploy
  -> Release/Health/Sitemap Verification
  -> DB Import/Parity
  -> Search Console Observation
```

The `APPLY LIVE JSON` path described above remains available only for legacy
release recovery during the GitHub PR cutover.

Environment variables:

```
ADMIN_ENABLED=false
ADMIN_EMAIL=admin@jntustack.com
ADMIN_PASSWORD_HASH=pbkdf2:<iterations>:<salt>:<base64url hash>
# sha256:<hex> is still accepted but deprecated (unsalted, single-round). Migrate to pbkdf2:.
# ADMIN_PASSWORD=... is accepted for local setup, but prefer a hash.
ADMIN_SESSION_SECRET=<random string; required when ADMIN_ENABLED=true, no fallback>
ADMIN_TEST_TOOLS=false
# ADMIN_COOKIE_INSECURE=true  # local HTTP dev only; the session cookie is Secure by default.
```

Generate a pbkdf2 hash locally (recommended):

```
node -e "const c=require('node:crypto');const s=c.randomBytes(16).toString('base64url');const i=210000;const h=c.pbkdf2Sync(process.argv[1],s,i,32,'sha256').toString('base64url');console.log('pbkdf2:'+i+':'+s+':'+h)" 'your-password'
```

Or a simple SHA-256 hash (deprecated, avoid for new setups):

```
node -e "const crypto=require('node:crypto'); console.log('sha256:'+crypto.createHash('sha256').update(process.argv[1]).digest('hex'))" 'your-password'
```

Only set `ADMIN_ENABLED=true` after `ADMIN_EMAIL` and either
`ADMIN_PASSWORD_HASH` or `ADMIN_PASSWORD` are configured. The dashboard uses the
currently active content adapter, so production should continue to run it with
`CONTENT_SOURCE=json` until DB mode is explicitly approved.

Environment variables:

```
CONTENT_SOURCE=json   # default; production should keep this for now
DB_HOST=...
DB_USER=...
DB_PASSWORD=...
DB_NAME=...
DB_PORT=3306          # optional; defaults to 3306
```

Hostinger setup:

1. Create a MySQL database in hPanel.
2. Add the `DB_*` values to the Node.js app's Environment Variables.
3. Keep `CONTENT_SOURCE=json` until DB-backed serving is explicitly approved.
4. Run migrations manually when needed:

```
npm run db:status
npm run db:migrate
```

Migrations are intentionally not run automatically during `npm start` or
`npm run build`. This keeps deploys from breaking the public JSON-backed site
if database credentials are missing or the database is temporarily unavailable.

After migrations are applied, the current JSON content can be round-tripped
through MySQL for parity testing without changing the public build source:

```
npm run db:import-json -- --verify # upsert current data/*.json into MySQL, then run parity
npm run db:export-json   # write JSON-compatible files to tmp/db-export/data/
npm run db:parity        # compare current JSON vs DB export counts/slugs/status
npm run test:content-store # verify json adapter counts; db adapter when env exists
```

The JSON import command is idempotent and logs each import phase:
universities, regulations, branches, subjects, colleges, branch profiles,
guides, and a completion summary. Each phase runs in its own transaction with query timeouts,
so failures should report the current phase and last completed phase instead of
leaving an ambiguous hang.

For operational recovery or focused mirror syncs, use scoped imports:

```
npm run db:import-json -- --subjects --verify
npm run db:import-json -- --colleges --verify
npm run db:import-json -- --branch-profiles --verify
npm run db:import-json -- --guides --verify
npm run db:import-json -- --file=data/subjects-cse.json --verify
```

`--file` currently supports `data/subjects-*.json`, `data/colleges-*.json`,
`data/branch-guide-data.json`, and `data/guides.json`. Scoped imports still use the same upsert paths and
should be followed by parity verification when the DB mirror is expected to
match JSON.

If an import fails midway, do not manually edit DB rows. Re-run the same import
after fixing the reported cause; completed phases are upserts and can be safely
replayed. For Hostinger remote DB failures, first confirm the app/user/password
values, then check remote MySQL allowlisting for the current machine IP. Access
denied errors that include the client host usually mean the IP allowlist changed
or an IPv6 privacy address rotated. Keep `CONTENT_SOURCE=json` until DB-backed
serving is separately approved and verified.

The export command never overwrites `data/` by default. It writes to
`tmp/db-export/`, which is ignored by git. If database credentials are missing,
these commands fail with setup instructions instead of silently succeeding.

## What's real vs. what's scaffolding

| Piece | Status |
|---|---|
| Schema (`data/schema.json`) | Regulation, Branch, Subject, offerings, publication mode, Guide, BranchProfile, and College are AJV-validated. |
| Subject data (`data/subjects-*.json`) | 436 verified records: 403 page-mode and 33 listing-only. Current counts live in `docs/CURRENT_STATE.md`. |
| Data loading layer (`lib/dataset.js`) | Globs subject files, loads `guides.json`, and merges shared regulations/branches into one validated dataset used by build and search. |
| Branch guide (6 branches) | Verified and live, includes a working client-side quiz. No fabricated stats anywhere -- intentional. |
| Internship/project guide | One verified indexed guide backed by the official R23 regulations; internship milestones link to its section anchors. |
| College directory | Live and generated from 376 verified college records. |
| Ask widget UI | Built but not exposed in production. `/api/ask` remains disabled until rate limiting and final model testing are explicitly approved. |
| `routes/ask.js` + `server.js` | Express route exists behind `ASK_ENABLED=true`; production keeps `ASK_ENABLED=false`, so `/api/ask` returns 404. |
| `lib/retrieve.js` | Shared deterministic field/IDF ranker with typed intent, exact filters, atomic offering contexts, guide support, and assertion-based quality gates. No embeddings or external search service. |
| Private evidence storage | Local and Cloudflare R2 adapters exist. Production R2 mode is immutable, checksum-verified, private, and fail-closed. |
| GitHub publication | GitHub App publisher creates a sealed deterministic branch/commit/review PR; required CI and human merge remain mandatory. |

## Data files & how they're loaded

Subject content is split **per branch** so each branch's syllabus can be
sourced independently without touching another branch's already-verified
records.

| File | Holds |
|---|---|
| `data/schema.json` | The content model. Everything below is ajv-validated against it at build time. |
| `data/shared.json` | `regulations` (R16/R19/R20/R23/R25) and `branches` (all six: CSE, IT, ECE, EEE, CE, MECH). Cross-branch facts that don't belong to any one subject file. |
| `data/subjects-<code>.json` | One file per branch -- each a `{ "subjects": [...] }` object (e.g. `data/subjects-cse.json`). **Adding a branch = drop in a new `data/subjects-<code>.json` file.** The build globs `data/subjects-*.json`, so no build-script edit is needed. |
| `data/guides.json` | Verified editorial guides, currently the R23 internships and projects guide. |
| `data/branch-guide-data.json` | `branch_profiles` for the branch-choice guide (separate dataset, loaded on its own). |
| `data/colleges-<campus>.json` | College directory records split by campus and merged by the build. |

At build time `scripts/build.js` (via `lib/dataset.js`) merges `shared.json`'s
`regulations` + `branches` with the concatenated `subjects` arrays from every
`data/subjects-*.json` file (sorted, for deterministic order) into one dataset
object, then validates that combined object against `schema.json` -- exactly as
when it was a single file. `scripts/build-search-index.js` uses the same glob
(`lib/dataset.js`), so the `/api/ask` search index can't drift from what's
published. There are no hardcoded subject filenames anywhere in the build.

## The verified/needs_verification/placeholder discipline

This is load-bearing, not decorative: `scripts/build.js` refuses to publish
anything whose `source.status` is not `verified`. Do not bypass this to get
more content live faster. A verified subject can still be `listing_only` when
the official evidence establishes course placement but does not publish enough
content for a useful standalone page. Listing-only records appear on branch
hubs but never generate detail pages, Course structured data, sitemap entries,
or standalone search documents. `needs_verification` content renders only to
`drafts/` with a visible orange watermark.

## Immediate next steps

Use `docs/CURRENT_STATE.md` for current state and
`docs/CONTENT_OPS_RUNBOOK.md` for operational workflow. Keep README next steps
limited to setup-level reminders:

1. Keep `CONTENT_SOURCE=json` and `ASK_ENABLED=false`.
2. Complete the GitHub App, private R2, branch protection, and
   notes-only production trial in `docs/CONTENT_OPS_RUNBOOK.md`.
3. Publish new content through a review PR, required CI, and human merge; then
   verify `/release.json`, `/health`, and `/sitemap.xml` after Hostinger deploys.
4. Record Search Console baselines and follow-ups on days 0, 7, 14, and 28.
5. Keep NLP/n8n/Telegram automation and affiliate-book monetization deferred
   until the reviewed publishing foundation is stable.

## Design constraints worth preserving as this grows

- No fabricated statistics (placement %, salaries, college rankings)
  anywhere, ever -- this was a deliberate, repeated decision, not an
  oversight to "fix" later.
- Ad slots stay visually separated from download/resource boxes
  (AdSense policy + basic decency).
- Cross-link new-regulation pages to their old-regulation equivalents
  instead of orphaning them -- supply/backlog students still search those.
