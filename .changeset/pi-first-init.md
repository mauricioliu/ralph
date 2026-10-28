---
"@mauricioliu/ralph": minor
---

Preselect Pi in init and install the maintained `@earendil-works/pi-coding-agent` in its sandbox image. Keep the templates' planner default `openai-codex/gpt-6-astra:high` and worker/reviewer/merger/individual default `zai-coding-cn/glm-5.3:high` when Pi is selected without `--model`. Explicit models still override all roles; alternate agents retain their factories, default models and authentication, including `CODEX_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN`.

Explain host subscription authentication and one-way credential transfer rather than requiring nonexistent API keys for the defaults. Document role vocabulary and the Pi decision; cover interactive init with doubles and non-interactive installed scaffolds without real agents or OAuth runs.
