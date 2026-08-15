---
"@mauricioliu/ralph": minor
---

Make `ralph init` pi-first (ADR 0021). The interactive agent picker preselects Pi and hints the planner/worker model pair (`openai-codex/gpt-5.6-terra:high` planner, `zai-coding-cn/glm-5.3:high` workers) instead of a single default model. Scaffolding with `--agent pi` and no `--model` now performs **no** agent/model rewriting, so the template's two-model split survives verbatim; any other agent — or an explicit `--model` — still collapses every factory call to a single model as before. The pi Dockerfile installs the maintained `@earendil-works/pi-coding-agent` package (replacing the abandoned `@mariozechner/pi-coding-agent`), and the pi `.env` example documents subscription auth via Ralph's host→sandbox credential transfer (`~/.pi/agent/auth.json`) instead of implying an Anthropic API key is the only auth path.
