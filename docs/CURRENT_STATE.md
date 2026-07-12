# JNTUStack Current State

Last updated: 2026-07-11 after the official CSE/ECE/IT source passes and
immediate content-integrity corrections.

## Architecture

JNTUStack is a Node.js and Express static site generator.

- `data/*.json` is the production content source.
- `scripts/build.js` validates JSON, merges subject/college/branch data, renders public verified pages into `dist/`, and renders draft previews into `drafts/`.
- `scripts/build-search-index.js` writes the grounded retrieval index to `dist/search-index.json`.
- `server.js` serves `dist/`, `/health`, and private admin routes when admin is enabled.
- `/api/ask` exists in code but is only mounted when `ASK_ENABLED=true`; production keeps it disabled.
- Admin workflows are DB-backed and live under `/admin`.
- MySQL mirrors JSON content and stores source assets, parser results, extraction results, proposals, release candidates, durable apply plans, live apply rows, audit logs, and content revisions.

Production remains JSON-backed:

- `CONTENT_SOURCE=json`
- `ASK_ENABLED=false`
- `/api/ask` returns `404`
- DB mode is available for parity/admin workflows but is not the serving source.

## Current Counts

Current JSON/build state:

| Metric | Count |
| --- | ---: |
| Subjects | 426 |
| Verified subjects | 387 |
| Needs verification subjects | 38 |
| Placeholder subjects | 1 |
| Colleges | 376 |
| Branch profiles | 6 |
| Search docs | 769 |
| Sitemap URLs | 396 |
| Migration files | 24 |

The parity constants in `lib/db-json.js` currently expect:

- `verifiedSubjects: 387`
- `colleges: 376`
- `branchProfiles: 6`
- `searchDocs: 769`

## Verified/Draft State

Only subjects with `source.status = "verified"` are published to `dist/`, included in `dist/sitemap.xml`, and included in `dist/search-index.json`.

Subjects with `source.status = "needs_verification"` are rendered only as draft previews under `drafts/`. They must not become public, searchable, or sitemap-listed.

Subjects with `source.status = "placeholder"` are not rendered.

Recent RC13 verified promotions:

- `r23-ece-2-1-universal-human-values`
  - Canonical URL: `/universal-human-values-jntuk-r23-ece-2-1/`
- `r23-cse-3-1-microprocessors-and-microcontrollers`
  - Canonical URL: `/microprocessors-and-microcontrollers-jntuk-r23-cse-3-1/`

Recent integrity corrections:

- CSE, ECE, and IT subjects through 3-2 were re-sourced from JNTUK's own
  official R23 PDFs.
- ECE Switching Theory and Logic Design Lab is correctly assigned to 2-1;
  Signals and Systems Lab is correctly assigned to 2-2. The previously public
  swapped-semester URLs redirect permanently to the corrected URLs.
- The duplicate ECE Universal Human Values draft and obsolete autonomous-college
  IT 3-1 Employability Skills draft were removed; neither draft was public.
- Official-source page metadata no longer labels JNTUK content as Tirumala or
  SRKR content.

Public URL checks must use `seo.slug || id`. Entity keys are stable content identifiers and are not guaranteed to match public URL slugs.

## Production Flags

Production-safe flags:

```text
CONTENT_SOURCE=json
ASK_ENABLED=false
ADMIN_ENABLED=true
```

Hard rules:

- Never publish `needs_verification` content.
- Never expose `/api/ask` without rate limiting and final model testing.
- Never switch `CONTENT_SOURCE=db` until explicitly approved.
- After every guarded live apply, immediately sync Git and update the DB mirror.
- Public URLs must be checked from canonical `seo.slug`, not entity key.

## Release Workflow

Current content changes must flow through the guarded workflow:

1. Fetch or upload source evidence into the DB-backed source asset store.
2. Parse source evidence.
3. Extract candidates.
4. Validate payloads against `data/schema.json`.
5. Generate diffs.
6. Create proposals.
7. For new draft content, keep `source.status = "needs_verification"`.
8. For verified promotions, use the verification review workflow and checklist.
9. Approve clean proposals for draft only.
10. Create a release candidate.
11. Export proposals.
12. Apply to draft workspaces under `tmp/content-drafts/`.
13. Create immutable content revisions.
14. Generate release review summary.
15. Generate durable apply plan in MySQL.
16. Run final preflight.
17. Use the guarded live apply form with `APPLY LIVE JSON`.
18. Run live apply verification.
19. Sync live JSON back into Git.
20. Run `npm run db:import-json -- --verify` and `npm run db:parity`.

Guarded live apply writes live JSON only. It does not commit, push, deploy, crawl, schedule, expose `/api/ask`, or switch `CONTENT_SOURCE`.

## Parser Support

Registered parser keys:

| Parser key | Status | Purpose |
| --- | --- | --- |
| `html-basic` | available | Basic HTML title/headings/links/text preview extraction. |
| `tirumala-syllabus-html` | available | Conservative Tirumala HTML/text subject-index extraction. |
| `lbrce-syllabus-html` | registered, unavailable | Placeholder key; source-specific LBRCE HTML parsing is not implemented. |
| `pdf-text-basic` | available | PDF text extraction for human review. |
| `tirumala-r23-syllabus-pdf` | available | Conservative Tirumala R23 PDF course-structure candidate extraction. |
| `lbrce-r23-syllabus-pdf` | available | Conservative LBRCE R23 PDF course-structure candidate extraction. |

Extraction remains conservative. Parser candidates are not public content until validated, proposed, reviewed, and applied through the release workflow.

## Known Risks

- Old handoff notes and older README revisions are historical context only. Prefer this document for current state.
- Some source material comes from autonomous JNTUK-affiliated college PDFs. Public caveats must not imply university-official sourcing when only college evidence is present.
- LBRCE category mapping requires reviewer justification; do not infer ambiguous categories silently.
- Some verified pages intentionally have thin content when source evidence only supports course-structure fields. Do not fabricate units, outcomes, or resources.
- Hostinger remote DB access depends on IP allowlist rules; local IPv4/IPv6 changes can break DB commands.
- Live apply writes Hostinger JSON before Git is synced. A Git deploy can overwrite live changes if Git sync is skipped.
- `CONTENT_SOURCE=db` is still not the production serving mode.
- `/api/ask` is disabled and should stay disabled until rate limits and final model behavior are explicitly approved.
