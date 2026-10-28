# Repository dogfood — Pi

These files exercise Ralph's public API; they are not an alternative
orchestration engine or a reconstruction launcher.

## Roles and local setup

- Planner (including batch explore): `openai-codex/gpt-6-astra:high`.
- Implementer, reviewer, merger and manual smoke agents:
  `zai-coding-cn/glm-5.3:high`.
- `.ralph/Dockerfile` installs `@earendil-works/pi-coding-agent` as root, then
  drops to the UID/GID-aligned agent user. No Claude installation or baked auth.
- Authenticate Pi **on the host** using `/login` for both subscriptions. Ralph's
  existing credential provisioning copies host `auth.json` and optional
  `models-store.json` before sandboxed launches, including reusable sandboxes.
  Nothing copies refreshed credentials back. See
  [credential paths, overrides and security limits](../README.md#pi-sandbox-credentials).
- `.ralph/.env` holds GitHub configuration separately; no subscription API key
  or credential JSON is needed there. Never commit authentication files.
- The planner uses schema-validated `Output.object` with resumable repair, and
  implement/review calls supply the prompts' `ISSUE_NUMBER` argument.

## Internal GitHub workflows

The five upstream agent workflows now install Pi and use the in-process
`agent-workflows/with-pi-auth.ts` wrapper. Maintainers must separately configure:

| Secret                 | Meaning                                                                |
| ---------------------- | ---------------------------------------------------------------------- |
| `PI_AUTH_JSON`         | Required, non-empty Pi auth JSON object for the selected subscriptions |
| `PI_MODELS_STORE_JSON` | Optional, non-empty model-catalog JSON object if the defaults need it  |

Provision secrets through an approved secret-management channel, never through
source files, command-line JSON arguments, logs or artifacts. No secrets are
configured by this reconstruction. Fork PRs do not receive repository secrets;
the wrapper fails closed when auth is absent instead of using existing runner
credentials. These workflows are not enabled or dispatched by local tests.

The wrapper removes both secret environment variables before loading the workflow,
creates a unique OS-temp directory (0700) with credential files (0600), and sets
`PI_CODING_AGENT_DIR`. Workflow providers also point session lookup at this
directory so produce/extract/repair all resume the same Pi conversation.
Normal return, rejection and existing `process.exit()` failure paths remove it.
Forced termination (e.g. SIGKILL) cannot run cleanup; runner destruction is the
remaining cleanup boundary. Credentials/sessions are outside the repository and
artifact output paths. Refreshes are discarded, not written back to GitHub
secrets; maintainers must renew secrets out-of-band. The wrapper validates JSON
shape, not OAuth validity or provider/catalog availability.

Batch explore uses one Pi agent reading groups **sequentially**. Pi's built-in
tools have no Claude Agent/Task equivalent; no delegation extension, child
agents, copied personal extensions or simulated parallel exploration is installed.
The trusted batch upload, read-only explore job, separate validating apply job,
dry-run behavior, output schemas, reply/diff filtering and resumed extraction
retries remain upstream behavior.

PR review and PR implement retain `pull_request`, exact head-SHA checkout and
push leases. Conflict update retains `pull_request_target` with its same-repo
guard. Issue preflight, labels, permissions and GitHub handoffs remain upstream;
this is **not** the discarded fork's authorization allowlist, reviewed recovery,
coordinator lock, durable issue state or reconciliation workflow. Existing
upstream concurrency is retained, not expanded.

## Offline verification versus manual execution

After `npm ci`, run `npm run build`, `npm run typecheck`, `npm test` and
`npm run test:package`. Typecheck now includes these configuration-owned scripts
and tests. Static checks inspect deployable model/image configuration and security
contracts without importing live entry points. `.ralph/run.ts` is the executable
wrapper; `.ralph/workflow.ts` is an import-safe, repository-only callable boundary
using the current source public API and a required sandbox transport/repository.
Its behavior tests use the real Ralph APIs, temporary git repositories and
synthetic credentials with an inert sandbox transport. Agent output, GitHub
commands and install/build hooks are intercepted; no real agent, service or image
build runs. Tests cover validated plan consumption/repair, issue-to-branch/prompt
mapping, four concurrent branch lifetimes, failure/disposal settling, and ten-round
planning/merging bounds without depending on local names or loop syntax.
Credential tests use synthetic temporary fixtures only. The frozen security
fixture records the verified #14 head (`d5bd042`): workflow bytes may differ only
by the explicit Pi installation/auth-wrapper substitutions; extraction and apply
code are unchanged. Library and installed-scaffold tests still cover alternative
agents. Pi dogfood does not remove or reinterpret their public contracts.

The npm `ralph` script is a **real backlog runner**, not a validation command.
Likewise `test-podman`, `test-vercel` and `test-interactive` launch real agents;
the cloud example also needs separately configured Vercel project/account IDs.
Real image installation, model availability, login/refresh, inference, remote
workflow execution and sandbox isolation need separate human authorization and
validation. None is proven by the offline tests.

`.factory/implement-task.ts` also selects Pi workers, but its external
software-factory daemon is a legacy integration, not supplied or started here.
Its scheduling, pushes and PR lifecycle are outside Ralph's Pi support claim.
The Claude personal-tool settings in `.claude/settings.json` are not loaded by
Pi and are retained only for users of that alternate harness.
