# Pi is the default agent harness

Ralph reconstructs only identity and Pi/credential improvements on the fixed
Sandcastle upstream base. Init preselects Pi and sandbox images install the
maintained `@earendil-works/pi-coding-agent`, not the abandoned
`@mariozechner/pi-coding-agent`. Other agent providers remain selectable.

## Decision

The five self-contained templates own the model policy: the planner uses
`openai-codex/gpt-6-astra:high`; workers (implementer, reviewer, merger and the
individual agent) use `zai-coding-cn/glm-5.3:high`. Thinking is inline in the
model string. Users edit role-specific calls in their scaffolded main file.
The registry's pair is picker guidance, not a role-aware rewriting engine.

Selecting Pi without `--model` preserves those calls verbatim. An explicit
`--model`, including the worker default itself, overrides all roles. Selecting
another agent rewrites imports and calls to that provider and one model: its
default unless explicitly overridden. Sandbox and filename rewrites always
run. Existing scaffolds are never silently migrated.

The default models use subscriptions: authenticate Pi on the host, not by
inventing API-key variables in `.env`. Init documents the existing one-way
credential transfer of `auth.json` and optional `models-store.json`, including
`PI_CODING_AGENT_DIR` and its `~/.pi/agent` default. The host remains authoritative;
sandbox refreshes never sync back. No-sandbox runs already use host credentials.
Issue tracker variables remain separate. Explicit model overrides require the
chosen model's Pi authentication on the host. Claude Code's OAuth-token guidance
and Codex's `CODEX_API_KEY` remain unchanged for those selections.

## Considered options

- **One model everywhere by default** loses the deliberate planner/worker split.
- **Role-aware registry rewriting** hides defaults behind extra machinery; visible,
  independent template calls are simpler (see [ADR 0009](0009-templates-no-shared-code.md)).
- **Remove `--model` or apply it only to planners** breaks the existing explicit
  override contract. Absence, not equality to a default string, controls the skip.
- **API-key-only default setup** cannot represent the approved subscription path.

## Consequences and validation

Alternate agents intentionally collapse the split, while keeping their own
installers and auth requirements. Credential transfer puts sensitive material
inside the sandbox; its permission, isolation and cleanup guarantees are
specified under [Pi sandbox credentials](../../README.md#pi-sandbox-credentials).
Templates retain upstream workflow behavior, including structured output and
merge-to-head; this decision does not add custom orchestration or change sessions.

Prompt doubles exercise interactive init without spawning agents or commands.
Non-interactive installed-package checks compile all templates for Pi defaults,
explicit overrides and alternate agents, without executing the scaffolds.
Real subscription availability, OAuth refresh and an authenticated sandbox run
remain separate manual validations; offline tests do not establish them.
