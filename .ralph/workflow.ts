import * as ralph from "../src/index.js";
import { Cause, Data, Effect, Exit } from "effect";
import { z } from "zod";

const MAX_ITERATIONS = 10;
const MAX_PARALLEL = 4;

class DogfoodError extends Data.TaggedError("DogfoodError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

const step = <A>(phase: string, operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) =>
      new DogfoodError({ message: `Dogfood ${phase} failed.`, cause }),
  });

/** Execution resources for the repository-only workflow; not a distributed template API. */
export interface DogfoodOptions {
  /** Sandbox transport used by all roles, including planning and merging. */
  readonly sandbox: ralph.SandboxProvider;
  /** Host repository whose branches/worktrees the workflow manages. */
  readonly cwd: string;
}

/** Plan, implement/review at most four branches at once, and merge, for at most ten rounds. Importing this module launches nothing. */
export const runDogfood = ({
  sandbox: provider,
  cwd,
}: DogfoodOptions): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
        yield* Effect.sync(() =>
          console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} ===\n`),
        );
        const planning = yield* step("plan", () =>
          ralph.run({
            cwd,
            sandbox: provider,
            name: "Planner",
            agent: ralph.pi("openai-codex/gpt-6-astra:high"),
            promptFile: "./.ralph/plan-prompt.md",
            output: ralph.Output.object({
              tag: "plan",
              schema: z.object({
                issues: z.array(
                  z.object({
                    number: z.number().int().positive(),
                    title: z.string(),
                    branch: z.string(),
                  }),
                ),
              }),
              maxRetries: 2,
            }),
          }),
        );
        const selected = planning.output.issues;
        if (selected.length === 0) {
          yield* Effect.sync(() =>
            console.log("No issues to work on. Exiting."),
          );
          break;
        }
        yield* Effect.sync(() => {
          console.log(
            `Planning complete. ${selected.length} issue(s) to work in parallel:`,
          );
          for (const task of selected)
            console.log(`  #${task.number}: ${task.title} → ${task.branch}`);
        });

        // Settle every item, including disposal failures. A rejected branch must
        // neither short-circuit its siblings nor retain a concurrency slot.
        const results = yield* Effect.forEach(
          selected,
          (task) =>
            Effect.scoped(
              Effect.gen(function* () {
                const sandbox = yield* Effect.acquireRelease(
                  step("create sandbox", () =>
                    ralph.createSandbox({
                      cwd,
                      sandbox: provider,
                      branch: task.branch,
                      copyToWorktree: ["node_modules"],
                      hooks: {
                        sandbox: {
                          onSandboxReady: [
                            { command: "npm install && npm run build" },
                          ],
                        },
                      },
                    }),
                  ),
                  (handle) =>
                    step("close sandbox", () => handle.close()).pipe(
                      Effect.orDie,
                    ),
                );
                const result = yield* step("implement", () =>
                  sandbox.run({
                    name: "Implementer #" + task.number,
                    agent: ralph.pi("zai-coding-cn/glm-5.3:high"),
                    promptFile: "./.ralph/implement-prompt.md",
                    promptArgs: {
                      ISSUE_NUMBER: String(task.number),
                      ISSUE_TITLE: task.title,
                      BRANCH: task.branch,
                    },
                  }),
                );
                if (result.commits.length > 0)
                  yield* step("review", () =>
                    sandbox.run({
                      name: "Reviewer #" + task.number,
                      agent: ralph.pi("zai-coding-cn/glm-5.3:high"),
                      promptFile: "./.ralph/review-prompt.md",
                      promptArgs: {
                        ISSUE_NUMBER: String(task.number),
                        ISSUE_TITLE: task.title,
                        BRANCH: task.branch,
                      },
                    }),
                  );
                return result;
              }),
            ).pipe(Effect.exit),
          { concurrency: MAX_PARALLEL },
        );

        yield* Effect.sync(() => {
          for (const [index, outcome] of results.entries()) {
            if (Exit.isFailure(outcome))
              console.error(
                `  ✗ #${selected[index]!.number} (${selected[index]!.branch}) failed: ${Cause.pretty(outcome.cause)}`,
              );
          }
        });
        const completed = selected.filter((_, index) => {
          const outcome = results[index]!;
          return Exit.isSuccess(outcome) && outcome.value.commits.length > 0;
        });
        const branches = completed.map((task) => task.branch);
        yield* Effect.sync(() => {
          console.log(
            `\nExecution complete. ${branches.length} branch(es) with commits:`,
          );
          for (const branch of branches) console.log(`  ${branch}`);
        });
        if (branches.length === 0) {
          yield* Effect.sync(() =>
            console.log("No commits produced. Nothing to merge."),
          );
          continue;
        }
        yield* step("merge", () =>
          ralph.run({
            cwd,
            sandbox: provider,
            name: "Merger",
            maxIterations: 10,
            agent: ralph.pi("zai-coding-cn/glm-5.3:high"),
            promptFile: "./.ralph/merge-prompt.md",
            promptArgs: {
              BRANCHES: branches.map((branch) => `- ${branch}`).join("\n"),
              ISSUES: completed
                .map((task) => `- #${task.number}: ${task.title}`)
                .join("\n"),
            },
          }),
        );
        yield* Effect.sync(() => console.log("\nBranches merged."));
      }
      yield* Effect.sync(() => console.log("\nAll done."));
    }),
  );
