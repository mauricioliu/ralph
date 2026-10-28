---
"@mauricioliu/ralph": patch
---

Fail Pi runs on terminal stream errors and exhausted retries even after a zero exit. Revoke stale completion on errors and restarted output, accept recovery only from a restarted successful assistant result, and exclude user/tool/raw output from Pi completion and structured output. Preserve upstream streaming, raw events, sessions, usage, timeouts and cancellation. Reject unsupported Pi session forks instead of silently resuming the parent in place.
