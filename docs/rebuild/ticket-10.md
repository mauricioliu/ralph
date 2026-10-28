# Reconstruction ticket #10 — Ralph identity

## Base and boundaries

- Integration worktree: `/home/mauricio-liu/Projects/ralph-rebuild`, branch `rebuild/upstream-pi`.
- Blocker #9 receipt: upstream `a53e227250fb51df0ad54155b85fecc1c090c937`, build/typecheck passing, 54 test files, 1453 passing tests and 2 skipped tests.
- Read-only fork reference: snapshot `28129673b3f786a1a048385fbdaff268de45346e` in `/home/mauricio-liu/Projects/ralph`. Only identity was selected from the fork; no old files or mixed commits were copied.
- Backup/baseline remains at `/home/mauricio-liu/.local/state/ralph/rebuild-20261027-223742/`.

## Changes

The first implementation commit is the mechanical identity change (including ordinary pre-commit formatting): package/imports `@mauricioliu/ralph`, executable `ralph`, configuration `.ralph`, internal artifact prefixes, scaffold scripts/examples, own workflows, and test discovery. The upstream configuration-owned `explore/batch.test.ts` and its six tests moved with the directory. No upstream tests were removed or newly skipped.

The inherited package version stays **0.12.0**. The stale upstream lockfile root version was **0.6.5**; both root metadata entries now agree with `package.json`. This does not revert to the old fork's 0.8.0 or decide a future release. Changesets record the namespace feature and the packaging fix; no versioning/publishing command was run.

`LICENSE` (Matt Pocock's MIT copyright), `CHANGELOG.md`, historical ADRs, research, archived plans/sample transcripts and `.mailmap` remain upstream history. README explicitly attributes Sandcastle and identifies the fixed base. Current usage examples use Ralph. No removed documentation-site files were restored.

The namespace changes in PR workflows are limited to execution paths and bot names. In particular:

- `agent-review` and `agent-implement-pr` retain `pull_request`, not `pull_request_target`, with checkout pinned to the PR head SHA.
- Conflict-update workflow retains `pull_request_target` **and** its same-repository job guard, plus the exact-head checkout.
- Event policies, permissions and existing safety checks were not replaced with the old fork's authorization allowlist.

No MiniMax, Pi-default/credential behavior changes, recovery orchestration, coordinator lock, durable issue state/reconciliation, or later-ticket work was introduced. Upstream session handles/capture/resume, structured-output retries, streaming/raw output and merge-to-head implementations remain, apart from mechanical identity strings.

## Distribution check and discovered baseline gap

`npm run test:package` runs `scripts/smoke-package.mjs` after build. It:

1. Packs locally with lifecycle scripts disabled and verifies every public JS/type export, CLI entry point, license and README in the archive.
2. Installs the tarball and cached dependencies offline into a disposable consumer with an empty temporary HOME/npm configuration. Optional sandbox peers are not auto-installed.
3. Checks the installed `ralph` bin/version/help, the complete upstream root runtime export set and all five sandbox subpath imports, without invoking any provider.
4. Generates all five templates in both ESM (`main.ts`) and non-ESM (`main.mts`) projects. Both Docker and Podman scaffolds are represented. Pi/model selection is explicit and synthetic; label creation, image builds and template-dependency installation are disabled.
5. Compiles all ten generated entry points against the installed public declarations with `strict: true`, `noEmit: true`, and `skipLibCheck: false`. It never imports or executes the scaffold entry points and deletes only its own temporary fixture.

This new isolated check initially failed: upstream `src/Output.ts` and generated `dist/index.d.ts` import `@standard-schema/spec`, but upstream only obtained it transitively through the development dependency Effect. Installed consumers lacked the module (`TS2307`), and planner output inference degraded to `any`. The in-repository baseline suite could not detect this because Effect was installed there.

The minimal packaging correction declares `@standard-schema/spec` as a production dependency at the already locked **1.1.0** version (range `^1.1.0`), and removes its lockfile dev-only marker. No API/type implementation changed; the same strict check then passed. A separate patch changeset records this fix.

## Validation and delta from #9

| Check                                                            | Result                                                                              |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `npm run build` (including Effect-free public declaration check) | PASS                                                                                |
| `npm run typecheck`                                              | PASS                                                                                |
| `npm test`                                                       | PASS: 55 files, 1459 tests passed, 2 pre-existing skips                             |
| `npm run test:package`                                           | PASS: offline installation, CLI, all public imports, 10 strictly compiled scaffolds |
| `git diff --check`                                               | PASS                                                                                |

Compared with #9: **+1 test file, +6 passing tests, unchanged 2 skips**, plus the separate package/scaffold smoke check. The six added tests protect identity/version/lock metadata, configuration test discovery, attribution and the three PR workflow security contracts. The original fork's ten known review-workflow failures are excluded orchestration behavior, not imported or repaired here.

Execution logs: `/tmp/ralph-ticket10-build.log`, `/tmp/ralph-ticket10-typecheck.log`, `/tmp/ralph-ticket10-tests.log`, `/tmp/ralph-ticket10-package.log`. `/tmp/ralph-ticket10-package-red.log` records the missing-schema dependency reproduction.

Read-only preservation checks found the original HEAD/main still at `07a0252565c19e2156c40d7eabc21c65af09efaa`, its saved index checksum unchanged, and all snapshot file bytes (including the three previously untracked files) unchanged. An additional untracked `.pi/goals` runtime ledger appeared in the original directory during execution; it is outside the saved snapshot, was not edited or removed by this implementation, and prevents claiming identical raw `git status` bytes. Backups were not removed.

## Deliberately not run / pending

No additional coding-agent process, generic Ralph runner, Docker/Podman/cloud service, real provider/OAuth flow, GitHub mutation, push, PR, merge or release was run. Real provider/container/OAuth integration is outside #10 and remains unvalidated; it is not substituted for these local distribution checks. Publication and release numbering remain pending human decisions.
