# JNTUStack -- project state as of this handoff

Domain: jntustack.com (primary, **registered 2026-06-30, expires
2027-06-30**) + jntustack.in (intended .com redirect, **not yet registered**).

Hosting: **Hostinger Node.js Apps** (hPanel, Business/Cloud plan), deployed
via GitHub. Not Cloudflare Pages -- that was the original plan, changed
mid-build, and the architecture below reflects the current (Hostinger)
target.

**Live status (2026-06-30):** deployed to Hostinger as a Node.js/Express app
(three completed git deploys, entry `server.js`, Node 24) and DNS for
jntustack.com points at Hostinger (A 217.21.87.84). BUT
https://jntustack.com currently returns **404** -- the deploy ran without a
build step (`build_script: null`), so `dist/` was never generated on the
server and Express has nothing to serve at `/`. Not publicly accessible
until that's fixed: set the app's build command to `npm run build` and
redeploy (see "Deploying to Hostinger" #5).

## What this is

A custom Node.js site: a static-site generator (no framework, plain
template literals driven by `data/*.json`) plus a thin Express server that
serves the generated output and handles one dynamic route, `/api/ask`.

## Quick start (local)

```
npm install
npm run build      # generates dist/ AND dist/search-index.json
npm start          # boots server.js on process.env.PORT (defaults to 3000)
```

Tested and confirmed working: static file serving, /health, and /api/ask's
validation + graceful no-key error handling all checked with real curl
requests during this build. Only the live Anthropic call itself is
untested, since there's no API key yet.

## Deploying to Hostinger

1. Push this repo to GitHub.
2. hPanel -> Websites -> Add Website -> Node.js Apps -> connect the repo.
   Hostinger should auto-detect Express from package.json; if not, select
   "Other" manually.
3. Set the **ANTHROPIC_API_KEY** environment variable in hPanel (Node.js
   app -> Environment Variables) once you have a key -- never commit it to
   the repo. The app runs fine without it; /api/ask just returns a clean
   error until it's set.
4. Hostinger sets `PORT` itself -- server.js already defers to
   `process.env.PORT`, don't hardcode a port anywhere.
5. Build step on deploy MUST run `npm run build` before `npm start` (the
   homepage `dist/index.html` and the search index have to exist before the
   server boots, or Express serves nothing and the site 404s -- this is
   exactly the bug that left the first deploys returning 404). Set this as
   the app's build command in hPanel.
6. Connect jntustack.com to the deployed app (done -- DNS now resolves to
   Hostinger; the app just needs the build step above to actually serve).

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

1. **Make the site actually load.** jntustack.com is registered and DNS +
   the Express deploy are in place, but the live URL 404s because no build
   step ran -- set the app's build command to `npm run build` and redeploy
   so `dist/` exists on the server. (jntustack.in still unregistered.)
2. Get an Anthropic API key (console.anthropic.com) when ready to test
   the ask widget for real -- not required to launch without it.
3. Source the official R23 syllabus PDFs (see notes in
   `data/subjects-cse.json`) to flip subject records to `verified`.
4. Finish the JNTUK private-college list, then JNTUH/JNTUA/JNTUGV
   (`data/colleges-jntuk.json` coverage note has the blocker: the source
   page is JS-rendered, needs a browser-automation pass, not a plain fetch).
5. Branch hub / semester hub page templates don't exist yet -- only
   individual subject pages and the branch guide do.
6. Decide free-vs-rate-limited access model for the ask widget before
   linking `routes/ask.js` (/api/ask) from a live page.

## Design constraints worth preserving as this grows

- No fabricated statistics (placement %, salaries, college rankings)
  anywhere, ever -- this was a deliberate, repeated decision, not an
  oversight to "fix" later.
- Ad slots stay visually separated from download/resource boxes
  (AdSense policy + basic decency).
- Cross-link new-regulation pages to their old-regulation equivalents
  instead of orphaning them -- supply/backlog students still search those.
