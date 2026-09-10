---
"@mauricioliu/ralph": patch
---

Reject Pi assistant error/aborted outcomes even with exit code zero, while allowing Pi's own retries to recover before process exit. Revoke completion on failed or superseded turns. Use parsed assistant output only: prompt/tool markers in raw stdout can no longer produce completion or structured output. Preserve provider error detail on failed exits and idle failures.
