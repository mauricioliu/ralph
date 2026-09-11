---
"@mauricioliu/ralph": minor
---

Refuse concurrent coordinators in the `parallel-planner-with-review` scaffold (ADR 0022). `main.mts` now takes `.ralph/workflow-lock.json` (exclusive `O_EXCL` create) right after the launch-authorization gate: a second launch against the same `.ralph/` installation while the owner PID is alive exits non-zero with a diagnostic before invoking any model, creating sandboxes, or mutating workflow state. A lock left by a crashed coordinator is removed and re-acquired automatically at the next launch; an unreadable lock is refused until removed manually. The lock is released in a `finally` on every exit that runs one — hard kills are covered by the dead-PID takeover path. Heartbeats refresh the lock each round for the diagnostic only and never evict a live owner, since a coordinator can legitimately spend hours inside one agent run. Existing scaffold users must copy the updated `main.mts` to opt in.
