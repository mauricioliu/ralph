---
"@mauricioliu/ralph": patch
---

Clarify the reconstructed identity/Pi scope, branch-strategy configuration, session-fork restrictions and retained structured-output retries. Document offline coverage separately from live-provider validation and provider-dependent process teardown; do not promise process termination from cancellation alone.

Correct runtime review findings: initialize Daytona's worktree from an existing SDK directory before returning a handle, with redacted failure and sandbox deletion. Validate credential directories against the physical worktree before writes or mode changes, rejecting symlink ancestors and unverifiable paths, and recheck at the one-way copy boundary. Apply per-launch Pi directory overrides using native host process environment (including Windows) and POSIX env only for Linux sandboxes, including warm handles. Run credential orchestration as typed Effect programs with injectable filesystem/transport primitives behind thin Promise adapters; preserve cancellation settling, cleanup and redaction.
