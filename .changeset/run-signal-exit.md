---
"@mauricioliu/ralph": patch
---

Preserve the exit status of scripts terminated by SIGINT or SIGTERM in `ralph run` on Node 22, instead of incorrectly reporting success. Keep graceful signal forwarding and cleanup behavior.
