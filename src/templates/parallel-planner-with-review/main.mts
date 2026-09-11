// Conservative planner → implement/recover → review → merge workflow.
// One issue per round: overlapping modules cannot run concurrently.
// Explicit launch authorization, a single-coordinator lock on the .ralph/
// installation, durable phase receipts and git ancestry are gates; agent
// completion alone is never evidence of integration.
import * as ralph from "@mauricioliu/ralph";
import { docker } from "@mauricioliu/ralph/sandboxes/docker";
import { z } from "zod";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

const MAX_ITERATIONS = 10;
const APPROVED = "<promise>REVIEW_APPROVED</promise>";
const COMPLETE = "<promise>COMPLETE</promise>";
const hooks = {
  sandbox: {
    onSandboxReady: [
      { command: "npm install --no-audit --no-fund", timeoutMs: 300_000 },
    ],
  },
};
const copyToWorktree = ["node_modules"];
const taskIdPattern = /^[A-Za-z0-9]+(?:[-_.][A-Za-z0-9]+)*$/;
const planSchema = z.object({
  issues: z
    .array(
      z.object({
        id: z.string().regex(taskIdPattern),
        title: z.string(),
        branch: z.string(),
      }),
    )
    .max(1),
});

// Read-only reconciliation mode (ADR 0023): print the per-issue state report
// from persisted receipts plus git ancestry, then exit without taking the
// coordinator lock, invoking models or mutating anything.
const reconcileMode = process.env.RALPH_RECONCILE === "1";
// This is an execution allowlist, NOT evidence that external inputs exist.
// Set only IDs authorized by the human for this launch. No default backlog run.
const authorized = new Set(
  (process.env.RALPH_AUTHORIZED_ISSUES ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);
if (
  (!authorized.size && !reconcileMode) ||
  [...authorized].some((id) => !taskIdPattern.test(id))
) {
  throw new Error(
    "Set RALPH_AUTHORIZED_ISSUES to explicitly authorized issue IDs before launching.",
  );
}
// Configure known external blockers here; the planner must also check each
// issue's dependencies and required human decisions before selecting it.
const externalBlockers = new Set<string>();
const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8" }).trim();
const target = git("symbolic-ref", "--short", "HEAD");
const head = () => git("rev-parse", "HEAD");
const branchSha = (branch: string): string | undefined => {
  try {
    return git("rev-parse", "--verify", `refs/heads/${branch}`);
  } catch {
    return undefined;
  }
};
const included = (sha: string) => {
  try {
    git("merge-base", "--is-ancestor", sha, "HEAD");
    return true;
  } catch (error) {
    if ((error as { status?: number }).status === 1) return false;
    throw error;
  }
};
const assertTarget = () => {
  if (git("symbolic-ref", "--short", "HEAD") !== target)
    throw new Error("Target branch changed; stopping.");
};

// Durable per-issue phase receipts (ADR 0023). Atomic tmp+rename writes;
// failures never rewrite a receipt, so a stop preserves the resume phase.
const receiptSchema = z.object({
  branch: z.string(),
  phase: z.enum(["implementing", "review-pending", "merge-pending", "merged"]),
  sha: z.string().optional(),
  reviewedBase: z.string().optional(),
});
const stateSchema = z.object({
  version: z.literal(1),
  issues: z.record(z.string(), receiptSchema),
});
type Receipt = z.infer<typeof receiptSchema>;
const statePath = ".ralph/workflow-state.json";
let state: z.infer<typeof stateSchema>;
try {
  state = stateSchema.parse(JSON.parse(readFileSync(statePath, "utf8")));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  state = { version: 1, issues: {} };
}
const save = (id: string, receipt: Receipt) => {
  state.issues[id] = receipt;
  mkdirSync(".ralph", { recursive: true });
  writeFileSync(`${statePath}.tmp`, JSON.stringify(state, null, 2) + "\n");
  renameSync(`${statePath}.tmp`, statePath);
};

// Reconciliation report (ADR 0023). Read-only: receipts supply the recorded
// phase and review verdict; branch, SHA and integration facts are always
// re-derived from git, never trusted from the receipt. Scope is the
// authorized set union every persisted receipt, so the report still works
// after a stop even if the original authorization environment was lost.
const nextStep = (
  id: string,
  receipt: Receipt | undefined,
  sha: string | undefined,
  integrated: boolean,
): string => {
  if (receipt?.phase === "merged")
    return receipt.sha && included(receipt.sha)
      ? `fully integrated; close issue #${id} manually — issue closure is human-owned, never automatic`
      : `merged receipt but recorded SHA ${receipt.sha ?? "?"} is not in target ancestry; inspect manually (was the target rewritten?)`;
  if (integrated)
    return `branch is already integrated into ${target} while the recorded phase is ${receipt?.phase ?? "absent (no receipt)"}; close issue #${id} manually or open follow-up work — the coordinator stops here and never auto-retries closure`;
  if (receipt?.phase === "merge-pending") {
    if (!sha)
      return "branch no longer exists; relaunch re-implements from scratch";
    if (receipt.sha !== sha)
      return `branch moved after approval (approved ${receipt.sha}, now ${sha}); relaunch re-reviews`;
    if (receipt.reviewedBase !== head())
      return `target advanced since review (approved against ${receipt.reviewedBase}); relaunch re-reviews`;
    return `approval intact for ${sha}; relaunch the coordinator to merge`;
  }
  if (receipt?.phase === "review-pending")
    return sha
      ? `relaunch to run acceptance review at ${sha}`
      : "branch no longer exists; relaunch re-implements from scratch";
  if (receipt?.phase === "implementing")
    return sha
      ? "relaunch; existing commits go to acceptance review (no reimplementation)"
      : "relaunch to implement";
  return sha
    ? "no receipt for existing branch; relaunch reviews existing commits (legacy recovery)"
    : "not started; authorize and relaunch to plan and implement";
};
const reconcileReport = (): string[] => {
  const ids = [...new Set([...authorized, ...Object.keys(state.issues)])];
  const lines = [
    `Reconciliation report for target ${target} (HEAD ${head()}).`,
    "Issue closure stays manual; no GitHub mutations are performed.",
    "Approvals bind an exact SHA and reviewed base; later commits invalidate them.",
  ];
  if (!ids.length)
    lines.push("No authorized issues and no persisted receipts.");
  for (const id of ids) {
    const receipt = state.issues[id];
    const branch = receipt?.branch ?? `ralph/issue-${id}`;
    const sha = branchSha(branch);
    const integrated = sha !== undefined && included(sha);
    lines.push(
      `#${id} [${receipt?.phase ?? "pending"}] ${branch} @ ${sha ?? "no branch"}`,
    );
    lines.push(`  next: ${nextStep(id, receipt, sha, integrated)}`);
  }
  return lines;
};

// One coordinator per .ralph/ installation. A second launch must refuse
// before invoking any model, creating sandboxes, or mutating workflow state.
// The strategy follows ADR 0007 (worktree locks): atomic O_EXCL create, owner
// liveness via process.kill(pid, 0), stale locks from dead owners are removed
// and re-acquired automatically. An unreadable lock is refused, not overwritten
// -- atomic writes mean corruption is a human event, not a crash artifact.
// heartbeatAt is refreshed each round for diagnostics only; it NEVER evicts an
// owner, because a coordinator may legitimately spend unbounded time inside a
// single agent run. The lock is released in a finally on every exit that runs
// it; hard kills (SIGKILL, power loss) leave it behind for dead-PID recovery.
// Reconciliation mode skips the lock entirely: it is read-only and must stay
// usable even while a coordinator is running.
const lockPath = ".ralph/workflow-lock.json";
const lockSchema = z.object({
  pid: z.number().int().positive(),
  target: z.string(),
  startedAt: z.string(),
  heartbeatAt: z.string(),
});
const ownerAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true; // alive, owned by another user
    throw error;
  }
};
const acquireLock = (): {
  pid: number;
  target: string;
  startedAt: string;
  heartbeatAt: string;
} => {
  mkdirSync(".ralph", { recursive: true });
  for (let attempt = 1; attempt <= 3; attempt++) {
    const record = {
      pid: process.pid,
      target,
      startedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
    };
    try {
      writeFileSync(lockPath, JSON.stringify(record, null, 2) + "\n", {
        flag: "wx",
      });
      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    let owner: z.infer<typeof lockSchema>;
    try {
      owner = lockSchema.parse(JSON.parse(readFileSync(lockPath, "utf8")));
    } catch {
      throw new Error(
        `${lockPath} exists but is unreadable. Inspect it and remove it manually once you confirm no coordinator is running.`,
      );
    }
    if (ownerAlive(owner.pid))
      throw new Error(
        `Coordinator PID ${owner.pid} is already active on ${owner.target} (started ${owner.startedAt}, last heartbeat ${owner.heartbeatAt}). Only one coordinator may run against this repository; refusing to start a second. If PID ${owner.pid} is not a coordinator, remove ${lockPath} manually after verifying.`,
      );
    console.log(
      `Removing stale lock left by dead PID ${owner.pid}; taking over ${lockPath}.`,
    );
    unlinkSync(lockPath);
  }
  throw new Error(
    `Could not acquire ${lockPath} after repeated attempts; inspect it manually.`,
  );
};
const heartbeat = (lock: {
  pid: number;
  target: string;
  startedAt: string;
  heartbeatAt: string;
}) => {
  // Best-effort freshness refresh for the diagnostic above; never a gate.
  try {
    writeFileSync(
      `${lockPath}.tmp`,
      JSON.stringify(
        { ...lock, heartbeatAt: new Date().toISOString() },
        null,
        2,
      ) + "\n",
    );
    renameSync(`${lockPath}.tmp`, lockPath);
  } catch {
    // Heartbeat loss is non-fatal; the lock itself still protects exclusivity.
  }
};
const releaseLock = () => {
  try {
    unlinkSync(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
};

if (reconcileMode) {
  for (const line of reconcileReport()) console.log(line);
} else {
  const lock = acquireLock();
  let stoppedOnEmptyPlan = false;
  try {
    for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
      assertTarget();
      heartbeat(lock);
      const planBase = head();
      console.log(`Round ${iteration}/${MAX_ITERATIONS}`);
      const plan = await ralph.run({
        hooks,
        sandbox: docker(),
        name: "planner",
        maxIterations: 1,
        agent: ralph.pi("openai-codex/gpt-5.6-terra:high"),
        promptFile: "./.ralph/plan-prompt.md",
        promptArgs: { AUTHORIZED_ISSUES: [...authorized].join(", ") },
        output: ralph.Output.object({ tag: "plan", schema: planSchema }),
      });
      if (head() !== planBase)
        throw new Error("Planner changed target HEAD; stopping.");
      const [issue] = plan.output.issues;
      if (!issue) {
        console.log(
          "No authorized unblocked work selected. Backlog completion is NOT asserted.",
        );
        stoppedOnEmptyPlan = true;
        break;
      }
      if (!authorized.has(issue.id) || externalBlockers.has(issue.id)) {
        throw new Error(
          `Issue #${issue.id} is unauthorized or externally blocked; no worker started.`,
        );
      }
      if (issue.branch !== `ralph/issue-${issue.id}`)
        throw new Error("Noncanonical issue branch; stopping.");
      const existing = branchSha(issue.branch);
      if (existing && included(existing)) {
        // Report-and-stop (ADR 0023): the branch is already in the target but
        // the issue is still open. Reconciliation — closing the issue or
        // opening follow-up work — is a human decision; never auto-retried.
        for (const line of reconcileReport()) console.log(line);
        throw new Error(
          `#${issue.id} branch is already integrated. See the reconciliation report above; issue closure stays manual. Do not reimplement.`,
        );
      }
      const receipt = state.issues[issue.id];
      const reviewed =
        existing &&
        receipt?.phase === "merge-pending" &&
        receipt.branch === issue.branch &&
        receipt.sha === existing &&
        receipt.reviewedBase === head();
      if (!reviewed) {
        // Existing commits are work to REVIEW, not a reason to start over. A partial
        // implementation must fail the reviewer acceptance gate rather than merge.
        save(issue.id, {
          branch: issue.branch,
          phase: existing ? "review-pending" : "implementing",
          sha: existing,
        });
        const sandbox = await ralph.createSandbox({
          branch: issue.branch,
          sandbox: docker(),
          hooks,
          copyToWorktree,
        });
        try {
          if (!existing) {
            const implement = await sandbox.run({
              name: "implementer",
              maxIterations: 100,
              agent: ralph.pi("zai-coding-cn/glm-5.3:high"),
              promptFile: "./.ralph/implement-prompt.md",
              promptArgs: {
                TASK_ID: issue.id,
                ISSUE_TITLE: issue.title,
                BRANCH: issue.branch,
              },
            });
            if (
              implement.completionSignal !== COMPLETE ||
              !implement.commits.length
            ) {
              throw new Error(
                `#${issue.id}: implementation incomplete or no progress; stopping.`,
              );
            }
          }
          save(issue.id, {
            branch: issue.branch,
            phase: "review-pending",
            sha: branchSha(issue.branch),
          });
          const review = await sandbox.run({
            name: "reviewer",
            maxIterations: 1,
            completionSignal: APPROVED,
            agent: ralph.pi("zai-coding-cn/glm-5.3:high"),
            promptFile: "./.ralph/review-prompt.md",
            promptArgs: { TASK_ID: issue.id, BRANCH: issue.branch },
          });
          if (review.completionSignal !== APPROVED)
            throw new Error(`#${issue.id}: review not approved; stopping.`);
        } finally {
          await sandbox.close();
        }
        assertTarget();
        if (head() !== planBase)
          throw new Error("Target changed during review; stopping.");
        const sha = branchSha(issue.branch);
        if (!sha || included(sha))
          throw new Error("Review produced no pending branch; stopping.");
        save(issue.id, {
          branch: issue.branch,
          phase: "merge-pending",
          sha,
          reviewedBase: head(),
        });
      }

      const sha = state.issues[issue.id]!.sha!;
      const merged = await ralph.run({
        hooks,
        sandbox: docker(),
        name: "merger",
        maxIterations: 1,
        agent: ralph.pi("zai-coding-cn/glm-5.3:high"),
        promptFile: "./.ralph/merge-prompt.md",
        promptArgs: {
          BRANCHES: `- ${issue.branch} (${sha})`,
          ISSUES: `- ${issue.id}: ${issue.title}`,
        },
      });
      assertTarget();
      if (
        merged.completionSignal !== COMPLETE ||
        branchSha(issue.branch) !== sha ||
        !included(sha)
      ) {
        throw new Error(
          `#${issue.id}: merge not verified; receipt remains merge-pending.`,
        );
      }
      save(issue.id, { branch: issue.branch, phase: "merged", sha });
      console.log(
        `#${issue.id} integrated at ${head()}. Issue closure, visual acceptance and deployment remain separate.`,
      );
      // Keep a successfully handled issue out of subsequent plans, even though
      // GitHub remains open pending human acceptance.
      authorized.delete(issue.id);
      if (!authorized.size) {
        stoppedOnEmptyPlan = true;
        console.log(
          "Authorized set integrated locally; no further work launched.",
        );
        break;
      }
    }
    if (!stoppedOnEmptyPlan)
      throw new Error(
        "Iteration limit reached with unresolved authorized work. Resume explicitly after inspection.",
      );
  } finally {
    releaseLock();
  }
}
