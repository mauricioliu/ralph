# Ticket #16 — final reconstruction audit

## Disposition

**Blocked; not an all-green completion receipt.** Integration build, typecheck,
2,180 tests and offline package smoke pass. Two upstream tests remain skipped.
Repository-wide format checking still fails on one inherited, security-frozen
workflow. More importantly, the original working copy/index no longer match the
saved baseline. No original files were edited or restored by this task.
See the preservation section before accepting the reconstruction.

Scope remains **Ralph identity and Pi/credentials only**, on
`/home/mauricio-liu/Projects/ralph-rebuild`, branch `rebuild/upstream-pi`.
The supplied locally verified #15 receipt at `8f4d70a` satisfies this ticket's
blocker; no issue was queried, changed or closed. No further agent processes,
real agents, OAuth flows, containers, cloud services or generic Ralph runner
were started. GitHub workflows were inspected, not dispatched.

## Commit map and selection inventory

Fixed upstream: `a53e227250fb51df0ad54155b85fecc1c090c937`.
Read-only original snapshot: `28129673b3f786a1a048385fbdaff268de45346e`.
Original main: `07a0252565c19e2156c40d7eabc21c65af09efaa`.
No blanket cherry-picks or whole old runtime files were ported.

| Block | Integration commits                        | Selected behavior / reference                                                                                                                           |
| ----- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #9    | `a53e227`                                  | Independent upstream build/typecheck/tests baseline; backup and snapshot                                                                                |
| #10   | `16878e6`, `895e4aa`                       | Ralph identity, package/import/config paths, distribution checks; original identity reference `b846db7`                                                 |
| #11   | `41b73db`                                  | Pi terminal errors, retry exhaustion, stale completion invalidation, explicit unsupported-fork rejection; selectively from mixed original `01e2f01`     |
| #12   | `81cb022`                                  | One-way host credential provisioning on every sandboxed entry; original `644e61a` and snapshot pending work                                             |
| #13   | `eeb0830`                                  | Isolated adapters, warm-handle overrides, host bypass, secret-free artifacts, cleanup and provider contracts                                            |
| #14   | `d5bd042`                                  | Pi-first init and role models, explicit override and alternate-agent auth; original `a15cd35`, `3c8dd94`, `32a86fe`, `57a1bd4`, snapshot planner update |
| #15   | `8f4d70a`                                  | Pi dogfood/internal workflows, isolated CI auth, sequential explore; original `eee0704` selected without old orchestration                              |
| #16   | This audit commit (`git log --grep='#16'`) | Seven public-API Pi compatibility cases, current-documentation corrections, four inherited formatting repairs, this review/coverage receipt             |

The original `7c30cee` review correction and snapshot were references, not
instructions to restore the fork wholesale. The initial inventory and backup
manifest are in `/home/mauricio-liu/.local/state/ralph/rebuild-20261027-223742/`.
The receipts for #10/#11/#13/#14/#15 are next to this file; #12 is also covered
by the supplied local receipt and the #13 provider matrix.

### Cumulative differences from upstream

| Surface             | Own layer                                                                                              | Preserved upstream contract                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Identity/package    | `@mauricioliu/ralph`, `ralph`, `.ralph`, artifact prefixes, repository metadata                        | MIT attribution, historical changelog, inherited 0.12.0 version; no legacy-path fallback or automatic migration                   |
| Public distribution | Production `@standard-schema/spec` dependency; credential hook/error types                             | All prior public exports and sandbox subpaths; Effect-free declarations; strict installed consumer types                          |
| Pi stream           | Assistant-only output, terminal failure, completion revocation, restart recovery                       | Raw stream delivery and parsed text; other agent-provider behavior and native session storage                                     |
| Credentials         | `PiCredentials`, `CredentialProvision`, narrow credential handle, typed redacted error, adapter wiring | Original session handle is separate; no isolated-session feature silently added                                                   |
| Sandbox plumbing    | Launch provisioning; Daytona env forwarding and repository child path prevent auth entering sync       | Session capture/resume, lifecycle, repeated sync, branch strategy, git/windows fixes and teardown ownership                       |
| Init/templates      | Pi installer and role models; explicit all-role override; alternative factories/auth retained          | Five self-contained templates and their upstream orchestration, prompts and schemas                                               |
| Dogfood/CI          | Pi role calls; private temporary CI auth/session wrapper; sequential group reading                     | Events, permissions, preflight, head-SHA checkouts, push leases, trusted batch/apply separation, validation and extraction repair |
| #16 docs/tests      | Clarify branch-strategy configuration, retries, fork/transport/teardown limits                         | No production execution logic or security policy changed by #16                                                                   |

[Executable comparison ledger](upstream-runtime-comparison.json): all **81**
existing non-test TS/MTS paths (including declarations/config) were mapped through
the config-directory rename. After normalizing identity strings, TypeScript
ESNext transpilation with comments removed is identical for **50**, differs for
**31**, and has **0** missing paths. This is executable-text evidence, not a
proof of public type equivalence. Typecheck and strict installed-consumer smoke
supply separate type evidence. New credential and CI wrapper modules are outside
that existing-path comparison and covered by the contract matrix below.

The 31 differences fall into Pi provider/credential dispatch, init/CLI defaults,
role-model template/dogfood wiring, Daytona credential isolation, public
credential exports/errors, and identity repository metadata/bundle namespace.
Notably `run.ts`, `SessionStore.ts`, `WorktreeManager.ts`, `syncIn.ts`,
`syncOut.ts`, `SandboxLifecycle.ts`, stream emitter/buffer, abort racing,
structured-output extraction, Docker/Podman/Vercel and no-sandbox have identical
normalized executable output. Workflow extraction/apply/filtering modules also
remain in the equal group. All 54 upstream test files still exist, including
the config-owned batch test moved to `.ralph`; no tests were removed or disabled
by #16.

### Explicit exclusions

| Original-fork inventory                                        | Disposition                                                                         |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| MiniMax (`bd04fbf`, `src/agents/minimax/`, original changeset) | Not ported; no factory, CLI choice, export or installer                             |
| Original launch authorization allowlist                        | Not ported; retain newer upstream workflow guards instead                           |
| Reviewed branch recovery (mixed `01e2f01`)                     | Not ported; original `reviewWorkflow.test.ts` failures are not imported or repaired |
| Coordinator lock (`364675c`, ADR 0022)                         | Not ported; inherited worktree locking is a different mechanism and remains         |
| Durable issue state/reconciliation (`07a0252`, ADR 0023)       | Not ported; no issue-state store, journal, reconcile workflow or current policy     |
| Old docs application/site                                      | Not restored                                                                        |
| New original CLI runner work observed during #16               | Not ported; outside approved snapshot/scope                                         |

README, CONTEXT, ADR 0021 and all changesets were reviewed against this boundary.
The old fork's ADRs 0022/0023 and discarded-feature changesets are absent.
Historical upstream ADRs/research remain history, not fork policy. ADR 0010 now
acknowledges the newer upstream retry implementation; ADR 0018 distinguishes Pi
resume from native Claude/Codex fork and records existing random-suffix hardening.
README/CONTEXT no longer say branch strategy is constructed on the provider.
Cancellation docs/JSDoc no longer promise unconditional process killing. A new
patch changeset covers these documentation corrections, without duplicating
existing Pi feature changesets or invoking release/version tooling.

## Coverage matrix — offline, synthetic only

| Contract                       | Evidence                                                                                       | Established / limit                                                                                                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pi capture and in-place resume | `PiCompatibility.test.ts`, `AgentProvider.test.ts`, `SessionStore.test.ts`                     | Actual temporary JSONL capture, host/sandbox cwd rewriting, same ID, warm `.resume()`; synthetic provider exec, not Pi inference                                                                |
| Structured-output retries      | New Pi success/exhaustion cases, retained `run.test.ts` and extraction tests                   | Bad JSON resumes same Pi session with feedback, bounded exhaustion preserves failed session identity; no reimplementation of upstream loop                                                      |
| Repeated handles               | New warm sandbox contract; `CredentialProviderMatrix`, `createSandbox`, `createWorktree` tests | Reuse/capture/resume, latest host auth on each launch, still usable after timeout/abort; no real service lifecycle claim                                                                        |
| Session fork vs git branch     | New rejected warm Pi `.fork()` and temp-branch merge contract; retained Claude/Codex tests     | Pi never launches a fork, captured parent stays unchanged; merge-to-head still merges a real synthetic git commit and cleans temp branch                                                        |
| Streaming/raw                  | New parsed-text/verbatim-line assertions; `PiStream`, `Orchestrator`, buffer tests             | Raw user/unknown lines forwarded but cannot determine completion/structured output; parsed assistant remains authoritative                                                                      |
| Completion, idle, cancellation | New pending-exec cases and retained orchestrator timer/error tests                             | Completion succeeds; idle fails; mid-flight abort surfaces exact reason; warm handle remains usable. Pending double owns no actual process: process termination is NOT proven                   |
| Bind-mount / isolated / none   | `CredentialProviderMatrix.test.ts`, `CredentialEntrypoints.test.ts`                            | Eight entry variants in all three families: six APIs plus worktree-created sandbox run/interactive. Normal HOME, explicit overrides, host skip, stale catalog removal and reuse                 |
| Permissions/failure/cleanup    | `PiCredentials`, `CredentialProvision`, matrix tests                                           | Private 0700 dirs/0600 files, synthetic auth/catalog only, opt-in, fail-closed errors, forbidden worktree destinations, copy cancellation and cleanup/retry                                     |
| Cloud adapter contracts        | `IsolatedCredentialAdapters.test.ts`                                                           | Vercel/Daytona SDK doubles only, env/copy/ownership/cleanup wiring; not cloud availability or live ownership certification                                                                      |
| No secret artifacts/copyback   | Matrix and CI auth tests                                                                       | Synthetic-token scans of results, errors, transport commands, streams, logs and repo artifacts; host stays authoritative                                                                        |
| Init/scaffolds and package     | Init/CLI/default tests; `scripts/smoke-package.mjs`                                            | Offline installed tarball, CLI version/help, every runtime import, credential API types, 70 strict scaffolds across ESM/non-ESM, Pi default/override and all alternatives; no scaffold executed |
| Workflow security              | `packageIdentity.test.ts`, `.ralph/dogfood.test.ts`                                            | Exact event/guard/head tests and 17-file frozen SHA fixture; fixture/assertions unchanged by #16; no workflow dispatched                                                                        |

## Verification results and baseline differences

Run build **before** typecheck/CLI tests/package smoke, never concurrently with
them: tsup clears dist. Final offline results:

| Command                                              | Result                                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `npm run build`                                      | PASS, including Effect-free public declaration audit                                |
| `npm run typecheck`                                  | PASS, library and strict dogfood configuration                                      |
| `npm test`                                           | PASS: 66 files, **2180 passed, 2 existing skips**                                   |
| `npm run test:package`                               | PASS: offline tarball install/CLI/imports/credential types, **70** strict scaffolds |
| `npm run format:check`                               | **FAIL (inherited)**: `.github/workflows/release.yml` only; not reported as PASS    |
| `git diff --check`                                   | PASS                                                                                |
| Original HEAD/main and backup ref                    | PASS at saved commit IDs                                                            |
| Original working-copy/index preservation vs manifest | **BLOCKED / mismatch**, details below                                               |

Relative to #15: one added file, seven added passing tests, unchanged skips.
Relative to #9: +727 passing tests, unchanged two Windows-only no-sandbox skips
on this Linux host. The original pending fork's ten review-workflow failures
were already recorded in baseline.md and belong to excluded orchestration.
They are not failures in this integration suite.

Initial format checking found five unformatted files at the fixed upstream
base. Formatting-only repairs were retained for `CopyToWorktree.test.ts`,
`PodmanLifecycle.test.ts`, `check-public-types-effect-free.mjs` and ADR 0006.
The release workflow has one single-quoted registry URL. Reformatting it
conflicted with the deliberate exact-byte security fixture; that edit was
reverted, not accommodated by weakening the fixture, skipping its test,
ignoring the workflow or changing formatter configuration. Its remaining format
failure is inherited and unresolved. The intermediate safety-test failure was
fixed by reverting our workflow edit; the complete suite then passed.

Execution logs (host-local, not package contents):
`/tmp/ralph-ticket16-{build,typecheck,tests,package,format}.log`;
`/tmp/ralph-ticket16-pi-contracts.log`;
`/tmp/ralph-ticket16-format-baseline.json`;
`/tmp/ralph-ticket16-preservation.json`.
Initial test-draft type errors were fixed before the final successful checks.

## Original and backup preservation — unresolved gate

All source/documentation edits and commits made by this task were confined to
the integration worktree (and temporary fixtures/logs). The original directory was queried with explicit
read-only `git -C /home/mauricio-liu/Projects/ralph ...`; no checkout, reset,
clean, restoration, index repair or main merge was performed.

Original HEAD/main remain `07a0252`, and backup ref
`backup/pre-upstream-pi-20261027-223742` still resolves to snapshot `2812967`.
The saved `original-index` and `status-before.bin` match their manifest SHA-256
values; baseline, manifest and saved staged/unstaged patches remain present.
No backups were deleted or replaced.

However, during this execution additional original-repository changes appeared.
An earlier tracked snapshot comparison matched (apart from the three originally
untracked snapshot files). A later blob comparison reported mismatches in
`README.md`, `package.json`, `package-lock.json`, `src/cli.ts` and
`src/cli.test.ts`; the live index, status and unstaged patch also no longer match
the saved baseline. Additional untracked CLI work and `.pi/` entries were observed.
The staged patch remains equal to the saved empty patch. No original contents
or secrets were copied into this report. The cause/owner of that drift is not
established here, and it was not adopted or reverted. Git read commands may
refresh index stat-cache metadata, so a live-index byte mismatch alone would
not establish a staged-content change; the tracked working-copy blob mismatches
independently prevent a preservation pass.

**Do not accept an unchanged-original assertion from this run.** A human must
reconcile the original drift against the saved manifest/patches and establish an
authorized preservation baseline. This task cannot safely erase concurrent work
or silently exempt tracked changes. Main/ref preservation is not equivalent to
working-copy preservation. This gate remains blocked even though integration
checks pass.

## Review procedure and required manual validation

1. Pin the #16 audit commit using `git -C /home/mauricio-liu/Projects/ralph-rebuild
log --oneline rebuild/upstream-pi`; verify the branch and clean status. Review
   the full range `a53e227250fb51df0ad54155b85fecc1c090c937..<audit-commit>`, not
   only #16. Use `git diff --find-renames` so the config-directory move is clear.
2. Review the commit blocks and executable ledger above, plus new credential/CI
   modules and their tests. Read [#13's provider matrix](ticket-13.md), [#14's
   defaults receipt](ticket-14.md) and [#15's CI limits](ticket-15.md). Confirm
   excluded original files/ADRs/features remain absent; use explicit `git -C`
   paths and `git show <snapshot>:<path>` for original history, never checkout.
3. On the integration branch only, rerun build, then typecheck/tests, format check
   and package smoke. Package smoke requires cached dependencies/Zod populated by
   npm ci; unavailable cache is a blocked check, never a pass. Preserve the exact
   workflow fixture and report the inherited format failure honestly.
4. Independently resolve the preservation gate before declaring #16 complete.
   Do not reset or overwrite the original to manufacture a matching baseline.
5. Request separate authorization before real Pi login/refresh/inference, model
   catalog/subscription verification, Docker/Podman image build/execution,
   Vercel/Daytona connections, ownership/teardown checks or GitHub workflow runs.
   No real credentials, remote services or agent execution were needed here.

Further limits: isolated credential transfer does not implement isolated session
persistence or built-in Vercel/Daytona interactive transport; custom interactive
doubles do not establish those capabilities. Pi session-storage overrides stay
independent from credential directories, and Pi's upstream sessionFilePath is a
directory. POSIX transfer/launch commands are not native Windows certification.
Sandbox-only token refresh is discarded, so hosts/CI secrets need out-of-band
renewal. SIGKILL cannot execute CI wrapper cleanup. Timeout/abort API outcomes do
not establish abandoned process termination on warm/no-sandbox handles. The
legacy factory daemon, model availability and live inference remain unvalidated.
No future-ticket fixes were attempted for these limits.

No push, PR, GitHub mutation/closure, main merge, release or publication was
performed. Local audit commit only; the ticket remains blocked as stated above.
