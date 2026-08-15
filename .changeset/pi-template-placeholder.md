---
"@mauricioliu/ralph": minor
---

Ship real `pi(...)` agent calls in the scaffold templates instead of the upstream `claudeCode` placeholder (ADR 0021). All five `ralph init` templates now default to pi's planner/worker model split — `openai-codex/gpt-5.6-terra:high` for the planner role, `zai-coding-cn/glm-5.3:high` for every other role (implementer, reviewer, merger, and the lone agent) — with the thinking level riding inline in the model string. `ralph init --agent pi` without `--model` keeps that split verbatim, while any other agent (or an explicit `--model`) rewrites the placeholder to the selected agent's factory and collapses every factory call to a single model; the model rewrite now also handles call sites spanning multiple lines (model on its own line, options on the lines after it) and preserves trailing factory options.
