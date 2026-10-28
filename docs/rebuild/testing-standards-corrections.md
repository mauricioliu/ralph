# Testing-standards correction receipt

## Authorization and preserved boundaries

Starting HEAD: `08591efbee2b5a7704504feec0b9c2b135eb971a` on
`rebuild/upstream-pi` in `/home/mauricio-liu/Projects/ralph-rebuild`.
The lead explicitly transferred sole write ownership after the runtime turn.
Read the complete test correction order, project standards, initial review reports,
coverage/snapshot artifacts and scoped patch evidence before implementing.

Only the three authorized testing findings are corrected. No subagents,
coordinators, GitHub actions, publication, main merge or original-checkout access.
The original checkout's external CLI/package drift remains an **unresolved OWNER
DECISION gate**, not an adopted baseline, exemption or preservation PASS. The guard
and full loop remain stopped.

All runtime corrections remain ancestors and their library/provider source files
are unchanged by this turn. No credential, execution-boundary or Daytona logic
was rewritten. Workflow security files and the frozen fixture are unchanged.
All initial review artifact SHA-256 checks pass against the pre-edit manifest:
`/tmp/ralph-testing-review-before.sha256` and
`/tmp/ralph-testing-review-verification.log`. Initial diagnosis was not edited.

## Findings and commits

| Finding | Behavior-based replacement                                                                                                                                                                                                                                                                                                                                                                                                        | Commit                                     |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| STD-2   | Real DockerLifecycle/PodmanLifecycle modules through public init. Intercept only prompts and external child-process APIs; guard every process entry point. Retain all agent/model/override/auth scaffold assertions and cancellation checks. Add approved/declined build and build-failure behavior for both providers. No image or external process actually launches.                                                           | `b5ede15a0747b583bbed2af27f06c54dae5b3773` |
| STD-B1  | Vitest public `createVitest` / `globTestSpecifications` discovery, followed by close. Compare actual `.ralph` discoveries to the filesystem, including explore/batch. A temporary namespace fixture proves `.ralph` inclusion and `.sandcastle` exclusion, unchanged after a suite-title rename. Throwing sentinel test modules are never imported or executed.                                                                   | `b36dccc39bf10e76a36042af595edd98d137c9af` |
| SA-01   | Import-safe repository-only workflow callable through actual source public APIs and a required sandbox/repository boundary. Real temporary git worktrees, credential/session transfer and Output validation; only external agent/CLI/install/build transport is inert. Test plan consumption/repair, issue/branch/prompt mapping, bounded lifetimes, all-settled failure/disposal semantics, review eligibility and merger input. | `dda8e493d9b77d5fe1e6abc43a7bd1468bbece12` |

The dogfood commit also supplies the explicit `void` return annotation on the init
process double, required to type its inert callback implementations. No production
lifecycle implementation was changed.

`.ralph/run.ts` remains the real executable wrapper, not a validation command.
`.ralph/workflow.ts` imports the current source public API and launches nothing
until invoked with resources. The extracted Effect program retains ten outer
rounds, four branch lifetimes in parallel, two plan repairs and ten merger
iterations. A scoped sandbox closes before its item settles, including rejection;
only successful reviewed branches with commits enter the merger. A failure in one
branch does not discard or cancel its siblings.

The former workflow source predicates and run-prompt configuration case are
replaced by six observable workflow scenarios; their acceptance criteria are not
removed. Static deployable model/image/security and legacy integration
configuration checks remain. Distributed templates, package scripts, tsconfigs and
public package exports are unchanged; this repository-only refactor/test work
changes no public behavior and needs no new release changeset (ADR 0009 retained).

## RED / GREEN and refactor sensitivity

- STD-2 RED: `npx vitest run src/cli.init.test.ts -t 'approved'` failed twice on
  the old internal `buildImage` replacement, before replacing it with an external
  process boundary. `/tmp/ralph-testing-init-red.log`.
  GREEN: `npx vitest run src/cli.init.test.ts`, 18 tests.
  `/tmp/ralph-testing-init-green.log`. Decline/cancel paths assert no process
  attempts; approved builds use inert success callbacks; failure callbacks reach
  real lifecycle error handling.
- STD-B1 GREEN: `npx vitest run src/packageIdentity.test.ts`, six tests.
  `/tmp/ralph-testing-discovery-green.log`. Discovery runs in a separate Node
  process using the public API, never a recursively executed test suite or
  workflow runner. The synthetic `.ralph` file is discovered both with a throwing
  top-level body and with a renamed describe title; a real legacy namespace file
  remains excluded. This is an explicit harmless-refactor sensitivity check,
  not a claim of a pre-existing discovery runtime defect.
- SA-01 seam RED: `npx vitest run .ralph/workflow.test.ts` initially exposed the
  absent callable boundary. `/tmp/ralph-testing-workflow-red.log`.
  Stronger behavioral sensitivity was then demonstrated through four independent
  temporary mutations of the new workflow source, each restored immediately:
  - `MAX_PARALLEL=5`: `-t 'bounds branch'` observed five instead of four active
    workers. `/tmp/ralph-testing-workflow-concurrency-red.log`.
  - Append `-wrong` to selected branches: `-t 'consumes the validated final plan'`
    rejected actual branch/prompt associations.
    `/tmp/ralph-testing-workflow-branch-red.log`.
  - Parse the first raw plan tag rather than consume validated Output: the same
    test caught the trap issue rather than the final plan.
    `/tmp/ralph-testing-workflow-structured-plan-red.log`.
  - Set plan repairs to zero: `-t 'rejects invalid structured plans'` observed one
    actual session attempt instead of three.
    `/tmp/ralph-testing-workflow-repair-bound-red.log`.
- Harmless extraction/local renaming and replacing the queue/Promise.allSettled
  syntax with scoped Effect concurrency pass all six workflow tests. The three
  legacy orchestration source predicates are absent; no new source-name oracle
  replaces them. Ten-round no-commit and non-completing-merger scenarios verify
  both execution limits, not merely their configured numbers.
- Final focused command:
  `npx vitest run src/cli.init.test.ts src/packageIdentity.test.ts .ralph/dogfood.test.ts .ralph/workflow.test.ts`
  — **61 passed**. `/tmp/ralph-testing-focused-green.log`.

No mutation, skipped replacement or disabled criterion remains. Every mocked
operation is an external prompt/process/provider transport boundary, not an own
internal module/class. Session/auth files and all git changes in workflow tests
are synthetic and confined to temporary fixtures. GitHub commands and install/build
hooks are intercepted; neither runs against a real service.

## Final checks

Executed after all source/test changes at `dda8e49`:

| Command                | Result                                                            | Log                                      |
| ---------------------- | ----------------------------------------------------------------- | ---------------------------------------- |
| `npm run typecheck`    | PASS, including dogfood                                           | `/tmp/ralph-testing-final-typecheck.log` |
| `npm test`             | PASS: 68 files; 2,209 passed, two inherited platform skips        | `/tmp/ralph-testing-final-test.log`      |
| `npm run build`        | PASS, including Effect-free public declarations                   | `/tmp/ralph-testing-final-build.log`     |
| `npm run test:package` | PASS: offline tarball/CLI/imports/types and 70 compiled scaffolds | `/tmp/ralph-testing-final-package.log`   |
| `npm run format:check` | Known inherited failure only: `.github/workflows/release.yml`     | `/tmp/ralph-testing-final-format.log`    |
| `git diff --check`     | PASS                                                              | Terminal check                           |

The receipt was formatted separately before its documentation commit. No frozen
security fixture was relaxed to silence formatting. Real agents, OAuth, providers,
cloud sandboxes, containers, real image builds and real-auth tests were not run;
the automated results do not validate them. The original owner gate and inherited
format limitation remain outstanding. Stop here and wait for the lead; no full
loop restart or publication is authorized.
