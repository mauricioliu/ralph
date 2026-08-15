---
"@mauricioliu/ralph": minor
---

Point the exported `DEFAULT_MODEL` at pi's worker model, `zai-coding-cn/glm-5.3:high`, and give the README a defaults-only honesty pass (ADR 0021). Every README passage that states a default — quick start, API and options-table examples, branch-strategy and resume/fork snippets, the default Dockerfile notes — now shows pi with the planner/worker pair (`openai-codex/gpt-5.6-terra:high` planner, `zai-coding-cn/glm-5.3:high` workers); Claude Code stays documented as one supported agent among several. The quick-start auth step now leads with pi's host→sandbox credential transfer instead of an `ANTHROPIC_API_KEY` fill-in, which remains documented for API-key agents.
