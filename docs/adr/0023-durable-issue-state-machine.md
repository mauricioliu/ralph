# Durable per-issue state machine and restart reconciliation

## Context

The `parallel-planner-with-review` scaffold (ADR 0009: self-contained `main.mts`) persists one atomic receipt per issue in `.ralph/workflow-state.json`: `{ branch, phase, sha?, reviewedBase? }`. The receipts already gate recovery (a `merge-pending` receipt only authorizes a merger while branch SHA and reviewed target HEAD are unchanged), but nothing documents the machine as a whole, and a human resuming after a stop had no way to see which issue sits in which phase or what advances it — the receipts are write-optimized, not human-facing.

Issue #8 asks for both: an ADR recording the machine and its invariants, and a host-runnable reconciliation report. This ADR also records a decision already made by the owner: **issue closure stays manual**. It is not reopened here.

## Decision

### The state machine

One durable receipt per issue, written only by the coordinator (single per ADR 0022), atomically (`tmp` + `rename`). Persisted phases:

- **`implementing`** — the issue was selected and a branch is being produced. `sha` may be unset until commits exist.
- **`review-pending`** — an implementation exists (locally produced or recovered); acceptance review is due. Written when the implementer completes with commits, and on recovery of a pre-existing unmerged branch.
- **`merge-pending`** — the reviewer approved. Adds `reviewedBase` (target HEAD at approval) alongside the approved `sha`.
- **`merged`** — host-side git verification confirmed the approved SHA is an ancestor of the target.

The conceptual **pending** state is the absence of a receipt. There is deliberately no persisted **implemented** phase distinct from `review-pending`: once the implementer signals completion, the next durable fact is "awaiting review" — a crash in the gap loses nothing, because relaunch re-derives the branch SHA from git and reviews whatever commits exist.

Transitions:

- `pending → implementing` on authorized selection.
- `implementing → review-pending` on implementer completion with commits.
- `review-pending → merge-pending` on reviewer approval **plus** host checks: the branch exists, its tip is not yet in the target, and the target did not move during review.
- `merge-pending → merged` on merger completion **plus** host verification that the branch still points at the approved SHA and that SHA is an ancestor of HEAD.
- `merge-pending → review-pending` (re-review) when a relaunch finds the branch moved or the target advanced past `reviewedBase`.
- Recovery paths never go backwards to reimplement: existing commits on an unmerged branch enter at `review-pending`, including legacy branches with no receipt at all.

### No error phase — failures preserve the resume phase

Failures (quota errors, rejected reviews, no-progress stops, iteration exhaustion, crashes) never rewrite a receipt. Durable state records **verified facts only**; "error" is an exit condition of the coordinator, not a property of the issue. A quota stop during merge leaves `merge-pending` standing, and the next launch resumes from exactly that phase (tested). The durable machine is therefore: `implementing → review-pending → merge-pending → merged`, with error/blocked conserving whatever phase was last durably recorded.

### Invariants

1. **A review approves an exact SHA against an exact base.** The `merge-pending` receipt binds `sha` (approved branch tip) and `reviewedBase` (target HEAD at approval). Any later commit on the branch, or any advance of the target, invalidates the approval and forces re-review. Rationale: a review verdict is about one tree state; a different tree was never reviewed.
2. **Agent completion is never integration evidence.** Completion signals gate transitions, but the `merged` phase requires host-side `git merge-base --is-ancestor` verification; the merger's own `COMPLETE` is not believed without it.
3. **Receipts are atomic and coordinator-exclusive.** `tmp` + `rename` writes under the single-coordinator lock (ADR 0022); readers never see a torn file.
4. **Git is the authority; receipts are claims.** Any consumer (including the report below) re-derives branch existence, SHA and integration from git and uses receipts only for the recorded phase and review verdict.

### Restart reconciliation policy

- Relaunching the coordinator is the **only** recovery mechanism for forward progress. It re-derives everything from git plus receipts, so a restart after any stop is safe without cleanup.
- **Already-integrated branch, open issue → report-and-stop.** When the planner selects an issue whose branch tip is already an ancestor of the target but the issue is still open, the coordinator prints the reconciliation report and stops. It never reimplements, never force-replans, and **never retries closing the issue**: closure is a human decision (owner decision, 2026-09-10). No automatic GitHub mutations exist anywhere in the scaffold — no comments, no labels, no closes, no pushes.
- The human reconciles by closing the issue by hand or opening follow-up work, then relaunches (or adjusts the authorization).

### The reconciliation report

Form: **an environment-gated mode of the template itself** — `RALPH_RECONCILE=1 npx tsx .ralph/main.mts` (or `main.ts`). It prints, for every issue in the authorized set union every persisted receipt (so it still works when the original authorization environment was lost): current phase, canonical branch, SHA, and the concrete next step — e.g. "approval intact for `<sha>`; relaunch the coordinator to merge", "branch moved after approval …; relaunch re-reviews", "close issue #N manually".

Properties:

- Read-only: no model calls, no sandbox, no state writes, and **no coordinator lock** — it stays usable even while a coordinator runs (receipt writes are atomic, so reads are consistent). Lock exclusivity (ADR 0022) scopes to coordinators that mutate.
- Integration facts in the report come from live git ancestry, never from the receipt (invariant 4).
- The already-integrated stop prints this report instead of a bare instruction, then exits non-zero.

#### Why a mode of the template

1. **Env-gated mode of `main.mts`** (chosen) — the state schema and git helpers live in the template; a mode reuses them in place, so report and gates cannot drift apart. Matches the template's existing env-knob pattern (`RALPH_AUTHORIZED_ISSUES`) — the template parses no argv today.
2. **CLI subcommand (`ralph report`)** — rejected. Couples the published library to a template-owned state schema; every template tweak would become a library release. Against the spirit of ADR 0009.
3. **Separate scaffold script (`reconcile.mts`)** — rejected. A second copy of the schema and git helpers that drifts from the gates; `init` copies templates verbatim, so every user would ship the duplicate.
4. **argv flag** — rejected. The template has no argv parsing; env is the established interface and is what the test harness already substitutes.

## Consequences

- A human resuming after any stop runs `RALPH_RECONCILE=1` first and reads phase/branch/SHA/next-step per issue; the already-integrated stop is self-explanatory without opening the state file.
- The report can run concurrently with a live coordinator, at the cost that it reflects the last atomic write rather than in-flight phase changes — acceptable for a diagnostic.
- A stale receipt cannot lie about integration (git re-derived), but can lie about _absence_: a receipt-less integrated branch surfaces as "already integrated … close manually", which is the correct human decision anyway.
- Existing scaffold users must copy the updated `main.mts` to opt in (same as ADR 0022's changeset).
- Manual closure means an integrated issue may stay open in the tracker until a human acts; the report and the stop message both name that action explicitly. This is the owner's accepted trade, not a defect.
