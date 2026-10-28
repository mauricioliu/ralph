# Ticket #13 — isolated and host Pi credential validation

Scope: Pi/credentials only, on `rebuild/upstream-pi`, following the locally
verified #12 receipt (`81cb022`). No agents, containers, cloud services or OAuth
flows are started by this validation. All credentials are synthetic temp files.
The original snapshot was inspected read-only; no whole-file/commit ports.

## Behavior

- The existing `toCredentialHandle` adapter normalizes bind-mount `copyFileIn`
  and isolated `copyIn` to one-way `copyFile`, preserving method receivers.
  It exposes neither reverse copy nor session operations. The transfer policy
  remains independent of runtime names and container implementations. Normalized
  credential destinations inside the handle\'s worktree are rejected before
  copying bytes, preventing accidental untracked-file sync into host artifacts.
- Discover the normal exec user's effective `PI_CODING_AGENT_DIR`, otherwise
  `$HOME/.pi/agent`. Empty HOME without an override fails closed. Identity
  discovery is unprivileged; only ownership repair requests `sudo`.
- Explicit `credentials.sandboxAgentDir` takes precedence over
  `PiOptions.env.PI_CODING_AGENT_DIR`. Both now also apply to the actual print
  command/interactive argv on every launch. This fixes warm sandboxes created
  before the agent was selected, not just one-shot sandbox creation env.
- Daytona now merges launch env into SDK `envVars`, preserving other template
  env keys and overriding conflicts. Its synced repository is now the
  `ralph-workspace/` child of the SDK work directory: when that directory is
  HOME, `~/.pi/agent` is no longer part of the repository. Vercel's existing SDK
  env forwarding and single-file upload already satisfy the transfer contract.
- No-sandbox bypasses the provisioning hook altogether and uses the host's
  effective Pi directory. Providers without the hook also bypass transfer.
  Ralph does not change host auth/catalog bytes or permissions. Pi itself may
  refresh its host credentials during a real run; that is not a Ralph copy.
- Host auth is authoritative: private staging/destination permissions are
  checked, errors stop launch, cancellation awaits pending copy, and later
  calls copy from host again. Removed catalogs cannot survive reuse.

## Automated entry/provider matrix

`CredentialProviderMatrix.test.ts` exercises the actual public APIs and
lifecycle/sync code with provider doubles. Only git and shell utilities run;
print commands are intercepted before execution and replaced with a directory
probe, and interactive calls are recorded. The doubles implement the same
normal-user HOME/identity and copy contracts, without emulating a cloud service.

| Public entry                                   | Bind-mount double      | Isolated double        | No-sandbox double |
| ---------------------------------------------- | ---------------------- | ---------------------- | ----------------- |
| `run()`                                        | transfer               | `copyIn` transfer      | hook skipped      |
| `interactive()`                                | transfer               | `copyIn` transfer      | hook skipped      |
| `Worktree.run()`                               | transfer               | `copyIn` transfer      | hook skipped      |
| `Worktree.interactive()`                       | transfer               | `copyIn` transfer      | hook skipped      |
| `Sandbox.run()`                                | transfer on every call | transfer on every call | hook skipped      |
| `Sandbox.interactive()`                        | transfer on every call | transfer on every call | hook skipped      |
| Worktree-created `Sandbox.run()/interactive()` | both variants          | both variants          | both variants     |

Across every entry/family: HOME resolution, both explicit override forms,
optional catalog absence, pre-abort, non-opt-in behavior, unchanged host files.
For sandboxed entries: rejection of credential directories inside the synced
worktree, missing copy capability, preparation/copy/permission/
cleanup failures, no launch after failure, copy cancellation, cleanup and retry.
Reusable sandbox variants also exercise sandbox-only token refresh and stale
catalog removal without replacing the handle. One-shot handles close; warm
handles remain caller-owned. Cleanup failures explicitly require closing the
sandbox instead of claiming a safe retry.

| Additional seam                          | Coverage                                                                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel SDK double                        | native handle → `copyIn` → single-file `writeFiles`; normal HOME, runtime env override, modes, sudo ownership repair, failed upload/chown cleanup and reuse, no downloads |
| Daytona SDK double                       | native handle → `copyIn` → `uploadFile`; same credential cases plus launch/template env precedence                                                                        |
| `CredentialProvision.test.ts`            | missing/non-function exec/copy, receiver binding, no reverse capability, opt-in policy, sanitized untyped errors                                                          |
| `PiCredentials.test.ts`                  | synthetic host env/defaults, invalid paths/HOME, missing auth, permissions, symlinks, in-flight copy cancellation, failed cleanup                                         |
| Existing `CredentialEntrypoints.test.ts` | bind-mount entry/reuse coverage and separate original session handles for capture/resume                                                                                  |

Leak assertions cover public errors/results, transport command strings, stream
callbacks, generated run logs and repository artifacts outside git internals.
Synthetic token/catalog values may appear **only** in the host fixture and the
sandbox credential destinations; they must not appear in those outputs.

## Limits — not automated passes

- Real Vercel/Daytona SDK connections, filesystem ownership, actual execution
  user/HOME, cloud sudo policy and teardown require separately authorized real
  runtime validation. SDK doubles prove adapter wiring, not cloud availability.
- Native Vercel/Daytona handles do **not** currently implement `interactiveExec`;
  those APIs reject as unsupported. Isolated interactive entry coverage uses
  custom doubles with that optional capability; it is not a claim of a new
  built-in interactive transport.
- Real Pi/OAuth login, token refresh, provider catalog compatibility and
  authenticated inference remain required manual validations. None was run.
- Sandbox provisioning requires POSIX shell utilities (`stat -c`, `chmod`,
  `mv`, etc.). Explicit launch overrides also use POSIX `env`. This matrix is
  Linux-host validation, not native Windows/no-sandbox override or non-POSIX
  runtime certification. Default no-sandbox launches do not use those transfer
  commands. Cross-platform real execution is not established by these tests.
- Session capture/resume, structured-output retries, streaming/raw events,
  merge-to-head and workflow security retain upstream behavior and tests.
  Isolated credential support does not add isolated session persistence.

The existing Pi credential minor changeset is extended, not duplicated.
Verification commands: `npm run typecheck`, `npm test`, `npm run build`,
`npm run test:package` (offline package/scaffold checks, no agent execution).

Final host verification: typecheck, full tests, build/public declaration audit
and offline package smoke all passed: **61 files, 1858 tests passed**, with the
two existing upstream skips. Package smoke compiled all 10 scaffolds; no tests
were removed or disabled.
