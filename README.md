# JNTUStack -- project state as of this handoff

Domain: jntustack.com (primary) + jntustack.in (redirect to .com).
Both verified available; not yet registered.

## What this is

A custom Node.js static-site generator (no framework) for a JNTU student
resource site: course materials, a branch-choice guide, a college directory,
and the scaffolding for an AI study assistant. No database -- everything is
JSON in `data/`, rendered to static HTML by `scripts/build.js`.

## Quick start

```
npm install
npm run build              # -> dist/
node scripts/build-search-index.js   # -> dist/search-index.json (for the ask widget)
```

Open anything in `dist/` directly, or deploy `dist/` to Cloudflare Pages /
Vercel / any static host.

## What's real vs. what's scaffolding

| Piece | Status |
|---|---|
| Schema (`data/schema.json`) | Stable. Regulation/Branch/Subject/BranchProfile/College all defined, ajv-validated. |
| CSE R23 + R16 subject data | Mostly `needs_verification` -- only 2 R16 records are `verified` and actually publish. See each record's `notes` field. |
| Branch guide (6 branches) | `verified`, live, includes a working client-side quiz. No fabricated stats anywhere -- intentional. |
| JNTUK colleges | 33 real records (constituent + autonomous), sourced from jntukdaaportal.in. The larger private-affiliated list (~120+ more) and JNTUH/JNTUA/JNTUGV are NOT done -- see `_coverage_note` in `data/colleges-jntuk.json`. |
| Ask widget UI | Built, works standalone in mock mode. |
| `functions/api/ask.js` | Written correctly per Anthropic's API conventions, but NEVER tested against a live key. Run real questions through it before linking it from a live page. Model-calling is abstracted into `callModel()` specifically so swapping providers later doesn't touch retrieval/widget/validation code. |
| `lib/retrieve.js` | Tested, working keyword retrieval. Has a known limitation: naive keyword overlap, no semantic search. Fine at this corpus size; revisit if it grows ~10x. |

## The verified/needs_verification/placeholder discipline

This is load-bearing, not decorative: `scripts/build.js` refuses to publish
anything whose `source.status` isn't `verified`. Don't bypass this to get
more content live faster -- the whole point is that nothing reaches a
student without a real source behind it. `needs_verification` content
renders to `drafts/` with a visible orange watermark instead.

## Immediate next steps, roughly in order

1. Register jntustack.com + jntustack.in.
2. Get an Anthropic API key (console.anthropic.com) when ready to test
   the ask widget for real -- not required to launch without it.
3. Source the official R23 syllabus PDFs (see notes in
   `data/cse-r23-sample.json`) to flip subject records to `verified`.
4. Finish the JNTUK private-college list, then JNTUH/JNTUA/JNTUGV
   (`data/colleges-jntuk.json` coverage note has the blocker: the source
   page is JS-rendered, needs a browser-automation pass, not a plain fetch).
5. Branch hub / semester hub page templates don't exist yet -- only
   individual subject pages and the branch guide do.
6. Decide free-vs-rate-limited access model for the ask widget before
   deploying `functions/api/ask.js` live.

## Design constraints worth preserving as this grows

- No fabricated statistics (placement %, salaries, college rankings)
  anywhere, ever -- this was a deliberate, repeated decision, not an
  oversight to "fix" later.
- Ad slots stay visually separated from download/resource boxes
  (AdSense policy + basic decency).
- Cross-link new-regulation pages to their old-regulation equivalents
  instead of orphaning them -- supply/backlog students still search those.
