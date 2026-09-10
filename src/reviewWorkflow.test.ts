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
const js = ts.transpileModule(source.replace(/^import .*;\n/gm, ""), {
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
    authorized?: string;
    issues?: (typeof issue)[];
    noCommits?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const files = new Map<string, string>();
  const branches = new Map<string, string>();
  const ancestors = new Set(["base"]);
  if (options.existing) branches.set(issue.branch, options.existing);
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
      if (args.name === "planner")
        return {
          output: args.output.schema.parse({
            issues: options.issues ?? [issue],
          }),
        };
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
      (path: string, content: string) => {
        files.set(path, content);
      },
      { env: { RALPH_AUTHORIZED_ISSUES: options.authorized ?? "56" } },
      { log: () => {} },
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
