# NLP Content Request and Approval Flow

Status: planned design; not implemented
Recorded: 2026-07-15

This note records the agreed future workflow for turning a short admin request
into an evidence-backed content proposal that can be approved through Telegram.
It does not replace the current process in `docs/CONTENT_OPS_RUNBOOK.md`.

## Decision Summary

An administrator should be able to enter a plain-language request such as:

> Reconcile JNTUK R23 CSE 4-1 subjects with the latest official syllabus.

The system may use an LLM to interpret that sentence, but the LLM must produce
only a constrained, non-executable request. It must not edit content, approve a
proposal, write to GitHub, or hold publishing credentials.

The target flow is:

```text
Admin statement
  -> constrained RequestSpec JSON
  -> clarification when the request is ambiguous
  -> official evidence collection
  -> evidence-backed content proposal and diff
  -> deterministic validation and risk classification
  -> Telegram review/approval
  -> GitHub commit or pull request
  -> Hostinger automatic deployment
  -> live verification and rollback when required
```

The operating principle is:

> Natural-language requests, deterministic execution, evidence-backed
> proposals, and risk-based human approval.

## System Responsibilities

| Component | Responsibility | Must not do |
| --- | --- | --- |
| Admin dashboard | Capture the request, show progress, evidence, diffs, and final status. | Treat free text as an executable command. |
| LLM/NLP layer | Classify intent and extract a schema-constrained scope. | Fetch arbitrary URLs, invent academic facts, approve, or publish. |
| JNTUStack application | Own request state, evidence, proposals, validation, approvals, audit records, and publication policy. | Delegate content authority to n8n or Telegram. |
| Deterministic layer | Enforce schemas, source allowlists, operation limits, validation, risk rules, and tests. | Accept a proposal merely because its JSON is valid. |
| n8n | Schedule work, call narrow signed APIs, wait for outcomes, and deliver notifications. | Write production JSON or the database directly. |
| Telegram bot | Present a compact approval card and record an authenticated decision. | Accept unbound free-text approval or publish directly. |
| GitHub publisher | Apply the exact approved proposal hash through a commit or pull request. | Recompute or silently alter the approved diff. |
| Hostinger | Deploy the GitHub state automatically. | Become a separate content source of truth. |

JNTUStack remains the workflow authority. n8n is an orchestrator, and Telegram
is a review surface.

## Request Contract

The application should create immutable server-owned metadata such as the
request ID, requester identity, timestamps, and original statement. The LLM
should be allowed to fill only an intent payload such as:

```json
{
  "schema_version": 1,
  "action": "reconcile_subjects",
  "scope": {
    "university": "JNTUK",
    "regulation": "R23",
    "branch": "CSE",
    "semester": "4-1"
  },
  "source_policy": "official_allowlist_only",
  "requested_operations": ["add", "update"],
  "forbidden_operations": ["delete", "change_entity_key", "change_canonical_url"],
  "output_mode": "proposal_only"
}
```

Rules for the request contract:

- Reject unknown actions, fields, enum values, and unsupported scopes.
- Resolve university, regulation, branch, and semester against known IDs.
- Ask the administrator to clarify missing or conflicting details instead of
  guessing.
- Keep the original sentence alongside the normalized request.
- Version the schema so stored requests remain reproducible.
- Never let model output override server-owned identity, permissions, policy,
  or credentials.

## Proposal Contract

Evidence collection and extraction should create a second artifact. This is
the proposed content change, not the LLM's RequestSpec.

At minimum, a proposal should contain:

```json
{
  "schema_version": 1,
  "request_id": "req_...",
  "proposal_id": "prop_...",
  "proposal_hash": "sha256:...",
  "risk": "amber",
  "summary": {
    "add": 2,
    "update": 4,
    "delete": 0
  },
  "changes": [
    {
      "entity_key": "r23-cse-4-1-example",
      "operation": "update",
      "fields": ["credits"],
      "evidence": [
        {
          "source_url": "https://official.example/document.pdf",
          "source_checksum": "sha256:...",
          "page": 12,
          "supports_fields": ["credits"]
        }
      ]
    }
  ],
  "validation": {
    "schema": "passed",
    "evidence": "passed",
    "policy": "passed",
    "tests": "passed"
  }
}
```

Every changed factual field must be traceable to stored evidence. JSON schema
validity alone is not proof that a fact is correct.

The proposal hash must cover the normalized diff, evidence references, policy
version, and validation result. Any change creates a new hash and invalidates
an earlier approval.

## Deterministic Gates

Before requesting approval, the application must check:

- the request and proposal schemas;
- administrator authorization and request scope;
- official-domain/source allowlists and stored source checksums;
- exact entity matching and duplicate detection;
- field-level evidence coverage;
- current verified-only publishing rules;
- prohibited deletions, entity-key changes, slug changes, and canonical changes;
- configurable per-request and per-release batch limits;
- content schema validation, build, admin tests, retrieval tests, and site audit;
- whether the proposal is still current when approval is received.

Source documents and fetched web pages are untrusted input. Their text must not
be allowed to alter prompts, policies, tool permissions, or workflow state.

## Risk Lanes

### Green

Small, familiar, fully evidenced changes from an allowlisted official source.
All deterministic checks pass and no protected field changes. Telegram may
offer one-tap approval, but the first rollout still requires a human decision.

### Amber

New entities, uncertain matches, broader batches, verified promotions, or
changes that need evidence inspection. Telegram should link to the full admin
review. Approval may require an explicit source-reviewed confirmation in the
admin dashboard.

### Red

Deletion, entity-key/slug/canonical changes, untrusted or conflicting sources,
missing evidence, low confidence, unexpectedly large diffs, or failed checks.
Approval controls stay disabled until the request is corrected or narrowed.

Risk classification is deterministic and policy-versioned. The LLM may explain
a risk result but must not choose or lower it.

## Telegram Approval Card

The notification should show only the information needed to make a safe
decision:

```text
JNTUStack content proposal
Request: Reconcile JNTUK R23 CSE 4-1
Changes: 2 additions, 4 updates, 0 deletions
Source: JNTUK official syllabus
Validation: all required checks passed
Risk: AMBER
Proposal: sha256:abcd...

[Open evidence] [Open full diff]
[Approve] [Request changes] [Reject]
```

Telegram controls must use:

- allowlisted numeric user and chat IDs;
- authenticated webhooks and signed, single-use callback tokens;
- a proposal ID and immutable proposal hash;
- nonce, expiry, replay protection, and idempotency keys;
- role checks and configurable batch caps;
- a second confirmation for sensitive permitted actions;
- a complete audit record of the message, actor, decision, and timestamp.

Do not treat an ordinary Telegram reply such as “yes” as approval. If the
proposal or its evidence changes, expire the message and send a new approval
card.

## Suggested Request State Machine

```text
draft
  -> needs_clarification
  -> collecting_evidence
  -> proposal_ready
  -> validation_failed | pending_approval
  -> changes_requested | rejected | approved
  -> publishing
  -> deployed
  -> verification_failed
  -> rolled_back
```

Transitions must be explicit, authorized, idempotent, and recorded. Retrying an
n8n workflow or Telegram callback must not create duplicate proposals, commits,
or releases.

## Publishing Rule

For this future automated path, GitHub should be the first production write:

1. Re-read the approved proposal and verify its hash and expiry.
2. Re-run preflight checks against the current Git base commit.
3. Apply exactly the approved diff to a branch.
4. Run all required tests.
5. Commit or open a pull request with the request/proposal IDs in metadata.
6. Merge or push only under the configured risk policy.
7. Let Hostinger deploy the GitHub state.
8. Verify health, expected pages, canonicals, sitemap, and content hashes.
9. Mark the request deployed or initiate a documented rollback.

The existing live-JSON-first apply process must not be reused unchanged for
automation because a later Git deployment could overwrite it. Migrating to the
GitHub-first path is a separate implementation milestone.

## Dashboard Experience

The primary admin screen can expose one prompt:

> What should JNTUStack work on?

Useful examples:

- Check whether JNTUK has published a newer R23 CSE syllabus.
- Reconcile R23 ECE 3-2 subjects with this official PDF.
- Prepare updates for sources that have not been reviewed in 180 days.

After submission, show a simple timeline:

```text
Understanding request -> Collecting evidence -> Preparing proposal
-> Waiting for approval -> Publishing -> Verified live
```

Always provide a structured preview before starting evidence collection, and
ask for clarification when the scope is not safely resolvable.

## Rollout Plan

1. **Intent preview:** convert a statement to RequestSpec and require admin
   confirmation. No evidence collection or publication.
2. **Proposal preparation:** collect official evidence, build proposals, and
   show diffs in admin. Telegram sends notifications only.
3. **Telegram decisions:** enable authenticated approval for proven green
   cases; keep amber completion in admin and red blocked.
4. **GitHub publication:** publish the exact approved hash through a tested,
   GitHub-first path and verify the deployment.
5. **Selective zero-touch work:** consider only after a history of successful,
   reversible green changes. Keep high-impact content human-approved.

Each stage should have audit logs, metrics, failure alerts, and a kill switch
before the next stage starts.

## Known Failure Modes and Mitigations

| Risk | Mitigation |
| --- | --- |
| Ambiguous natural language | Clarification state and structured preview. |
| Plausible but false model output | Official evidence plus deterministic field-level checks. |
| Prompt injection in a source document | Treat source text as data; isolate tools and policy instructions. |
| Stale evidence | Store retrieval time/checksum and revalidate before publish. |
| Approval race after a proposal changes | Bind approval to proposal hash and current Git base. |
| Duplicate n8n execution or callback | Idempotency keys, nonces, and explicit state transitions. |
| Compromised Telegram account | User/chat allowlists, roles, expiry, caps, and sensitive-action confirmation. |
| Partial or failed deployment | Post-deploy verification and a tested rollback path. |
| LLM or n8n credential exposure | Give neither component direct production write credentials. |

## Decisions Still Needed Before Implementation

- LLM provider/model and whether a deterministic parser handles common intents
  before the LLM fallback.
- n8n Cloud versus a separately secured self-hosted instance.
- Telegram reviewer IDs, roles, and account recovery process.
- Exact green-lane actions and batch thresholds.
- Pull request versus direct protected-branch commit for approved green work.
- Required evidence acknowledgment for verified promotions.
- Deployment verification checks and automatic rollback authority.
- Migration plan from live-JSON-first apply to GitHub-first publishing.

Until those decisions are made and the staged implementation is tested, the
current guarded content workflow remains authoritative.
