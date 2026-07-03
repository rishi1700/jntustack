# JNTUStack -- project state as of this handoff

Domain: jntustack.com (primary, **registered 2026-06-30, expires
2027-06-30**) + jntustack.in (intended .com redirect, **not yet registered**).

Hosting: **Hostinger Node.js Apps** (hPanel, Business/Cloud plan), deployed
via GitHub. Not Cloudflare Pages -- that was the original plan, changed
mid-build, and the architecture below reflects the current (Hostinger)
target.

**Live status (2026-07-03):** deployed to Hostinger as a Node.js/Express app
via GitHub auto-deploy, entry `server.js`, Node 24. `CONTENT_SOURCE=json`
remains the production-safe public content source. `https://jntustack.com/`
and `/health` return 200, and `/admin` is protected behind login when
`ADMIN_ENABLED=true`.

## What this is

A custom Node.js site: a static-site generator (no frontend framework, plain
template literals driven by `data/*.json`) plus a thin Express server that
serves the generated output and private admin workflows. `/api/ask` is
feature-gated and must remain disabled unless explicitly approved.

## Quick start (local)

```
npm install
npm run build      # generates dist/ AND dist/search-index.json
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

## Database foundation

MySQL support is scaffolded for future admin/review workflows. It is CLI-only
in this phase and is not used by the public build or server boot path.

The content loader now has two adapter modes:

- `CONTENT_SOURCE=json` -- default and production-safe. Reads `data/*.json`
  through the existing glob-based loaders.
- `CONTENT_SOURCE=db` -- experimental. Reads the same normalized dataset shape
  from MySQL after migrations/import/parity have succeeded.

Production should remain `CONTENT_SOURCE=json` until DB mode is explicitly
approved. Do not set Hostinger production to `db` just because migrations exist.

## Admin dashboard

The private admin dashboard is disabled by default and is read-only when enabled.
It shows content counts and tables for subjects, colleges, branch profiles, and
source evidence. It does not expose editing, status changes, publishing, or
automation.

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
checksum, store metadata in `source_assets`, and place the file under:

```
storage/
  source-assets/
    <source-id>/
      YYYY/
        MM/
          original-file.pdf
```

`storage/` is intentionally ignored by git and is never served from `public/`
or `dist/`. If the same SHA-256 checksum already exists, the upload records a
duplicate asset reference and reuses the existing stored path instead of writing
another copy. Assets are treated as immutable because they are evidence: later
parsers and reviewers should be able to reproduce exactly what was available at
ingestion time. Updating content must create new proposals or new assets, not
rewrite historical raw material.

The parser framework is DB-backed and manual-only. Parsers are registered by
`parser_key`, run from an asset detail page, and write extracted evidence to
`parse_results`. Parser output is always review material: it does not create
content proposals, does not write `data/*.json`, does not mark anything
verified, and does not publish to the public site. `html-basic` extracts simple
HTML title/headings/links/text preview. `pdf-text-basic` is registered as a
future parser interface but is disabled until a safe PDF text extraction
dependency is selected.

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
and prevents proposal payloads from entering review as `verified`. Admins can
re-run validation from a proposal detail page. A validation pass still does not
approve verification, publish content, or write to `data/*.json`; verified
status requires a future human approval/apply workflow.

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

The first source-specific parser emits:

```
evidence_type: source_specific_subject_index
candidates: []
source_url
parser_version
evidence_status: needs_review
```

Admins can inspect candidate rows and manually extract one candidate into an
`extraction_results` row. Candidate extraction records audit evidence and still
uses validation; missing category/type/year/branch/regulation fields remain
missing unless they are clearly present in the uploaded evidence or supplied as
reviewer hints.

Manual source fetch is an evidence-ingestion path for one URL at a time. From a
discovery source detail page, an admin can fetch a URL that belongs to that
source's configured base domain. The fetcher stores the response as a
`source_assets` row, captures content type, size, ETag, Last-Modified, checksum,
and duplicate status, and writes `source_fetch.*` audit events. It blocks
localhost/private IP ranges, non-HTTP(S) schemes, unsupported content types,
oversized downloads, and redirect loops. Fetching does not crawl, schedule
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
existing export and draft-apply review steps. Final publishing remains a future
manual workflow.

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
the same file being touched by multiple proposals. Generating a summary records
`release_review.generate` and `release_review.warning` audit entries.

A release candidate can move to `ready_for_review` only when the generated
summary has no blocking warnings. Blocked attempts record
`release_candidate.ready_blocked`; successful readiness records
`release_candidate.ready_for_review`. This is still review state only and does
not publish or write live JSON files.

Release apply plans are the final human-review artifact before any future manual
apply step. A plan can only be generated for a release candidate already in
`ready_for_review`, and generation is blocked if the current release review
summary has warnings. The plan writes only to
`tmp/release-apply-plans/<release-candidate-id>/` and includes ordered file
changes, add/replace operations, before/after entity JSON previews, combined
patch JSON, rollback notes, validation summary, and final warnings.

Apply plans are explicitly `NOT APPLIED` and `NOT PUBLISHED`. They do not modify
live `data/*.json`, do not modify `dist/`, do not deploy, and do not mark
content verified. Apply-plan generation records `release_apply_plan.generate`;
blocked and error paths record `release_apply_plan.blocked` and
`release_apply_plan.error`.

Final live JSON apply is a guarded admin action from the release apply-plan
detail page. It requires:

- release candidate status `ready_for_review`
- an existing generated apply plan
- zero apply-plan/release-review warnings
- every proposal still `approved_for_draft`
- every proposal/export/draft validation still `passed`
- no duplicate entity keys or conflicting file changes
- reviewer note
- exact confirmation phrase `APPLY LIVE JSON`

Before writing, changed files are backed up under
`tmp/live-release-backups/<release-candidate-id>/<timestamp>/`. The service then
writes the planned JSON changes to live `data/*.json`, runs `npm run build`,
`npm run test:retrieve`, and `npm run audit:site`, records
`release_live_apply.success`, and marks the release candidate
`published_pending_deploy`. This still does not deploy. A human must review the
working tree, commit the changed JSON/build output, and push to GitHub for the
normal Hostinger auto-deploy.

If validation/build/retrieval/audit fails after writing, the service restores
the changed files from backup and records a failed apply. Rollback is also
available for the latest `published_pending_deploy` apply using the exact
confirmation phrase `ROLLBACK LIVE JSON`; it restores the backup and reruns the
verification checks. Rollback does not commit, push, deploy, crawl, schedule, or
switch content source.

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
before any future manual publishing workflow.

Content revisions preserve immutable review history after a successful draft
apply. A revision stores the entity type/key, revision number, full content JSON
snapshot, source status, proposal/export/draft provenance, optional parent
revision, creator, and timestamp in `content_revisions`. Revisions can be listed,
opened, and compared in the admin UI, but they cannot be edited and they do not
publish anything. They exist so future approval/publish automation has a
complete audit trail before it is allowed to touch live content.

Current content lifecycle:

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
  -> Apply Live JSON
  -> Manual Git Commit/Push
  -> (Future Publish)
```

Environment variables:

```
ADMIN_ENABLED=false
ADMIN_EMAIL=admin@jntustack.com
ADMIN_PASSWORD_HASH=sha256:<hex>
# ADMIN_PASSWORD=... is accepted for local setup, but prefer a hash.
ADMIN_TEST_TOOLS=false
```

Generate a simple SHA-256 hash locally:

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
3. Keep `CONTENT_SOURCE=json` until a later PR adds and verifies a DB-backed
   dataset adapter.
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
npm run db:import-json   # upsert current data/*.json into MySQL
npm run db:export-json   # write JSON-compatible files to tmp/db-export/data/
npm run db:parity        # compare current JSON vs DB export counts/slugs/status
npm run test:content-store # verify json adapter counts; db adapter when env exists
```

The export command never overwrites `data/` by default. It writes to
`tmp/db-export/`, which is ignored by git. If database credentials are missing,
these commands fail with setup instructions instead of silently succeeding.

## What's real vs. what's scaffolding

| Piece | Status |
|---|---|
| Schema (`data/schema.json`) | Stable. Regulation/Branch/Subject/BranchProfile/College all defined, ajv-validated. |
| CSE R23 + R16 subject data (`data/subjects-cse.json`) | Mostly `needs_verification` -- only 2 R16 records are `verified` and actually publish. See each record's `notes` field. |
| Data loading layer (`lib/dataset.js`) | Stable. Globs `data/subjects-*.json` and merges them with `data/shared.json` (regulations + branches) into one dataset; the merged object is then ajv-validated against the schema. Shared by `build.js`, `build-search-index.js`, and `lib/retrieve.js`. Adding a branch needs no change here -- drop in a `data/subjects-<code>.json` file and it's discovered automatically. |
| Branch guide (6 branches) | `verified`, live, includes a working client-side quiz. No fabricated stats anywhere -- intentional. |
| JNTUK colleges | 33 real records (constituent + autonomous), sourced from jntukdaaportal.in. The larger private-affiliated list (~120+ more) and JNTUH/JNTUA/JNTUGV are NOT done -- see `_coverage_note` in `data/colleges-jntuk.json`. |
| Ask widget UI | Built, works standalone in mock mode. |
| `routes/ask.js` + `server.js` | Express, written correctly per Anthropic's API conventions, tested end-to-end against a real running server (validation, static serving, graceful no-key failure) -- only the actual Anthropic API call is untested, since there's no key yet. Model-calling is abstracted into `callModel()` specifically so swapping providers later doesn't touch retrieval/routing/validation code. |
| `lib/retrieve.js` | Tested, working keyword retrieval. Has a known limitation: naive keyword overlap, no semantic search. Fine at this corpus size; revisit if it grows ~10x. |

## Data files & how they're loaded

Subject content is split **per branch** so each branch's syllabus can be
sourced independently without touching another branch's already-verified
records.

| File | Holds |
|---|---|
| `data/schema.json` | The content model. Everything below is ajv-validated against it at build time. |
| `data/shared.json` | `regulations` (R16/R19/R20/R23/R25) and `branches` (all six: CSE, IT, ECE, EEE, CE, MECH). Cross-branch facts that don't belong to any one subject file. |
| `data/subjects-<code>.json` | One file per branch -- each a `{ "subjects": [...] }` object (e.g. `data/subjects-cse.json`). **Adding a branch = drop in a new `data/subjects-<code>.json` file.** The build globs `data/subjects-*.json`, so no build-script edit is needed. |
| `data/branch-guide-data.json` | `branch_profiles` for the branch-choice guide (separate dataset, loaded on its own). |
| `data/colleges-jntuk.json` | College directory records (separate dataset). |

At build time `scripts/build.js` (via `lib/dataset.js`) merges `shared.json`'s
`regulations` + `branches` with the concatenated `subjects` arrays from every
`data/subjects-*.json` file (sorted, for deterministic order) into one dataset
object, then validates that combined object against `schema.json` -- exactly as
when it was a single file. `scripts/build-search-index.js` uses the same glob
(`lib/dataset.js`), so the `/api/ask` search index can't drift from what's
published. There are no hardcoded subject filenames anywhere in the build.

## The verified/needs_verification/placeholder discipline

This is load-bearing, not decorative: `scripts/build.js` refuses to publish
anything whose `source.status` isn't `verified`. Don't bypass this to get
more content live faster -- the whole point is that nothing reaches a
student without a real source behind it. `needs_verification` content
renders to `drafts/` with a visible orange watermark instead.

## Immediate next steps, roughly in order

1. Review the live admin UI with `ADMIN_ENABLED=true`, starting at
   `/admin/checks`, and keep `CONTENT_SOURCE=json`.
2. Source the official R23 syllabus PDFs (see notes in
   `data/subjects-cse.json`) to flip subject records to `verified`.
3. Finish the JNTUK private-college list, then JNTUH/JNTUA/JNTUGV
   (`data/colleges-jntuk.json` coverage note has the blocker: the source
   page is JS-rendered, needs a browser-automation pass, not a plain fetch).
4. Branch hub / semester hub page templates don't exist yet -- only
   individual subject pages and the branch guide do.
5. Decide free-vs-rate-limited access model for the ask widget before
   enabling `ASK_ENABLED=true` or linking `/api/ask` from a live page.

## Design constraints worth preserving as this grows

- No fabricated statistics (placement %, salaries, college rankings)
  anywhere, ever -- this was a deliberate, repeated decision, not an
  oversight to "fix" later.
- Ad slots stay visually separated from download/resource boxes
  (AdSense policy + basic decency).
- Cross-link new-regulation pages to their old-regulation equivalents
  instead of orphaning them -- supply/backlog students still search those.
