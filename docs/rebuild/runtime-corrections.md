# Authorized runtime correction receipt

## Scope and disposition

Integration checkout only: `/home/mauricio-liu/Projects/ralph-rebuild`, branch
`rebuild/upstream-pi`, starting at `70019817f4a79a74e94871c38ad4419afe5d542b`.
Read the complete external runtime correction order, baseline, review order and
three required review reports before editing. One integration-code writer; no
subagents, coordinators, GitHub operations, push, release or merge.

The initial diagnosis under
`/home/mauricio-liu/.local/state/ralph/rebuild-20261027-223742/review-initial/`
was read, not edited. No original-checkout source, index, configuration or working
files were modified. The original checkout's externally introduced CLI/package
drift is still an **unresolved OWNER DECISION gate**, not a new baseline or a
preservation PASS. The guard and full loop remain stopped. No restoration or
waiver is implied by these integration corrections.

## Four authorized findings

| Finding                                    | Correction                                                                                                                                                                                                                                                                                | Commit                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| P1 Daytona creation (SPEC-1 / BUG-B1)      | Create/verify `ralph-workspace` through the SDK from the existing base before returning the handle. Delete the sandbox on initialization failure; redact SDK output and report deletion failure.                                                                                          | `ac83971daa9e05e435e1ca64ea9163450cb84188` |
| P1 credential containment (SEC-1 / SPEC-2) | Validate destination ancestors and physical worktree before directory writes/chmod; reject symlink ancestors, physical descendants and unverifiable paths. Recheck at the one-way copy boundary.                                                                                          | `49458204ab822bc1e465d1b0d7b7c0ae7834f409` |
| P2 Effect boundary (STD-1)                 | Promise entry points immediately delegate to typed Effect programs. Inject FileSystem and one-way transport primitives, settle transfers before cancellation checks, and perform cleanup within the uninterruptible program. Tagged errors remain redacted; Effect types remain internal. | `35ef5e8d018b947a42f414869551afcffe529474` |
| P2 Windows directory overrides (SPEC-3)    | Pi builders return executable/argv without POSIX env. Execution boundaries apply per-launch overrides as native host process environment or POSIX env for Linux sandboxes, selected by target family rather than host OS. Cover cold and warm handles.                                    | `e6b5f69237ea06e6c4f65a15455f545646144fde` |

Credential/session separation, one-way transfer, authoritative host reuse,
optional catalog removal, ownership repair, restrictive modes and cleanup failures
remain covered. No claim of protection against an adversary concurrently changing
the sandbox filesystem is added. Physical validation requires GNU-compatible
`realpath -e/-m`; missing/inaccessible verification fails closed.

All six execution APIs and worktree-derived sandbox handles retain their tested
credential behavior. Pi resume, unsupported fork rejection, structured-output
retries, stream/raw events, timeouts and merge-to-head remain covered. Existing
agent providers without launch overrides retain their launch behavior. Custom
no-sandbox handles must honor per-process `env`; credential handles expose the
required `validateDirectory` capability. README documents these boundaries.

Corrections are included in the existing **patch** changeset
`.changeset/rebuild-validation.md`, without duplicating the feature changeset.

## RED → GREEN evidence

Logs below are local `/tmp/ralph-correction-*.log` files, outside the immutable
review artifacts. Tests use synthetic files, local shell/git and inert external
process/SDK boundaries, not internal collaborator replacements.

- Daytona RED: `npx vitest run src/IsolatedCredentialAdapters.test.ts` — six
  failures when the SDK double enforced cwd existence, including actual `syncIn`
  failing on the fresh child. `/tmp/ralph-correction-daytona-red.log`.
  GREEN after creation/cleanup correction: 16 tests, including SDK failure and
  deletion-failure redaction. `/tmp/ralph-correction-daytona-green.log` records
  the first 12-test green; the subsequent expanded suite also passed.
- Path RED: `npx vitest run src/PiCredentials.test.ts` — four failures: ancestor
  symlinks and physical-worktree aliases accepted by both adapter families.
  `/tmp/ralph-correction-path-red.log`. GREEN: PiCredentials,
  CredentialProvision, IsolatedCredentialAdapters and CredentialEntrypoints
  suites, 98 tests at that stage. `/tmp/ralph-correction-path-green.log`.
  Paths containing spaces/quotes, missing destination directories and an
  unverifiable worktree are exercised with real shell decisions before copying.
- Effect RED: `npx vitest run src/PiCredentials.test.ts -t 'injected filesystem'`
  exposed the absent injectable typed program, rather than an existing runtime
  symptom. `/tmp/ralph-correction-effect-red.log`. A separate deterministic
  `-t 'filesystem failure'` test then caught cancellation losing to a settled
  filesystem failure during refactoring; corrected before completion.
  `/tmp/ralph-correction-effect-cancel-red.log`. GREEN: injectable filesystem
  failures/cancellation, partial installation cleanup/reuse, in-flight copy abort
  settling, permissions and redaction. `/tmp/ralph-correction-effect-green.log`.
- Windows RED: `npx vitest run src/LaunchEnvironment.test.ts` — two runtime
  failures: POSIX prefix in Pi command and stale Windows spawn environment.
  `/tmp/ralph-correction-windows-red.log`. GREEN: process-boundary tests now
  exercise Windows print/interactive cold/warm launches with metacharacter-rich
  directory values, plus both Linux sandbox families on a simulated Windows
  host. `/tmp/ralph-correction-windows-green.log` also records the five-suite
  entry/provider matrix run: 543 passed, two platform skips. Later focused tests
  include the expanded four-case launch suite.

The first full test run exposed three PiCompatibility assertions tied to nested
shell quote spelling. Replaced those checks with an inert executable argv probe,
retaining actual session-ID/resume/retry assertions. No acceptance criterion was
removed. The original failed log is
`/tmp/ralph-correction-initial-full-test.log`; the subsequent focused 11-test run
is `/tmp/ralph-correction-compatibility-green.log`.

## Final checks

Executed after all runtime/test corrections at `e6b5f69`:

| Command                | Result                                                                        | Log                                         |
| ---------------------- | ----------------------------------------------------------------------------- | ------------------------------------------- |
| `npm run typecheck`    | PASS, including dogfood typing                                                | `/tmp/ralph-correction-final-typecheck.log` |
| `npm test`             | PASS: 67 files; 2,198 passed, two inherited platform skips                    | `/tmp/ralph-correction-final-test.log`      |
| `npm run build`        | PASS, including public declarations free of Effect references                 | `/tmp/ralph-correction-final-build.log`     |
| `npm run test:package` | PASS: offline tarball, CLI/imports/credential types and 70 compiled scaffolds | `/tmp/ralph-correction-final-package.log`   |
| `npm run format:check` | Known inherited failure only: `.github/workflows/release.yml`                 | `/tmp/ralph-correction-final-format.log`    |
| `git diff --check`     | PASS                                                                          | Terminal check                              |

Receipt/changeset formatting was checked separately before the documentation
commit. No frozen security fixture or workflow was modified to silence the known
format limitation. No changes to excluded cli.init/packageIdentity/dogfood
orchestration test-standard findings, or excluded fork features.

## Remaining limits / handoff

- Owner must resolve original-checkout drift; guard/full loop remain stopped.
- Initial review findings outside these four corrections remain out of scope;
  this receipt is not a new independent review approval.
- Native Windows, live OAuth/inference, real containers/cloud/provider execution,
  and credential refresh behavior remain unvalidated. All auth material used in
  tests was synthetic; no real auth files or host global config were inspected
  or altered.
- No publication or main integration is authorized. Stop after this receipt and
  wait for the lead.
