# Reconstruction ticket #11 — Pi terminal errors and completion

## Scope and provenance

- Worktree `/home/mauricio-liu/Projects/ralph-rebuild`, branch `rebuild/upstream-pi`.
- Blocker #10 is satisfied by its local receipt at `895e4aab69f94605a676218cce2b324ae94f6854`: build, typecheck, 1459 passing tests (2 existing skips), and package smoke passed.
- Selected only Pi stream/error/reset handling and replay tests from read-only fork snapshot `28129673b3f786a1a048385fbdaff268de45346e`. No whole files, mixed commits, or review-workflow recovery were imported.

## Behavior

Pi errors are normalized separately from results: assistant `error`/`aborted` stop reasons, `agent_error`/`error`, and `auto_retry_end` with `success: false` fail even with a zero CLI exit. Missing diagnostics retain a useful fallback error. An unresolved error fails on process exit or idle timeout; it cannot use the successful-completion grace path.

Assistant starts and automatic retry starts invalidate prior output and completion. Final assistant messages replace streamed output, including empty results. Completion is recomputed after each line rather than latched. An error can recover only after a restart and a successful assistant result, not from deltas or retry bookkeeping alone; a repeated pre-error `agent_end` snapshot cannot restore stale completion.

Pi opts into `AgentProvider.parsedOutputOnly`, so raw stdout cannot contribute user/tool/unknown JSON text to completion or structured output. Other providers keep upstream's raw-stdout fallback and result accumulation. Raw forwarding still happens before parsing, text/tool streaming remains intact, and reset/error handling does not clear session IDs or usage. Upstream session storage/handles, structured-output retries, security workflows and merge-to-head behavior are retained.

Pi capture and in-place `--session` resume remain supported. Pi session fork is **not** supported or claimed: the generic result may expose a fork handle, but Pi command construction rejects it before launching Pi instead of silently mutating the parent session. README and public type comments document this limitation; command-construction rejection is tested. No Pi native fork implementation or isolation guarantee was added.

## Validation

| Check                  | Result                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `npm run typecheck`    | PASS                                                                                        |
| `npm test`             | PASS: 56 files, 1499 passing tests, 2 existing skips                                        |
| `npm run build`        | PASS, including Effect-free public declarations                                             |
| `npm run test:package` | PASS: offline installation, CLI/imports, 10 compiled scaffolds; no agent/provider execution |
| `git diff --check`     | PASS                                                                                        |

Compared with #10: **40 additional passing tests, one additional test file, unchanged skips**. Existing tests were retained; six Pi parser expectations now require explicit errors rather than treating errors as results or dropping them. New tests use synthetic events and mocked Pi execution, covering success, terminal failures, exhausted retries, internal retry recovery, stale completion after errors/restarts/empty results, hanging-process timer revocation, raw/text/tool forwarding, nonzero exit and cancellation. Existing upstream tests continue to cover token usage, session capture/resume/handles, structured-output retries, workflow security and merge-to-head.

Logs: `/tmp/ralph-11-test.log`, `/tmp/ralph-11-build.log`, `/tmp/ralph-11-package.log`. Typecheck and focused replay results were also checked during implementation.

Read-only preservation verification: original HEAD and main remain `07a0252565c19e2156c40d7eabc21c65af09efaa`; the original index SHA-256 matches the saved manifest; all **270 snapshot file contents**, including the previously untracked fixtures, match their snapshot blob hashes. The pre-existing untracked `.pi/` ledger was not edited or removed by this implementation. Backups remain intact.

## Validation boundary

All ticket replay acceptance checks ran locally without an agent or credential file. Real-provider/OAuth, container/cloud execution and live session transfer were **not run**, as explicitly prohibited. Live-provider compatibility would require separate authorized manual/integration validation; these synthetic checks do not claim to prove it. Pi fork remains an explicit unsupported limitation, not a deferred passing test. No tests were newly skipped or weakened to stand in for manual validation.

No additional agent process, generic Ralph runner, Docker/Podman/cloud service, GitHub mutation, push, PR, merge or release was started. No MiniMax, authorization allowlist, reviewed recovery, coordinator lock, durable issue state/reconciliation, Pi defaults, credential provisioning, or other ticket work was implemented.
