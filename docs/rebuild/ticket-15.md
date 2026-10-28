# Ticket #15 — Pi repository dogfood

Scope: repository-owned scripts, configuration, internal workflow harness wiring,
related tests and docs only, on `rebuild/upstream-pi`. Blocker #14 was satisfied
by the supplied local receipt at `d5bd042840208040c611f152ef3c9762dd4b75f2`.
The original snapshot `28129673b3f786a1a048385fbdaff268de45346e` and selective
`eee0704` dogfood changes were inspected with explicit read-only `git -C` commands;
no old file or mixed commit was copied wholesale.

## Implementation and audit

| Surface                             | Result                                                                                                                                                                                                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.ralph/run.ts`                     | Pi planner `openai-codex/gpt-6-astra:high`; implementer/reviewer/merger `zai-coding-cn/glm-5.3:high`; validated planner output with upstream resumable repair; fix stale `TASK_ID` argument to match the actual `ISSUE_NUMBER` prompts and strict indexing |
| `.ralph/Dockerfile`, `.env.example` | Pi installation before dropping UID/GID privileges; host subscription auth and existing one-way credential provisioning, no baked auth or Claude install                                                                                                   |
| Three manual smoke scripts          | Pi worker providers; cloud install hook installs Pi with sudo; interactive merge-to-head preserved; none executed                                                                                                                                          |
| `.factory/implement-task.ts`        | Pi workers; external daemon and its lifecycle explicitly outside the validation/support claim; not executed                                                                                                                                                |
| Five agent workflows                | Pi installation and private in-process auth wrapper; existing events, guards, permissions, preflight, concurrency, head SHA, leases, labels and GitHub handoffs preserved                                                                                  |
| Workflow provider factory           | Pi role models, with host session lookup in the selected credential directory so extraction/repair resumes use the same temporary Pi home                                                                                                                  |
| Explore prompt                      | Sequential group reading with built-in tools, no assumed Claude Agent/Task tool or delegation extension; untrusted-content and read-only rules retained                                                                                                    |
| Extract/apply/review validation     | Unchanged schemas, retries, batch validation, diff/reply filters, dry-run/apply separation and trusted batch artifacts                                                                                                                                     |
| CI/release workflows                | No Claude dependency; unchanged and not dispatched                                                                                                                                                                                                         |
| Repository skills/settings          | Triage repro command examples use Ralph/Pi, preserving untrusted-content and no-secret rules; pre-release skill is harness-neutral; personal Claude settings remain alternate-only                                                                         |
| Alternate providers                 | No library/provider changes; existing tests and installed scaffold coverage retained; personal Claude settings remain alternate-harness configuration, not a Pi dependency                                                                                 |

The CI wrapper requires a separately provisioned `PI_AUTH_JSON` secret and accepts
optional `PI_MODELS_STORE_JSON`. It validates JSON shape without echoing input,
removes secret env variables, writes only to a unique private OS-temp directory
(0700; files 0600), and cleans on success, rejection and existing process.exit
paths. It fails closed instead of falling back to runner auth. Refreshed auth
is discarded; no GitHub-secret updates or sandbox-to-host auth copyback occur.
SIGKILL cleanup, secret renewal, provider availability and OAuth validity are
explicitly not guaranteed. Credentials and sessions are outside artifacts/repo.

`npm run typecheck` additionally checks configuration-owned scripts/tests against
built public declarations. Static AST tests inspect executable entry points
without importing or running them. The frozen SHA-256 fixture records 17 files
from the verified #14 integration head, allowing only the explicit Pi harness
substitutions in workflows and no changes to protected extraction/apply code.
The existing identity security tests now assert the wrapper entry point; none
of their security expectations was removed or weakened.

README, `.ralph/README.md` and one new minor changeset document setup and limits.
No MiniMax, fork-specific allowlist, reviewed recovery, coordinator lock, durable
issue state/reconciliation or future ticket work was ported.

## Verification

- `npm run build`: pass, including public declaration Effect-leak audit.
- `npm run typecheck`: pass, library and strict dogfood configuration checks.
- `npm test`: **65 files passed; 2173 tests passed, 2 existing skips**.
- `npm run test:package`: pass, offline tarball install, CLI/public imports,
  credential API types and **70 compiled scaffolds**, including Pi defaults,
  explicit override and all five alternate agents; no scaffold executed.
- 45 new tests: 32 static dogfood/security checks and 13 synthetic credential/
  session/role checks. No developer auth files or credentials were read.
- `git diff --check`: pass.

An initial verification command incorrectly overlapped build and tests: tsup's
normal dist cleanup caused CLI tests to see missing dist/main.js. The full suite
was rerun after the successful build and passed as reported above; no tests or
acceptance conditions were relaxed to address that invocation error.

The original repo remains on `main` at
`07a0252565c19e2156c40d7eabc21c65af09efaa` with its pending work untouched; all
implementation edits are in the integration worktree. No agents, real OAuth
runs, Docker/Podman/cloud services, generic Ralph runner, backlog tasks, remote
workflows, GitHub mutations, pushes, PRs, main merges or releases were started.

## Required manual validation — not claimed as a pass

Separately authorize and validate actual image installation, subscription model/
catalog availability, login/refresh and inference, sandbox isolation, and remote
GitHub execution with maintainer-provisioned Pi secrets. Legacy factory daemon
behavior and the account-specific Vercel example also require external setup.
The manual `ralph`/`test-*` scripts are not offline checks and were not run.
