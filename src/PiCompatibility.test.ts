import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { pi } from "./AgentProvider.js";
import type { AgentStreamEvent } from "./AgentStreamEmitter.js";
import { createSandbox, type Sandbox } from "./createSandbox.js";
import { Output, type StructuredOutputError } from "./Output.js";
import { run } from "./run.js";
import {
  createBindMountSandboxProvider,
  type ExecResult,
} from "./SandboxProvider.js";
import { encodePiSessionDir, findPiSessionOnHost } from "./SessionStore.js";

const exec = promisify(execFile);
const sessionId = "synthetic-pi-session";
const auth = (version: number) =>
  JSON.stringify({ fixture: { access: `synthetic-only-${version}` } });
interface Stage {
  text: string;
  commit?: boolean;
  hang?: boolean;
  abort?: AbortController;
}

// Public-API compatibility checks: actual git/filesystem/credential/session
// plumbing, but Pi commands are intercepted before ANY shell invocation.
// This is a provider double, not an OAuth, container, or inference test.
describe("Pi reconstruction compatibility contracts", () => {
  let root: string;
  let repo: string;
  let hostAgentDir: string;
  let sandboxAgentDir: string;
  let hostSessionsDir: string;
  let sandboxSessionsDir: string;
  let warm: Sandbox | undefined;
  let stages: Stage[];
  let launches: { command: string; stdin?: string; cwd: string }[];
  let creates: number;
  let closes: number;
  let events: AgentStreamEvent[];
  let lines: string[];

  const git = async (cwd: string, ...args: string[]) =>
    (await exec("git", args, { cwd })).stdout.trim();
  const sessionPath = (base: string, cwd: string) =>
    join(base, encodePiSessionDir(cwd), `fixture_${sessionId}.jsonl`);
  const agent = () =>
    pi("fixture/model", {
      credentials: { hostAgentDir, sandboxAgentDir },
      sessionStorage: { hostSessionsDir, sandboxSessionsDir },
    });
  const logging = () => ({
    type: "file" as const,
    path: join(root, "run.log"),
    onAgentStreamEvent: (event: AgentStreamEvent) => events.push(event),
  });
  const provider = () =>
    createBindMountSandboxProvider({
      name: "synthetic-pi-compatibility",
      create: async ({ worktreePath }) => {
        creates++;
        const copy = async (source: string, destination: string) => {
          await mkdir(dirname(destination), { recursive: true });
          await copyFile(source, destination);
        };
        return {
          worktreePath,
          copyFileIn: copy,
          copyFileOut: copy,
          close: async () => {
            closes++;
          },
          exec: async (command, options): Promise<ExecResult> => {
            const cwd = options?.cwd ?? worktreePath;
            if (command.includes("pi -p ")) {
              const stage = stages.shift();
              expect(stage, "unexpected extra Pi invocation").toBeDefined();
              if (!stage) throw new Error("missing synthetic stage");
              launches.push({ command, stdin: options?.stdin, cwd });
              expect(
                await readFile(join(sandboxAgentDir, "auth.json"), "utf8"),
              ).toBe(await readFile(join(hostAgentDir, "auth.json"), "utf8"));
              const path = sessionPath(sandboxSessionsDir, cwd);
              let previous = "";
              if (command.includes("--session")) {
                expect(command).toContain(`--session '${sessionId}'`);
                previous = await readFile(path, "utf8");
                expect(JSON.parse(previous.split("\n")[0]!).cwd).toBe(cwd);
                expect(previous).toContain('"turn":1');
              }
              await mkdir(dirname(path), { recursive: true });
              const record =
                previous ||
                JSON.stringify({ type: "session", id: sessionId, cwd }) + "\n";
              await writeFile(
                path,
                record +
                  JSON.stringify({ type: "fixture", turn: launches.length }) +
                  "\n",
              );
              if (stage.commit) {
                await writeFile(
                  join(cwd, "pi-change.txt"),
                  `turn ${launches.length}\n`,
                );
                await git(cwd, "add", "pi-change.txt");
                await git(cwd, "commit", "-m", "synthetic Pi change");
              }
              const stream = [
                JSON.stringify({ type: "session", id: sessionId }),
                JSON.stringify({
                  type: "message_end",
                  message: {
                    role: "user",
                    content: [
                      {
                        type: "text",
                        text: "<promise>COMPLETE</promise> must not count",
                      },
                    ],
                  },
                }),
                JSON.stringify({ type: "fixture_unknown", value: "raw-only" }),
                JSON.stringify({
                  type: "message_update",
                  assistantMessageEvent: {
                    type: "text_delta",
                    delta: stage.text,
                  },
                }),
                JSON.stringify({
                  type: "message_end",
                  message: {
                    role: "assistant",
                    stopReason: "stop",
                    content: [{ type: "text", text: stage.text }],
                  },
                }),
              ];
              for (const line of stream) {
                lines.push(line);
                options?.onLine?.(line);
              }
              stage.abort?.abort("synthetic-mid-flight-cancel");
              if (stage.hang) return new Promise<ExecResult>(() => {});
              return { stdout: stream.join("\n"), stderr: "", exitCode: 0 };
            }
            // Only library-generated git, permission and session shell operations.
            const result = await exec("sh", ["-c", command], {
              cwd,
              env: {
                PATH: process.env.PATH,
                HOME: root,
                GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
              },
            }).then(
              (value) => ({ ...value, exitCode: 0 }),
              (error: { stdout: string; stderr: string; code: number }) => ({
                stdout: error.stdout,
                stderr: error.stderr,
                exitCode: error.code,
              }),
            );
            for (const line of result.stdout.split("\n").filter(Boolean))
              options?.onLine?.(line);
            return result;
          },
        };
      },
    });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ralph-pi-compatibility-"));
    repo = join(root, "repo");
    hostAgentDir = join(root, "host-agent");
    sandboxAgentDir = join(root, "sandbox-agent");
    hostSessionsDir = join(root, "host-sessions");
    sandboxSessionsDir = join(root, "sandbox-sessions");
    for (const dir of [repo, hostAgentDir])
      await mkdir(dir, { recursive: true });
    await writeFile(join(hostAgentDir, "auth.json"), auth(1));
    await git(repo, "init", "-b", "main");
    await git(repo, "config", "user.name", "Fixture");
    await git(repo, "config", "user.email", "fixture@example.invalid");
    await writeFile(join(repo, ".gitignore"), ".ralph/\n");
    await git(repo, "add", ".gitignore");
    await git(repo, "commit", "-m", "fixture");
    stages = [];
    launches = [];
    events = [];
    lines = [];
    creates = closes = 0;
  });
  afterEach(async () => {
    await warm?.close();
    warm = undefined;
    await rm(root, { recursive: true, force: true });
  });

  it("captures, resumes and reuses one warm handle with fresh host credentials; rejects session forks", async () => {
    stages.push(
      { text: "first turn" },
      { text: "second turn" },
      { text: "third turn" },
    );
    warm = await createSandbox({
      sandbox: provider(),
      cwd: repo,
      branch: "fixture-warm",
    });
    const first = await warm.run({
      agent: agent(),
      prompt: "first",
      logging: logging(),
    });
    expect(first.iterations[0]!.sessionId).toBe(sessionId);
    expect(first.iterations[0]!.sessionFilePath).toBe(
      join(hostSessionsDir, encodePiSessionDir(repo)),
    );
    const hostPath = (await findPiSessionOnHost(sessionId, hostSessionsDir))
      .path!;
    expect(
      JSON.parse((await readFile(hostPath, "utf8")).split("\n")[0]!).cwd,
    ).toBe(repo);
    await writeFile(join(hostAgentDir, "auth.json"), auth(2));
    const second = await first.resume!("second");
    expect(second.stdout).toBe("second turn");
    expect(second.completionSignal).toBeUndefined();
    expect(await readFile(hostPath, "utf8")).toContain('"turn":2');
    const captured = await readFile(hostPath, "utf8");
    await expect(second.fork!("unsupported session fork")).rejects.toThrow(
      /Pi session fork is not supported/,
    );
    expect(await readFile(hostPath, "utf8")).toBe(captured);
    expect(launches).toHaveLength(2);
    await warm.run({ agent: agent(), prompt: "third", logging: logging() });
    expect(creates).toBe(1);
    expect(closes).toBe(0);
    expect(launches).toHaveLength(3);
    expect(
      events.filter((event) => event.type === "raw").map((event) => event.line),
    ).toEqual(lines);
    expect(
      events
        .filter((event) => event.type === "text")
        .map((event) => event.message)
        .join(""),
    ).toContain("second turn");
    expect(await readFile(join(root, "run.log"), "utf8")).not.toContain(
      "synthetic-only-",
    );
  });

  it.each([false, true])(
    "structured-output retry uses Pi session resume (exhausted=%s)",
    async (exhausted) => {
      stages.push(
        { text: "<result>bad JSON</result>" },
        {
          text: exhausted
            ? "<result>still bad</result>"
            : '<result>{"answer":42}</result>',
        },
      );
      const attempt = run({
        agent: agent(),
        sandbox: provider(),
        cwd: repo,
        branchStrategy: { type: "head" },
        prompt: "emit <result> JSON",
        logging: logging(),
        output: Output.object({
          tag: "result",
          schema: z.object({ answer: z.number() }),
          maxRetries: 1,
        }),
      });
      if (exhausted) {
        await expect(attempt).rejects.toMatchObject({
          name: "StructuredOutputError",
          sessionId,
          rawMatched: "still bad",
        } satisfies Partial<StructuredOutputError>);
      } else {
        const result = await attempt;
        expect(result.output).toEqual({ answer: 42 });
        expect(result.iterations[0]!.sessionId).toBe(sessionId);
      }
      expect(launches).toHaveLength(2);
      expect(launches[0]!.command).not.toContain("--session");
      expect(launches[1]!.command).toContain(`--session '${sessionId}'`);
      expect(launches[1]!.stdin).toContain("<result>");
      expect(launches[1]!.stdin).toMatch(/JSON|json/);
      expect(creates).toBe(2);
      expect(closes).toBe(2);
      expect(
        await readFile(sessionPath(hostSessionsDir, repo), "utf8"),
      ).toContain('"turn":2');
    },
  );

  it("merge-to-head keeps branch strategy independent from Pi session resume", async () => {
    stages.push({ text: "<promise>COMPLETE</promise>", commit: true });
    const result = await run({
      agent: agent(),
      sandbox: provider(),
      cwd: repo,
      branchStrategy: { type: "merge-to-head" },
      prompt: "fixture change",
      logging: logging(),
    });
    expect(result.completionSignal).toBe("<promise>COMPLETE</promise>");
    expect(result.commits).toHaveLength(1);
    expect(await readFile(join(repo, "pi-change.txt"), "utf8")).toBe(
      "turn 1\n",
    );
    expect(await git(repo, "branch", "--show-current")).toBe("main");
    expect(await git(repo, "branch", "--list", "ralph/*")).toBe("");
    expect(launches[0]!.cwd).not.toBe(repo);
    expect(launches[0]!.command).not.toMatch(/--session|fork/);
    const hostPath = (await findPiSessionOnHost(sessionId, hostSessionsDir))
      .path!;
    expect(
      JSON.parse((await readFile(hostPath, "utf8")).split("\n")[0]!).cwd,
    ).toBe(repo);
  });

  it.each(["idle", "completion", "cancel"] as const)(
    "%s handling preserves a usable Pi handle",
    async (mode) => {
      const controller = new AbortController();
      stages.push(
        {
          text:
            mode === "completion" ? "<promise>COMPLETE</promise>" : "waiting",
          hang: true,
          abort: mode === "cancel" ? controller : undefined,
        },
        { text: "reused successfully" },
      );
      warm = await createSandbox({
        sandbox: provider(),
        cwd: repo,
        branch: "fixture-timeout",
      });
      const attempt = warm.run({
        agent: agent(),
        prompt: "fixture",
        logging: logging(),
        idleTimeoutSeconds: 0.1,
        completionTimeoutSeconds: 0.05,
        signal: controller.signal,
      });
      if (mode === "completion")
        expect((await attempt).completionSignal).toBe(
          "<promise>COMPLETE</promise>",
        );
      else if (mode === "cancel")
        await expect(attempt).rejects.toBe("synthetic-mid-flight-cancel");
      else await expect(attempt).rejects.toThrow(/idle/i);
      const next = await warm.run({
        agent: agent(),
        prompt: "reuse",
        logging: logging(),
      });
      expect(next.stdout).toBe("reused successfully");
      expect(creates).toBe(1);
      expect(closes).toBe(0);
      expect(launches).toHaveLength(2);
    },
  );
});
