# Pi is the default agent harness

## Context

This repo is a personal fork of mattpocock/sandcastle, published as
`@mauricioliu/ralph`. The owner runs agents through the pi coding agent
(`@earendil-works/pi-coding-agent`) on two OAuth-subscription models:
`openai-codex/gpt-5.6-terra` (ChatGPT Plus/Pro) for planning, and
`zai-coding-cn/glm-5.3` (ZAI Coding Plan) for everything else. Upstream
scaffolds Claude Code as the default, uses `claudeCode(...)` as the placeholder
factory in every template, and its init rewrite collapses all agent roles to a
single model. Ten decisions were settled in a grilling session and are recorded
here as one unit.

## Decision

Pi becomes the fork's default harness, end to end:

- **Model policy**: the **planner** role defaults to
  `openai-codex/gpt-5.6-terra:high`; every other **agent role** (implementer,
  reviewer, merger, and the lone agent in blank/simple-loop) defaults to
  `zai-coding-cn/glm-5.3:high`. Thinking level rides inline in the model string
  (`:high`), which pi natively supports.
- **Templates are the source of truth**: all five scaffold templates ship real
  `ralph.pi("...:high")` calls instead of the upstream `claudeCode` placeholder.
  All per-project config happens in the scaffolded `main.ts`; users edit there.
- **Rewrite skip**: `rewriteMainTs` skips the agent/model rewrite when the
  selected agent is `pi` and no `--model` was passed, so the two-model split
  survives verbatim. Any other agent selection (or an explicit `--model`)
  triggers the rewrite as today, collapsing all roles to one model.
- **Auth**: pi's subscription models have no API-key env vars. The host's
  `~/.pi/agent/auth.json` (plus `models-store.json` when a fresh sandbox needs
  the catalog) is transferred into each sandbox before the agent starts,
  mirroring the session-transfer mechanism. The host copy stays authoritative.
- **Init**: the agent picker preselects `pi`, hinting the planner/worker model
  pair. The pi Dockerfile installs `@earendil-works/pi-coding-agent` (the
  maintained monorepo package), not the abandoned
  `@mariozechner/pi-coding-agent`.
- **Dogfood**: this repo's `.ralph/` runs pi exclusively (Dockerfile, `run.ts`,
  test scripts).
- **Public API**: `DEFAULT_MODEL` repoints to `zai-coding-cn/glm-5.3:high` --
  the worker default is the generic default, since a lone agent is a worker.
- **README**: defaults-only honesty pass; Claude Code remains documented as one
  supported agent among several.

## Considered Options

- **Role-aware rewriting** (registry `plannerModel`/`workerModel` + role marker
  comments in templates) -- rejected: general machinery the fork's single user
  will never spend, and the defaults would live in registry data instead of
  visible template code.
- **Env-var auth only** (`ZAI_CODING_CN_API_KEY` etc. in the scaffold `.env`)
  -- rejected: `gpt-5.6-terra` is reachable only via subscription OAuth, so
  env vars cannot serve the planner default in sandboxes.
- **Dogfood additive** (pi installed alongside Claude in `.ralph/`) --
  rejected: the dogfood config should exercise the shipped default path; an
  unused Claude install is image bloat.
- **`--model` overrides the planner model / drop `--model` for pi** --
  rejected: all config happens in `main.ts`; `--model` keeps its existing
  "one model everywhere, explicitly chosen" semantics.

## Consequences

- Selecting a non-pi agent during init discards the planner/worker split --
  accepted for a fork whose default path is always pi.
- OAuth tokens land inside every sandbox -- same trust level as the API keys
  Ralph already injects via `.env`; a sandbox-side token refresh does not
  propagate back to the host, which stays authoritative.
- The template placeholder convention flips from `claudeCode` to `pi`;
  merging upstream template changes now requires reconciling against
  pi-first content.
