---
"@mauricioliu/ralph": minor
---

Document the per-issue durable state machine and restart reconciliation in ADR 0023, and add a reconciliation report to the `parallel-planner-with-review` scaffold. `RALPH_RECONCILE=1 npx tsx .ralph/main.mts` now prints a read-only per-issue report — phase, branch, SHA and the concrete next step — derived from the persisted receipts plus live git ancestry, without taking the coordinator lock, invoking models or mutating anything; with no authorized issues it scopes to the receipts alone. The "already integrated, open issue" stop prints this report instead of a bare instruction before exiting non-zero. Failure stops still never rewrite receipts, so the report always shows the preserved resume phase. Issue closure remains manual; the scaffold performs no GitHub mutations. Existing scaffold users must copy the updated `main.mts` to opt in.
