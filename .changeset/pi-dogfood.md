---
"@mauricioliu/ralph": minor
---

Run the repo's own dogfood on pi (ADR 0021). The `.ralph/` Dockerfile now installs `@earendil-works/pi-coding-agent` globally as root instead of the Claude Code CLI — an unused Claude install was image bloat on the shipped-default path. The dogfood orchestration (`run.ts`) maps roles per the ADR's model policy: Planner runs `openai-codex/gpt-5.6-terra:high`, Implementer/Reviewer/Merger run `zai-coding-cn/glm-5.3:high`. The interactive, podman, and vercel smoke-test scripts construct pi providers with the worker model, and the vercel smoke test installs pi (via `npm install -g`) instead of Claude Code in the sandbox.
