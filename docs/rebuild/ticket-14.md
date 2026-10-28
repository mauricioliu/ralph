# Ticket #14 — Pi-first init and role-specific defaults

Scope: init, templates and their documentation/tests only, on
`rebuild/upstream-pi`. Blockers #11 and #13 were satisfied by the supplied local
receipts (`41b73db` and `eeb0830`). The original snapshot
`28129673b3f786a1a048385fbdaff268de45346e` was inspected with explicit read-only
`git -C` commands; no mixed commit or whole old file was ported.

## Behavior

- Pi is preselected and the picker shows both model defaults. Its sandbox image
  installs `@earendil-works/pi-coding-agent` before switching to the agent user.
- All five templates use Pi: planner `openai-codex/gpt-6-astra:high`, every worker
  (including reviewer, merger and the individual agent) `zai-coding-cn/glm-5.3:high`.
- Omitted `--model` stays absent through the CLI/scaffold seam, preserving Pi's
  template split. Explicit values override all roles, including values equal to
  either default. Model literals are safely escaped in generated TypeScript.
- Alternate agents still replace imports and calls, using their own default or
  explicit model. Sandbox rewriting and ESM extension detection always apply.
- Pi next steps and `.env.example` explain host subscription authentication and
  one-way credential transfer, without invented API keys. Issue tracker env is
  separate. Claude Code's OAuth-token/API-key alternative and Codex's
  `CODEX_API_KEY` are preserved and tested.
- README, role/credential glossary, ADR 0021 and one new minor changeset describe
  the behavior. Existing credential and completion changesets are not duplicated.

No orchestration policy, session handles, structured-output retries, streaming,
merge-to-head, security workflows or excluded fork features were changed.
Existing upstream tests were retained; only expectations for intentionally
changed Pi package/default-auth behavior were updated.

## Automated verification

- `npm run typecheck`: pass.
- `npm run build`: pass, including the public declaration audit.
- `npm test`: **63 files passed; 2128 tests passed, 2 existing skips**.
- `npm run test:package`: pass. Offline tarball installation, CLI/public imports,
  credential API declarations and **70 strictly compiled scaffolds**: all five
  templates in ESM/non-ESM projects for Pi defaults, Pi explicit override and
  the five alternative agents. No scaffold is executed.
- The 258 new scaffold tests inspect actual generated calls and roles across
  Docker/Podman and ESM/non-ESM combinations, omitted/explicit models, escaping
  and all issue tracker auth instructions. The 12 new interactive CLI tests use
  prompt doubles, fail-closed command/build doubles, and a temporary host home.
  They cover Pi preselection, alternate selections, explicit overrides and
  cancellation. No credentials are needed or read by init.
- `git diff --check`: pass. Original repo remains on `main` at
  `07a0252565c19e2156c40d7eabc21c65af09efaa`; only the integration worktree is edited.

## Manual validation — not claimed as automated passes

Real Pi installation in a real sandbox, subscription model/catalog availability,
OAuth login/refresh and authenticated inference still require separately
approved real-provider validation. None was attempted. No further agents,
Docker/Podman/cloud services, generic Ralph runner, GitHub mutations, pushes,
PRs, merges or releases were started by this ticket.
