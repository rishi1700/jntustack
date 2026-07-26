# JNTUStack Current State

Last updated: 2026-07-26 after reconciling the completed 2026-07-18 trust-root
bootstrap, implementation cutover, production deploy, and database parity.

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
  Each build writes a separate, non-secret `dist/deployment.json` marker from
  the checked-out Git commit. `/health` returns that validated commit and source
  cleanliness with `Cache-Control: no-store`, allowing production code
  provenance to be checked before any signed publication marker exists.
- `/api/ask` exists in code but is mounted only when `ASK_ENABLED=true`.
  Production keeps `ASK_ENABLED=false`, so the endpoint returns `404`.
- MySQL mirrors JSON content and stores immutable evidence metadata, parser and
  extraction results, proposals, release candidates, durable apply plans,
  GitHub publications, legacy live-apply recovery state, revisions, and audit
  events.
- The selected evidence architecture pairs that existing MySQL database with
  an absolute private Hostinger filesystem root outside the deployed `nodejs`
  tree and `public_html`. MySQL stores provider/key/checksum identity; the
  filesystem stores immutable bytes. Private Cloudflare R2 remains an optional
  alternative, not the selected store.

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

The repository contains the GitHub App and pluggable private evidence-storage
foundation for reviewed publishing. Migration
`026_github_publication_foundation.sql` brings the migration count to 26.

The intended production cutover configuration is:

```text
CONTENT_PUBLICATION_MODE=github_pr
GITHUB_PUBLICATION_TRUST_READY=false
ASSET_STORAGE_PROVIDER=local
ASSET_STORAGE_ROOT=/absolute/hostinger/account/path/jntustack-private-assets
ASSET_STORAGE_EXPECTED_ID=jntustack-hostinger-assets-2026-07
ASSET_STORAGE_PERSISTENCE_VERIFIED=false
```

The root shown above is a placeholder: production must use the actual absolute
Hostinger account path, outside `nodejs` and `public_html`. The local adapter
stores immutable evidence by SHA-256, rejects unsafe paths/symlinks, verifies
checksum and size on writes and reads, and fails closed. System checks seed a
private store-ID-bound marker on deploy A. A distinct deploy B must read that
same marker before an operator explicitly changes
`ASSET_STORAGE_PERSISTENCE_VERIFIED=true`. Until the two-deploy proof and
acknowledgement are complete, publication storage is not ready. Cloudflare R2
remains a supported private alternative and never acts as a silent fallback.

On 2026-07-26, production deploy A at commit
`cde6bb3e2383e306559693d55deb921c2e2b84de` completed the authenticated
bounded write/read/checksum/delete probe against the selected Hostinger local
store and seeded its store-ID-bound persistence marker. System checks reported
`seeded_waiting_for_new_deploy`; `ASSET_STORAGE_PERSISTENCE_VERIFIED` and
`GITHUB_PUBLICATION_TRUST_READY` remain `false`.

This current-state note intentionally creates distinct commit B for the
second-deployment proof. After Hostinger deploys it with the same storage root
and expected store ID, authenticated System checks must read the deploy-A
marker and report `verified_not_acknowledged` before either acknowledgement or
publication trust is enabled.

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
the GitHub/persistent-evidence production setup is incomplete. PR creation
additionally requires `GITHUB_PUBLICATION_TRUST_READY=true`. Migration 026
deliberately keeps existing release rows in `legacy` mode. Legacy live-apply
code is retained only for explicit recovery during cutover; it is not the
desired path for new production publishes.

Production MySQL was backed up and migrations 025 and 026 were applied on
2026-07-18. The migration journal reports 26/26 applied with no partial or
failed steps; all 27 pre-migration tables were captured in the verified backup.
The current JSON dataset was imported, 21 obsolete mirror-only subject rows
were removed transactionally with before-image audit events, and exact JSON/DB
parity was then verified. Public serving remained JSON-backed throughout.

That verified backup establishes the database migration checkpoint only. The
selected external asset root still requires a private
`source_assets` provider/key/checksum inventory, a key-preserving copy verified
against every MySQL checksum, a complete asset archive and matching MySQL dump
copied off-host, and an isolated staging restore drill. Hostinger backup
coverage for a root outside `nodejs`/`public_html` has not been verified and
must not be claimed or relied upon until an actual Hostinger restore proves it.

The repository became public and completed its separate trust-root-only
bootstrap (`008a0c2`) on 2026-07-18. That bootstrap contained `CODEOWNERS`, the
pinned workflows, and the base-owned artifact verifier before the implementation
cutover. The cutover reached `main` at `962f05d`, both required jobs succeeded,
Hostinger deployed it, and all 413 live sitemap URLs returned HTTP 200.

`main` is now protected with strict, up-to-date `verify` and
`publication-integrity` GitHub Actions checks; one code-owner approval; stale
review dismissal; approval of the last push by someone other than its pusher;
conversation resolution; linear history; administrator enforcement; and no
force pushes or deletions. GitHub secret scanning, push protection, and
Dependabot security updates are enabled for the public repository, and the
required verification workflow rejects high-severity npm audit findings.

These repository controls are complete, but the automated publisher is not
active. A dedicated publication-signing key (`2026-07`) exists only in the
ignored, permission-restricted operator environment, and its matching public
key is configured in the repository's Actions keyring. The Hostinger persistent
root proof and acknowledgement, key-preserving asset migration, off-host backup
and staging restore drill, deployment of the repository-only GitHub App
credentials and private signing key to Hostinger, and notes-only production
trial remain outstanding. Production must therefore keep
`GITHUB_PUBLICATION_TRUST_READY=false`; branch protection alone is not a reason
to enable it.

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

- GitHub publishing must not be treated as active production until the
  Hostinger filesystem survives two distinct deploys, its store ID is
  explicitly acknowledged, the MySQL/key/checksum migration and staging restore
  drill pass, and the GitHub App, Hostinger private-key configuration, and
  no-public-output trial pass. Repository protection, migrations, local signing
  key generation, and the Actions public-key ring are complete, but the
  remaining publisher prerequisites are not, so
  `GITHUB_PUBLICATION_TRUST_READY` remains false.
- Hostinger backup coverage for the external asset root is unknown. Maintain a
  checksum-manifested asset archive plus same-cutoff MySQL dump off-host until
  that scope is proven, and retain the independent copy even after proof.
- Remote workstation access to Hostinger MySQL depends on current IP
  allowlisting. Authenticated mirror maintenance can instead run from the
  Hostinger application under System checks without opening MySQL broadly. A DB
  outage must not interrupt the JSON-backed public site or trigger a switch to
  DB mode.
- Official course placement does not prove that a detailed syllabus exists;
  preserve listing-only publication instead of fabricating thin pages.
- Google decides crawl and indexing timing. Measure Search Console outcomes at
  days 0, 7, 14, and 28; do not promise that every eligible URL will be indexed.
- Natural-language content requests, LLM generation, n8n orchestration,
  Telegram approval, automatic merge/rollback, and affiliate-book monetization
  remain deferred designs. They are not current publishing capabilities.
- `/api/ask` remains disabled.
