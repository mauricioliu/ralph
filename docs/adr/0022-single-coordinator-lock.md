# Single-coordinator lock for scaffolded workflows

## Context

The `parallel-planner-with-review` scaffold (`main.mts`) runs as a plain node process on the **host** and owns the `.ralph/workflow-state.json` receipt store of its installation. Nothing prevented two coordinators from running against the same repository simultaneously — two planners authorizing work, two mergers racing the target branch, interleaved receipt writes (each atomic individually, but mutually unaware).

Issue #7 asks for simultaneity prevention: a second launch must refuse **before** invoking any model, creating sandboxes, or mutating workflow state. No evidence ties concurrent coordinators to the 2026-09-10 false-completion incident; this is prevention, not a fix for a proven cause.

ADR 0007 already decided this exact class of mechanism for **worktrees**. This ADR reuses its strategy at the workflow level, inline in the template (ADR 0009 forbids shared template code).

## Decision

The `parallel-planner-with-review` template acquires a coordinator lock at launch, immediately after the launch-authorization gate and before any model call, sandbox, or state read/write.

### Lock location and content

`.ralph/workflow-lock.json` in the **config directory** — the installation whose state the coordinator would mutate. Content:

```json
{
  "pid": 12345,
  "target": "main",
  "startedAt": "2026-09-10T21:00:00.000Z",
  "heartbeatAt": "2026-09-10T21:04:00.000Z"
}
```

`target` and the timestamps aid the diagnostic. One lock per installation (not per worktree, not per branch): the resource being protected is the installation's workflow state and target branch sequencing as a whole.

### Acquisition

Creation is exclusive (`writeFileSync` with `wx`/`O_EXCL`), preventing the meta-race of two launches both observing "no lock". If the file exists, the launcher reads and validates it, then checks owner liveness with `process.kill(pid, 0)` (`ESRCH` → dead, `EPERM` → alive under another user). Exactly as in ADR 0007, there is no wait/retry on a live owner — contention is a caller error and fails fast with a diagnostic naming the PID, target, timestamps, and the manual removal path.

Three outcomes for an existing lock:

1. **Live owner** → refuse: non-zero exit with the diagnostic above, before any model, sandbox, or state mutation.
2. **Dead owner (crashed coordinator)** → stale: log the takeover, `unlink`, re-acquire (bounded to 3 attempts). A crashed coordinator never permanently blocks future launches.
3. **Unreadable** (fails JSON/Zod parse) → refuse and require manual removal. Atomic writes mean corruption is a human event, not a crash artifact; overwriting an unreadable lock could evict a live coordinator we cannot identify.

### Heartbeat is diagnostic-only

`heartbeatAt` is refreshed (atomic tmp+rename) at the top of every round and surfaced in the refusal diagnostic. It is **never** used to evict an owner: a coordinator may legitimately spend unbounded time inside a single agent run (an implementer with `maxIterations: 100` plus `npm install` hooks can run for hours), so heartbeat staleness cannot distinguish a stuck-but-alive coordinator from a healthy one. Dead-PID liveness is the sole eviction authority. This is the deliberate difference from naive heartbeat-lease designs.

### Release

The entire main loop (including the iteration-limit throw) runs inside `try { … } finally { releaseLock(); }` — success, expected stop, and any thrown error all release the lock. Exits that skip `finally` (SIGKILL, power loss) leave the lock behind; the next launch recovers through the dead-PID path. This makes immediate relaunch after a failed run possible (tested), rather than relying on takeover.

## Consequences

- A second coordinator on the same installation exits non-zero with a clear diagnostic before doing any work.
- A crashed coordinator self-heals at the next launch; no manual cleanup in the common case.
- PID recycling by an unrelated live process can, in theory, outlive a coordinator and force the manual-removal path named in the diagnostic; heartbeat staleness in that message helps a human see something is off. Accepted: rare, and fail-closed beats silently running two coordinators.
- Existing scaffold users must copy the updated `main.mts` to opt in (same as the safe-recovery changeset).

## Rejected alternatives

- **Heartbeat-lease eviction** (stale heartbeat → declare dead even if PID alive) — evicts healthy coordinators in long phases; see above.
- **Wait/retry on a live owner** — ADR 0007 already rejected waiting: contention is a caller error, and fail-fast matches the scaffold's philosophy.
- **Lock record inside `workflow-state.json`** — couples lock lifetime to every atomic receipt rewrite, and a corrupt state file would then also be a corrupt lock. Separate file, separate failure modes.
- **Library-level lock in `run()`** — protects a single `run()`, not the workflow process; the coordinator, not the library, is the mutually exclusive resource.
