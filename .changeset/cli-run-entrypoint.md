---
"@mauricioliu/ralph": minor
---

Add `ralph run` to execute the current project\'s unique `.ralph/main.ts` or `.ralph/main.mts` with the included TypeScript runtime. Preserve terminal input/output, environment and exit codes, forward termination signals, and reject missing or ambiguous entry points before execution. Include `tsx` as a production dependency so installed packages can run scaffolds without downloading a separate runtime.
