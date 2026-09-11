import { readFileSync } from "node:fs";
import { compileFunction } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { describe, expect, it } from "vitest";

// Execute the distributed template itself, substituting only external I/O.
// No models, subprocesses, containers, GitHub writes or real repos.
const source = readFileSync(
  process.env.RALPH_WORKFLOW_TEST_SOURCE ??
    new URL(
      "./templates/parallel-planner-with-review/main.mts",
      import.meta.url,
    ),
  "utf8",
);
const js = ts.transpileModule(source.replace(/^import[^;]*;\n/gm, ""), {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const execute = compileFunction(`return (async () => { ${js} })();`, [
  "ralph",
  "docker",
  "z",
  "execFileSync",
  "mkdirSync",
  "readFileSync",
  "renameSync",
  "writeFileSync",
  "unlinkSync",
  "process",
  "console",
]);
const COMPLETE = "<promise>COMPLETE</promise>";
const APPROVED = "<promise>REVIEW_APPROVED</promise>";
const issue = { id: "56", branch: "ralph/issue-56", title: "Issue" };
const missing = () =>
  Object.assign(new Error("not found"), { code: "ENOENT", status: 128 });

function harness(
  options: {
    existing?: string;
    implementation?: string;
    review?: string;
    quota?: boolean;
    merge?: boolean;
    authorized?: string | null;
    reconcile?: boolean;
    branches?: Record<string, string>;
    integratedShas?: string[];
    state?: Record<string, unknown>;
    issues?: (typeof issue)[];
    noCommits?: boolean;
    lock?: { pid: number; alive?: boolean; raw?: string };
  } = {},
) {
  const calls: string[] = [];
  const logs: string[] = [];
  const files = new Map<string, string>();
  const alive = new Set<number>();
  const ownPid = 4242;
  alive.add(ownPid);
  let lockSeen: boolean | undefined;
  const branches = new Map<string, string>();
  const ancestors = new Set(["base"]);
  if (options.existing) branches.set(issue.branch, options.existing);
  for (const [branch, sha] of Object.entries(options.branches ?? {}))
    branches.set(branch, sha);
  for (const sha of options.integratedShas ?? []) ancestors.add(sha);
  if (options.state)
    files.set(
      ".ralph/workflow-state.json",
      JSON.stringify({ version: 1, issues: options.state }, null, 2) + "\n",
    );
  if (options.lock) {
    if (options.lock.alive) alive.add(options.lock.pid);
    files.set(
      ".ralph/workflow-lock.json",
      options.lock.raw ??
        JSON.stringify(
          {
            pid: options.lock.pid,
            target: "main",
            startedAt: "2026-09-10T00:00:00.000Z",
            heartbeatAt: "2026-09-10T00:00:00.000Z",
          },
          null,
          2,
        ) + "\n",
    );
  }
  let head = "base";
  const git = (_command: string, args: string[]) => {
    if (args[0] === "symbolic-ref") return "main";
    if (args[0] === "rev-parse" && args[1] === "HEAD") return head;
    if (args[0] === "rev-parse") {
      const sha = branches.get(args[2]!.replace("refs/heads/", ""));
      if (!sha) throw missing();
      return sha;
    }
    if (args[0] === "merge-base") {
      if (ancestors.has(args[2]!)) return "";
      throw Object.assign(new Error("not ancestor"), { status: 1 });
    }
    throw new Error(`Unexpected git: ${args}`);
  };
  const ralph = {
    pi: () => ({}),
    Output: { object: (value: unknown) => value },
    run: async (args: any) => {
      calls.push(args.name);
      if (args.name === "planner") {
        lockSeen = files.has(".ralph/workflow-lock.json");
        return {
          output: args.output.schema.parse({
            issues: options.issues ?? [issue],
          }),
        };
      }
      if (options.quota) throw new Error("429 quota");
      if (options.merge !== false) {
        ancestors.add(branches.get(issue.branch)!);
        head = "merged";
      }
      return { completionSignal: COMPLETE };
    },
    createSandbox: async () => ({
      run: async (args: any) => {
        calls.push(args.name);
        if (args.name === "implementer") {
          if (!options.noCommits) branches.set(issue.branch, "implementation");
          return {
            completionSignal: options.implementation ?? COMPLETE,
            commits: options.noCommits ? [] : ["implementation"],
          };
        }
        return { completionSignal: options.review ?? APPROVED, commits: [] };
      },
      close: async () => {
        calls.push("close");
      },
    }),
  };
  const run = () =>
    execute(
      ralph,
      () => ({}),
      z,
      git,
      () => {},
      (path: string) => {
        if (!files.has(path)) throw missing();
        return files.get(path);
      },
      (from: string, to: string) => {
        files.set(to, files.get(from)!);
        files.delete(from);
      },
      (path: string, content: string, writeOptions?: { flag?: string }) => {
        if (writeOptions?.flag === "wx" && files.has(path))
          throw Object.assign(new Error("file exists"), { code: "EEXIST" });
        files.set(path, content);
      },
      (path: string) => {
        if (!files.has(path))
          throw Object.assign(new Error("no such file"), { code: "ENOENT" });
        files.delete(path);
      },
      {
        env: {
          ...(options.authorized === null
            ? {}
            : {
                RALPH_AUTHORIZED_ISSUES: options.authorized ?? "56",
              }),
          ...(options.reconcile ? { RALPH_RECONCILE: "1" } : {}),
        },
        pid: ownPid,
        kill: (pid: number) => {
          if (alive.has(pid)) return true;
          throw Object.assign(new Error("no such process"), { code: "ESRCH" });
        },
      },
      { log: (line: string) => logs.push(line) },
    );
  const receipt = () =>
    JSON.parse(files.get(".ralph/workflow-state.json")!).issues[56];
  return {
    run,
    calls,
    receipt,
    branches,
    files,
    options,
    logs,
    lockHeldDuringPlanner: () => lockSeen,
    changeBase: () => {
      head = "changed-base";
    },
  };
}

describe("review workflow recovery gates", () => {
  it("requires explicit launch authorization before calling a model", async () => {
    const h = harness({ authorized: "" });
    await expect(h.run()).rejects.toThrow(/AUTHORIZED_ISSUES/);
    expect(h.calls).toEqual([]);
  });
  it("reviews pending commits instead of reimplementing them", async () => {
    const h = harness({ existing: "old-implementation" });
    await h.run();
    expect(h.calls).toEqual(["planner", "reviewer", "close", "merger"]);
    expect(h.receipt()).toMatchObject({
      phase: "merged",
      sha: "old-implementation",
    });
  });
  it("rejects a truncated review even with implementation commits", async () => {
    const h = harness({ review: "" });
    await expect(h.run()).rejects.toThrow(/review not approved/);
    expect(h.calls).not.toContain("merger");
    expect(h.receipt().phase).toBe("review-pending");
  });
  it("stops on empty implementation instead of burning more rounds", async () => {
    const h = harness({ noCommits: true });
    await expect(h.run()).rejects.toThrow(/no progress/);
    expect(h.calls).toEqual(["planner", "implementer", "close"]);
  });
  it("stops on implementation lacking completion even with commits", async () => {
    const h = harness({ implementation: "" });
    await expect(h.run()).rejects.toThrow(/incomplete/);
    expect(h.calls).not.toContain("reviewer");
  });
  it("pauses on quota and resumes the reviewed SHA at merge", async () => {
    const h = harness({ existing: "old", quota: true });
    await expect(h.run()).rejects.toThrow(/429/);
    expect(h.receipt()).toMatchObject({
      phase: "merge-pending",
      sha: "old",
      reviewedBase: "base",
    });
    h.options.quota = false;
    await h.run();
    expect(h.calls).toEqual([
      "planner",
      "reviewer",
      "close",
      "merger",
      "planner",
      "merger",
    ]);
  });
  it.each(["branch", "base"])(
    "invalidates the review receipt when %s changes",
    async (changed) => {
      const h = harness({ existing: "old", quota: true });
      await expect(h.run()).rejects.toThrow(/429/);
      if (changed === "branch") h.branches.set(issue.branch, "new");
      else h.changeBase();
      h.options.quota = false;
      await h.run();
      expect(h.calls.filter((call) => call === "reviewer")).toHaveLength(2);
    },
  );
  it("does not believe a merger's COMPLETE without ancestry", async () => {
    const h = harness({ existing: "old", merge: false });
    await expect(h.run()).rejects.toThrow(/merge not verified/);
    expect(h.receipt().phase).toBe("merge-pending");
  });
  it("rejects unsafe or unauthorized planner branches before workers", async () => {
    const h = harness({
      issues: [{ ...issue, branch: "main; echo unexpected" }],
    });
    await expect(h.run()).rejects.toThrow(/Noncanonical/);
    expect(h.calls).toEqual(["planner"]);
  });
  it("rejects a parallel plan before any worker can overlap files", async () => {
    const h = harness({
      issues: [issue, { ...issue, id: "57", branch: "ralph/issue-57" }],
    });
    await expect(h.run()).rejects.toThrow();
    expect(h.calls).toEqual(["planner"]);
  });
  it("handles an empty plan without creating a sandbox or asserting all done", async () => {
    const h = harness({ issues: [] });
    await h.run();
    expect(h.calls).toEqual(["planner"]);
  });
});

describe("review workflow reconciliation report", () => {
  it("reports phase, branch, SHA and next step per issue across phases", async () => {
    const h = harness({
      reconcile: true,
      branches: {
        "ralph/issue-56": "approved-56",
        "ralph/issue-57": "work-57",
        "ralph/issue-59": "done-59",
      },
      integratedShas: ["done-59"],
      state: {
        "56": {
          branch: "ralph/issue-56",
          phase: "merge-pending",
          sha: "approved-56",
          reviewedBase: "base",
        },
        "57": {
          branch: "ralph/issue-57",
          phase: "review-pending",
          sha: "work-57",
        },
        "58": { branch: "ralph/issue-58", phase: "implementing" },
        "59": { branch: "ralph/issue-59", phase: "merged", sha: "done-59" },
      },
    });
    await h.run();
    const out = h.logs.join("\n");
    expect(out).toContain("Issue closure stays manual; no GitHub mutations");
    expect(out).toContain("#56 [merge-pending] ralph/issue-56 @ approved-56");
    expect(out).toContain(
      "approval intact for approved-56; relaunch the coordinator to merge",
    );
    expect(out).toContain("#57 [review-pending] ralph/issue-57 @ work-57");
    expect(out).toContain("relaunch to run acceptance review at work-57");
    expect(out).toContain("#58 [implementing] ralph/issue-58 @ no branch");
    expect(out).toContain("relaunch to implement");
    expect(out).toContain("#59 [merged] ralph/issue-59 @ done-59");
    expect(out).toContain("close issue #59 manually");
    // Read-only mode: no lock taken, no models invoked, no state rewritten.
    expect(h.calls).toEqual([]);
    expect(h.files.has(".ralph/workflow-lock.json")).toBe(false);
  });
  it("reports an authorized issue with no receipt as not started", async () => {
    const h = harness({ reconcile: true });
    await h.run();
    const out = h.logs.join("\n");
    expect(out).toContain("#56 [pending] ralph/issue-56 @ no branch");
    expect(out).toContain(
      "not started; authorize and relaunch to plan and implement",
    );
    expect(h.calls).toEqual([]);
  });
  it("scopes to persisted receipts when no issues are authorized", async () => {
    const h = harness({
      reconcile: true,
      authorized: null,
      branches: { "ralph/issue-57": "work-57" },
      state: {
        "57": {
          branch: "ralph/issue-57",
          phase: "review-pending",
          sha: "work-57",
        },
      },
    });
    await h.run();
    expect(h.logs.join("\n")).toContain(
      "#57 [review-pending] ralph/issue-57 @ work-57",
    );
    expect(h.calls).toEqual([]);
  });
  it("flags a moved branch as needing re-review after approval", async () => {
    const h = harness({
      reconcile: true,
      branches: { "ralph/issue-56": "moved-56" },
      state: {
        "56": {
          branch: "ralph/issue-56",
          phase: "merge-pending",
          sha: "approved-56",
          reviewedBase: "base",
        },
      },
    });
    await h.run();
    expect(h.logs.join("\n")).toContain(
      "branch moved after approval (approved approved-56, now moved-56); relaunch re-reviews",
    );
  });
  it("shows the preserved resume phase after a failed round", async () => {
    const h = harness({ existing: "old", quota: true });
    await expect(h.run()).rejects.toThrow(/429/);
    h.options.reconcile = true;
    await h.run();
    const out = h.logs.join("\n");
    expect(out).toContain("#56 [merge-pending] ralph/issue-56 @ old");
    expect(out).toContain(
      "approval intact for old; relaunch the coordinator to merge",
    );
  });
  it("prints the report on the already-integrated stop instead of a bare instruction", async () => {
    const h = harness({
      existing: "done-56",
      integratedShas: ["done-56"],
      state: {
        "56": {
          branch: "ralph/issue-56",
          phase: "review-pending",
          sha: "done-56",
        },
      },
    });
    await expect(h.run()).rejects.toThrow(/already integrated/);
    await expect(h.run()).rejects.toThrow(/closure stays manual/);
    const out = h.logs.join("\n");
    expect(out).toContain("#56 [review-pending] ralph/issue-56 @ done-56");
    expect(out).toContain("close issue #56 manually or open follow-up work");
    expect(h.calls).toEqual(["planner", "planner"]);
  });
});

describe("review workflow coordinator lock", () => {
  it("refuses a second coordinator before any worker or state mutation", async () => {
    const h = harness({ lock: { pid: 999, alive: true } });
    await expect(h.run()).rejects.toThrow(
      /PID 999 is already active on main.*refusing to start a second/,
    );
    expect(h.calls).toEqual([]);
    // The active coordinator's lock and workflow state stay untouched.
    expect(h.files.get(".ralph/workflow-lock.json")).toMatch(/"pid": 999/);
    expect(h.files.has(".ralph/workflow-state.json")).toBe(false);
  });
  it("refuses an unreadable lock instead of overwriting it", async () => {
    const h = harness({ lock: { pid: 999, alive: false, raw: "{corrupt" } });
    await expect(h.run()).rejects.toThrow(/unreadable/);
    expect(h.calls).toEqual([]);
    expect(h.files.get(".ralph/workflow-lock.json")).toBe("{corrupt");
  });
  it("takes over a stale lock left by a dead coordinator", async () => {
    const h = harness({ lock: { pid: 999, alive: false } });
    await h.run();
    expect(h.logs.join("\n")).toMatch(/stale lock left by dead PID 999/);
    expect(h.calls).toEqual([
      "planner",
      "implementer",
      "reviewer",
      "close",
      "merger",
    ]);
    expect(h.receipt().phase).toBe("merged");
    expect(h.files.has(".ralph/workflow-lock.json")).toBe(false);
  });
  it("acquires and releases the lock on a normal launch", async () => {
    const h = harness();
    await h.run();
    expect(h.lockHeldDuringPlanner()).toBe(true);
    expect(h.calls).toContain("planner");
    expect(h.files.has(".ralph/workflow-lock.json")).toBe(false);
  });
  it("releases the lock after a failed run so relaunching is not blocked", async () => {
    const h = harness({ quota: true });
    await expect(h.run()).rejects.toThrow(/429/);
    expect(h.files.has(".ralph/workflow-lock.json")).toBe(false);
    h.options.quota = false;
    await h.run();
    expect(h.calls).toContain("merger");
  });
});
