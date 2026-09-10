---
"@mauricioliu/ralph": minor
---

Harden parallel-planner-with-review with explicit launch authorization, conservative serial execution, durable phase receipts bound to branch SHA and reviewed target HEAD, recovery of pending branches without reimplementation, acceptance-review approval, verified merge ancestry and fail-stop behavior on errors/no progress/iteration exhaustion. Remove the planner's force-blocked fallback and automatic issue closure by the merger. Existing scaffold users must copy the updated main.mts and prompts to opt in; the historical template name is retained.
