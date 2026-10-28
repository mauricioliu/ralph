import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBindMountSandboxProvider,
  type ExecResult,
} from "../src/index.js";
import { encodePiSessionDir } from "../src/SessionStore.js";
import { runDogfood } from "./workflow.js";

const exec = promisify(execFile);
type Issue = { number: number; title: string; branch: string };
const issue = (number: number): Issue => ({
  number,
  title: `Fixture ${number}`,
  branch: `ralph/issue-${number}`,
});
const plan = (issues: Issue[]) => `<plan>${JSON.stringify({ issues })}</plan>`;

describe("dogfood workflow through real public APIs and an inert sandbox transport", () => {
  let root: string;
  let repo: string;
  let home: string;
  let plans: string[];
  let planCalls: number;
  let workers: { prompt: string; branch: string; role: string }[];
  let merges: string[];
  let activeAtMerge: number[];
  let outcomes: Map<number, "commit" | "empty" | "reject" | "review-reject">;
  let closeFailures: Set<string>;
  let active: number;
  let peak: number;
  let opened: string[];
  let closed: string[];
  let release: () => void;
  let hold: Promise<void>;
  let mergerCompletes: boolean;
  const git = async (cwd: string, ...args: string[]) =>
    (await exec("git", args, { cwd })).stdout.trim();

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ralph-dogfood-behavior-"));
    repo = join(root, "repo");
    home = join(root, "sandbox-home");
    const host = join(root, "host-agent");
    for (const path of [repo, home, host, join(repo, "node_modules")])
      await mkdir(path, { recursive: true });
    await writeFile(
      join(host, "auth.json"),
      '{"fixture":{"access":"synthetic-dogfood-only"}}',
    );
    vi.stubEnv("HOME", join(root, "host-home"));
    vi.stubEnv("PI_CODING_AGENT_DIR", host);
    vi.stubEnv("GIT_CONFIG_GLOBAL", join(root, "gitconfig"));
    await writeFile(join(root, "gitconfig"), "");
    await git(repo, "init", "-b", "main");
    await git(repo, "config", "user.name", "Fixture");
    await git(repo, "config", "user.email", "fixture@example.invalid");
    await writeFile(join(repo, ".gitignore"), ".ralph/\nnode_modules/\n");
    await git(repo, "add", ".");
    await git(repo, "commit", "-m", "fixture");
    plans = [plan([])];
    planCalls = active = peak = 0;
    workers = [];
    merges = [];
    activeAtMerge = [];
    opened = [];
    closed = [];
    outcomes = new Map();
    closeFailures = new Set();
    hold = Promise.resolve();
    release = () => {};
    mergerCompletes = true;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => {
    release();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  const provider = () =>
    createBindMountSandboxProvider({
      name: "inert-dogfood-transport",
      create: async ({ worktreePath }) => {
        const isWorker =
          worktreePath.replace(/\\/g, "/") !== repo.replace(/\\/g, "/");
        const branch = await git(
          worktreePath,
          "rev-parse",
          "--abbrev-ref",
          "HEAD",
        );
        if (isWorker) {
          opened.push(branch);
          active++;
          peak = Math.max(peak, active);
        }
        const physical = (path: string) => path.replaceAll("/home/agent", home);
        const copy = async (source: string, target: string) => {
          await mkdir(dirname(target), { recursive: true });
          await copyFile(source, target);
        };
        return {
          worktreePath,
          copyFileIn: async (source, target) => copy(source, physical(target)),
          copyFileOut: async (source, target) => copy(physical(source), target),
          close: async () => {
            if (isWorker) {
              closed.push(branch);
              active--;
              if (closeFailures.has(branch))
                throw new Error("synthetic disposal rejection");
            }
          },
          exec: async (command, options): Promise<ExecResult> => {
            if (command.includes("pi -p ")) {
              const prompt = options?.stdin ?? "";
              let text: string;
              if (command.includes("gpt-6-astra")) {
                text = plans[Math.min(planCalls++, plans.length - 1)]!;
                // External session storage for the real capture/resume/retry path.
                const session = join(
                  home,
                  ".pi",
                  "agent",
                  "sessions",
                  encodePiSessionDir(worktreePath),
                  "fixture_planner-session.jsonl",
                );
                await mkdir(dirname(session), { recursive: true });
                await writeFile(
                  session,
                  JSON.stringify({
                    type: "session",
                    id: "planner-session",
                    cwd: worktreePath,
                  }) + "\n",
                );
                options?.onLine?.(
                  JSON.stringify({ type: "session", id: "planner-session" }),
                );
              } else if (prompt.includes("# CLOSE ISSUES")) {
                merges.push(prompt);
                activeAtMerge.push(active);
                text = mergerCompletes
                  ? "<promise>COMPLETE</promise>"
                  : "merge attempt";
              } else {
                const role = prompt.includes("Review the code changes")
                  ? "review"
                  : "implement";
                workers.push({ prompt, branch, role });
                const number = Number(/issue #(\d+)/.exec(prompt)?.[1]);
                if (role === "implement") {
                  await hold;
                  const outcome = outcomes.get(number) ?? "empty";
                  if (outcome === "reject")
                    throw new Error("synthetic worker rejection");
                  if (outcome === "commit" || outcome === "review-reject") {
                    await writeFile(
                      join(worktreePath, `issue-${number}.txt`),
                      "fixture change",
                    );
                    await git(worktreePath, "add", ".");
                    await git(
                      worktreePath,
                      "commit",
                      "-m",
                      `fixture ${number}`,
                    );
                  }
                }
                if (
                  role === "review" &&
                  outcomes.get(number) === "review-reject"
                )
                  throw new Error("synthetic review rejection");
                text = "<promise>COMPLETE</promise>";
              }
              const line = JSON.stringify({
                type: "message_end",
                message: {
                  role: "assistant",
                  stopReason: "stop",
                  content: [{ type: "text", text }],
                },
              });
              options?.onLine?.(line);
              return { stdout: line, stderr: "", exitCode: 0 };
            }
            // External commands that must never reach a real service or package manager.
            if (command.startsWith("gh issue "))
              return { stdout: "[]", stderr: "", exitCode: 0 };
            if (command === "npm install && npm run build")
              return { stdout: "inert build", stderr: "", exitCode: 0 };
            // Only library-generated local git/session/credential shell operations.
            if (
              !/^(?:git |if \[ |set -e\n|test |umask |rm -[fr]|mkdir |find |printf |chown )/.test(
                command,
              )
            )
              throw new Error(`Forbidden external command: ${command}`);
            return exec("sh", ["-c", physical(command)], {
              cwd: options?.cwd ?? worktreePath,
              env: { ...process.env, HOME: home, PI_CODING_AGENT_DIR: "" },
            }).then(
              (result) => ({ ...result, exitCode: 0 }),
              (error: { stdout: string; stderr: string; code: number }) => ({
                stdout: error.stdout,
                stderr: error.stderr,
                exitCode: error.code,
              }),
            );
          },
        };
      },
    });
  const run = () => runDogfood({ sandbox: provider(), cwd: repo });

  it("an empty structured plan exits without starting workers or a merger", async () => {
    await run();
    expect(planCalls).toBe(1);
    expect(opened).toEqual([]);
    expect(workers).toEqual([]);
    expect(merges).toEqual([]);
  });

  it("consumes the validated final plan, preserves issue/branch/prompt associations and settles failed siblings before merging only successful reviewed commits", async () => {
    const selected = [11, 12, 13, 14, 15].map(issue);
    selected[0]!.branch = "fixture/custom-planner-branch";
    plans = [plan([issue(999)]) + "\n" + plan(selected), plan([])];
    outcomes = new Map([
      [11, "commit"],
      [12, "empty"],
      [13, "reject"],
      [14, "review-reject"],
      [15, "commit"],
    ]);
    closeFailures.add(issue(15).branch);
    await run();
    expect(planCalls).toBe(2);
    expect(opened.slice().sort()).toEqual(
      selected.map((task) => task.branch).sort(),
    );
    for (const task of selected) {
      const implementation = workers.find(
        (call) => call.role === "implement" && call.branch === task.branch,
      )!;
      expect(implementation.prompt).toContain(
        `Fix issue #${task.number}: ${task.title}`,
      );
      expect(implementation.prompt).toContain(`Work on branch ${task.branch}.`);
      expect(implementation.prompt).not.toMatch(/\{\{[A-Z_]+\}\}/);
    }
    expect(
      workers
        .filter((call) => call.role === "review")
        .map((call) => call.branch)
        .sort(),
    ).toEqual([selected[0]!.branch, issue(14).branch, issue(15).branch].sort());
    const review = workers.find(
      (call) => call.role === "review" && call.branch === selected[0]!.branch,
    )!;
    expect(review.prompt).toContain(
      `branch ${selected[0]!.branch} for issue #11: Fixture 11`,
    );
    expect(review.prompt).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(merges).toHaveLength(1);
    expect(activeAtMerge).toEqual([0]);
    expect(merges[0]).toContain(`- ${selected[0]!.branch}`);
    expect(merges[0]).toContain("- #11: Fixture 11");
    for (const excluded of [12, 13, 14, 15, 999]) {
      expect(merges[0]).not.toContain(`- ${issue(excluded).branch}`);
      expect(merges[0]).not.toContain(`- #${excluded}:`);
    }
    expect(merges[0]).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(closed.slice().sort()).toEqual(opened.slice().sort());
    expect(active).toBe(0);
    expect(String(vi.mocked(console.error).mock.calls)).toContain("#13");
    expect(String(vi.mocked(console.error).mock.calls)).toContain("#14");
    expect(String(vi.mocked(console.error).mock.calls)).toContain("#15");
  });

  it("bounds branch resource lifetimes to four in parallel and drains the queue", async () => {
    plans = [plan([21, 22, 23, 24, 25, 26].map(issue)), plan([])];
    hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const execution = run();
    try {
      await vi.waitFor(
        () =>
          expect(
            workers.filter((call) => call.role === "implement"),
          ).toHaveLength(4),
        { timeout: 5_000 },
      );
      expect(active).toBe(4);
    } finally {
      release();
      await execution;
    }
    expect(peak).toBe(4);
    expect(workers).toHaveLength(6);
    expect(closed.slice().sort()).toEqual(opened.slice().sort());
    expect(active).toBe(0);
  }, 15_000);

  it("caps nonempty no-commit planning rounds at ten and skips review/merge", async () => {
    plans = [plan([issue(41)])];
    await run();
    expect(planCalls).toBe(10);
    expect(workers).toHaveLength(10);
    expect(workers.every((call) => call.role === "implement")).toBe(true);
    expect(merges).toEqual([]);
    expect(closed).toHaveLength(10);
    expect(active).toBe(0);
  }, 15_000);

  it("rejects invalid structured plans after two actual session repairs, before workers", async () => {
    plans = [
      '<plan>{"issues":[{"number":-1,"title":"invalid","branch":"must-not-launch"}]}</plan>',
    ];
    await expect(run()).rejects.toThrow("Dogfood plan failed");
    expect(planCalls).toBe(3);
    expect(opened).toEqual([]);
    expect(workers).toEqual([]);
    expect(merges).toEqual([]);
  });

  it("caps a non-completing merger at ten attempts", async () => {
    plans = [plan([issue(51)]), plan([])];
    outcomes.set(51, "commit");
    mergerCompletes = false;
    await run();
    expect(merges).toHaveLength(10);
    expect(
      merges.every(
        (prompt) =>
          prompt.includes("- ralph/issue-51") &&
          prompt.includes("- #51: Fixture 51"),
      ),
    ).toBe(true);
    expect(planCalls).toBe(2);
    expect(active).toBe(0);
  }, 15_000);
});
