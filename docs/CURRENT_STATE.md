# JNTUStack Current State

Last updated: 2026-07-18 after the R23/R16 content completion, deterministic
search upgrade, and GitHub/R2 publishing-foundation work.

## Architecture

JNTUStack is a Node.js/Express static-site generator with a private, DB-backed
admin workflow.

- `data/*.json` is the production public-content source.
- `scripts/build.js` validates the merged dataset and renders verified public
  pages into `dist/`. It also renders any future `needs_verification` records
  only into the private local `drafts/` workspace.
- `scripts/build-search-index.js` writes the verified public retrieval index to
  `dist/search-index.json` using the same matcher as the browser and server.
- `server.js` serves `dist/`, `/health`, and private admin routes when enabled.
- `/api/ask` exists in code but is mounted only when `ASK_ENABLED=true`.
  Production keeps `ASK_ENABLED=false`, so the endpoint returns `404`.
- MySQL mirrors JSON content and stores immutable evidence metadata, parser and
  extraction results, proposals, release candidates, durable apply plans,
  GitHub publications, legacy live-apply recovery state, revisions, and audit
  events.

Production public serving remains JSON-backed:

```text
CONTENT_SOURCE=json
ASK_ENABLED=false
ADMIN_ENABLED=true
```

`CONTENT_SOURCE=db` remains an experimental parity/admin adapter and is not the
production serving source.

## Current Counts

The current validated build contains:

| Metric | Count |
| --- | ---: |
| Subject records | 436 |
| Source-verified subject records | 436 |
| Standalone subject pages | 403 |
| Verified listing-only records | 33 |
| Needs-verification records | 0 |
| Editorial guides | 1 |
| Colleges | 376 |
| Branch profiles | 6 |
| Search documents | 786 |
| Sitemap URLs | 413 |
| Migration files | 26 |

Search documents comprise 403 standalone subjects, 376 colleges, six branch
profiles, and one guide. The parity constants in `lib/db-json.js` enforce these
same counts.

## Content and Publication Model

Only `source.status = "verified"` content can become public. The subject model
supports two publication modes:

- `publication.mode = "page"` (the default) generates a canonical detail page,
  sitemap entry, Course structured data, and standalone subject search record.
- `publication.mode = "listing_only"` renders a verified official milestone on
  the matching branch/semester hub but deliberately generates no thin subject
  page, sitemap URL, Course structured data, or standalone search record.

The 33 listing-only records are 30 R23 internship/project milestones and three
official Entrepreneurship Development & Venture Creation listings whose source
documents establish course placement but not a detailed unit syllabus. The
internship milestones link into the single verified, indexed
`/r23-internships-and-projects/` guide.

Subjects that occur in different branch/semester combinations use `offerings[]`.
Each offering keeps `branchCodes`, year, semester, and credits together. Legacy
single-context subject fields remain supported. Shared first-year subjects use
neutral canonical URLs, with permanent redirects from previously public
semester-specific URLs.

There are currently no drafts. If a future record uses
`source.status = "needs_verification"`, it must stay out of `dist/`, the sitemap,
structured data, and search. Placeholder records are not rendered at all.

Public URL checks must always use `seo.slug || id`; stable entity keys are not
guaranteed to equal public URL slugs.

## Deterministic Search

`lib/retrieve.js` provides the one shared browser/build/server implementation.
It does not use embeddings or an external search service.

- Search documents have `primary`, `metadata`, `headings`, and `body` fields,
  weighted 12, 6, 4, and 1 respectively.
- Token matches use deterministic IDF scoring, with exact-primary and
  primary-phrase bonuses.
- Normalization preserves branch codes, regulations, and semester tokens such
  as `CE`, `IT`, `R23`, and `1-2`, and recognizes full branch names.
- Intent routing distinguishes subjects, branch comparison, colleges, and the
  internship guide.
- Regulation, branch, semester, district, and college-type filters are exact.
  Branch and semester must match the same offering, preventing false
  cross-product results.
- Ties sort by score descending, title ascending, then ID ascending.
- Unverified records and listing-only records never appear as standalone search
  documents. Internship listing contexts feed the single guide result.

`npm run test:retrieve` is an assertion-based quality gate covering
navigational queries, branch comparison, district precision, concept recall,
atomic offerings, listing-only exclusion, guide folding, nonsense queries, and
deterministic ordering.

The Ask widget no longer downloads or posts the public index. If Ask is ever
approved, the browser sends only `{question}` and the server-owned index remains
the sole grounding source. Ask remains disabled pending explicit product,
rate-limit, model, and live-safety approval.

## Publishing Foundation

The repository contains the GitHub App and private Cloudflare R2 foundation for
reviewed publishing. Migration `026_github_publication_foundation.sql` brings
the migration count to 26.

The intended production cutover configuration is:

```text
CONTENT_PUBLICATION_MODE=github_pr
GITHUB_PUBLICATION_TRUST_READY=false
ASSET_STORAGE_PROVIDER=r2
R2_BUCKET=jntustack-source-evidence
```

The private R2 adapter stores immutable evidence by SHA-256, verifies checksum
and size on every write/read, and fails closed. R2 mode has no silent local
fallback.

The repository-scoped GitHub App may read metadata, checks, and commit statuses
and read/write contents and pull requests. It receives no Administration,
Workflows, or branch-protection bypass permission. Publication requires
`CREATE REVIEW PR`, seals the reviewed artifact and base/file hashes and sizes,
signs that manifest with a dedicated RSA publication key, and creates one
deterministic branch, commit, and pull request. Required CI uses a base-owned
public-key ring to reject self-authored branches and
validates the committed manifest against the exact base, parent, repository,
branch, and changed paths. It cannot merge or write directly to `main`; a human
merges after the protected, up-to-date `verify` and base-owned
`publication-integrity` GitHub Actions jobs pass.

After Hostinger auto-deploys the merge, `/release.json`, `/health`, and
`/sitemap.xml` attest that the live artifact matches the reviewed release.
Stale bases, tampering, failed checks, closed PRs, and deployment mismatches
fail visibly. A production mismatch is handled with a reviewed revert PR, not a
manual live JSON edit.

New releases default to `CONTENT_PUBLICATION_MODE=github_pr` and fail closed if
the GitHub/R2 production setup is incomplete. PR creation additionally requires
`GITHUB_PUBLICATION_TRUST_READY=true`. The repository became public on
2026-07-18, but the required branch rules are not yet proven, so this gate
remains false. Migration 026 deliberately keeps existing release rows in
`legacy` mode. Legacy live-apply code is retained only for explicit recovery
during cutover; it is not the desired path for new production publishes.

Production MySQL was backed up and migrations 025 and 026 were applied on
2026-07-18. The migration journal reports 26/26 applied with no partial or
failed steps; all 27 pre-migration tables were captured in the verified backup.

`main` also predates the base-owned verifier. Activation therefore requires a
separately reviewed trust-root-only bootstrap of `CODEOWNERS`, the pinned
workflows, and the artifact verifier before rules are enabled. The current
code-and-content batch is an implementation branch, not that bootstrap.

## Controlled Release Flow

The target content lifecycle is:

```text
official source -> private immutable evidence -> parse/extract -> validate
  -> diff -> human-reviewed proposal -> release candidate -> durable apply plan
  -> CREATE REVIEW PR -> required CI -> human merge -> Hostinger auto-deploy
  -> release/health/sitemap verification -> Search Console observation
```

After a merge, JSON should be imported into MySQL with verification and checked
for parity. Never switch the public serving source from JSON as part of a
publication.

## Parser Support

| Parser key | Status | Purpose |
| --- | --- | --- |
| `html-basic` | available | Basic HTML title/headings/links/text-preview extraction. |
| `tirumala-syllabus-html` | available | Conservative Tirumala HTML/text subject-index extraction. |
| `lbrce-syllabus-html` | registered, unavailable | Placeholder; LBRCE HTML parsing is not implemented. |
| `pdf-text-basic` | available | PDF text extraction for human review. |
| `tirumala-r23-syllabus-pdf` | available | Conservative Tirumala R23 course-structure extraction. |
| `lbrce-r23-syllabus-pdf` | available | Conservative LBRCE R23 course-structure extraction. |

Parser and extraction output remains evidence. It cannot become public without
validation, proposal review, a sealed release, required CI, and human merge.

## Known Risks and Deferred Work

- GitHub/R2 publishing must not be treated as active production until
  credentials, branch/ruleset protection, and the no-public-output trial pass.
  The repository is public and migrations are complete, but the remaining
  controls are not yet configured, so `GITHUB_PUBLICATION_TRUST_READY` remains
  false.
- Remote Hostinger MySQL access depends on current IP allowlisting. A DB outage
  must not interrupt the JSON-backed public site or trigger a switch to DB mode.
- Official course placement does not prove that a detailed syllabus exists;
  preserve listing-only publication instead of fabricating thin pages.
- Google decides crawl and indexing timing. Measure Search Console outcomes at
  days 0, 7, 14, and 28; do not promise that every eligible URL will be indexed.
- Natural-language content requests, LLM generation, n8n orchestration,
  Telegram approval, automatic merge/rollback, and affiliate-book monetization
  remain deferred designs. They are not current publishing capabilities.
- `/api/ask` remains disabled.
