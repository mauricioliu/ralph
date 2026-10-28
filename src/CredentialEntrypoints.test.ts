import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pi, type AgentProvider } from "./AgentProvider.js";
import { run } from "./run.js";
import { interactive } from "./interactive.js";
import { createWorktree, type Worktree } from "./createWorktree.js";
import { createSandbox, type Sandbox } from "./createSandbox.js";
import {
  createBindMountSandboxProvider,
  type BindMountSandboxProvider,
  type BindMountSandboxHandle,
} from "./SandboxProvider.js";

const exec = promisify(execFile);
const AUTH = '{"synthetic":{"type":"oauth","access":"not-a-real-token"}}';
const CATALOG = '{"models":[{"id":"fixture-model"}]}';
const surfaces = [
  "run",
  "interactive",
  "Worktree.run",
  "Worktree.interactive",
  "Sandbox.run",
  "Sandbox.interactive",
  "Worktree.Sandbox.run",
  "Worktree.Sandbox.interactive",
] as const;
type Surface = (typeof surfaces)[number];

describe("credentials across all agent entry points (no agent or container processes)", () => {
  let root: string;
  let repo: string;
  let host: string;
  let home: string;
  let target: string;
  let provider: AgentProvider;
  let sandbox: BindMountSandboxProvider;
  let worktree: Worktree | undefined;
  let warm: Sandbox | undefined;
  let handles: BindMountSandboxHandle[];
  let events: string[];
  let failCopy: boolean;
  let abortOnCopy: AbortController | undefined;
  let emitSession: string | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ralph-credential-entry-"));
    repo = join(root, "repo");
    host = join(root, "host-auth");
    home = join(root, "sandbox-home");
    target = join(home, ".pi", "agent");
    for (const dir of [repo, host, home]) await mkdir(dir);
    await writeFile(join(host, "auth.json"), AUTH);
    await writeFile(join(host, "models-store.json"), CATALOG);
    for (const args of [
      ["init", "-b", "main"],
      ["config", "user.name", "Fixture"],
      ["config", "user.email", "fixture@example.invalid"],
    ])
      await exec("git", args, { cwd: repo });
    await writeFile(join(repo, "initial.txt"), "initial");
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-m", "fixture"], { cwd: repo });
    // Prevent lifecycle git-config commands from touching the user's global config.
    const gitConfig = join(root, "gitconfig");
    await writeFile(gitConfig, "");
    handles = [];
    events = [];
    failCopy = false;
    abortOnCopy = undefined;
    emitSession = undefined;
    provider = pi("fixture-model", {
      captureSessions: false,
      credentials: { hostAgentDir: host },
    });
    const agentStarted = async () => {
      events.push("agent");
      expect(await readFile(join(target, "auth.json"), "utf8")).toBe(
        await readFile(join(host, "auth.json"), "utf8"),
      );
      expect(await readFile(join(target, "models-store.json"), "utf8")).toBe(
        CATALOG,
      );
      expect((await stat(join(target, "auth.json"))).mode & 0o777).toBe(0o600);
      expect(
        (await readdir(target)).filter((name) =>
          name.startsWith(".ralph-credentials-"),
        ),
      ).toEqual([]);
    };
    sandbox = createBindMountSandboxProvider({
      name: "synthetic-credential-sandbox",
      create: async (options) => {
        const handle: BindMountSandboxHandle = {
          worktreePath: options.worktreePath,
          exec: vi.fn(async (command, opts) => {
            if (command.startsWith("pi ")) {
              await agentStarted();
              const line = JSON.stringify({
                type: "message_end",
                message: {
                  role: "assistant",
                  content: [{ type: "text", text: "fixture complete" }],
                },
              });
              if (emitSession)
                opts?.onLine?.(
                  JSON.stringify({ type: "session", id: emitSession }),
                );
              opts?.onLine?.(line);
              return { stdout: line, stderr: "", exitCode: 0 };
            }
            try {
              const result = await exec("sh", ["-c", command], {
                cwd: opts?.cwd ?? options.worktreePath,
                env: {
                  ...process.env,
                  ...options.env,
                  HOME: home,
                  GIT_CONFIG_GLOBAL: gitConfig,
                },
              });
              return { ...result, exitCode: 0 };
            } catch (error) {
              const e = error as {
                stdout: string;
                stderr: string;
                code: number;
              };
              return { stdout: e.stdout, stderr: e.stderr, exitCode: e.code };
            }
          }),
          interactiveExec: vi.fn(async () => {
            await agentStarted();
            return { exitCode: 0 };
          }),
          copyFileIn: vi.fn(async (source, destination) => {
            events.push("copy");
            if (failCopy) throw new Error("synthetic-sensitive-copy-error");
            await copyFile(source, destination);
            abortOnCopy?.abort("synthetic-copy-abort");
          }),
          copyFileOut: vi.fn(async () => {
            throw new Error("Unexpected reverse credential copy");
          }),
          close: vi.fn(async () => {}),
        };
        handles.push(handle);
        return handle;
      },
    });
  });
  afterEach(async () => {
    await warm?.close();
    await worktree?.close();
    warm = undefined;
    worktree = undefined;
    await rm(root, { recursive: true, force: true });
  });

  const invoke = async (surface: Surface, signal?: AbortSignal) => {
    const common = { agent: provider, prompt: "synthetic only", signal };
    if (surface === "run")
      return run({
        ...common,
        sandbox,
        cwd: repo,
        branchStrategy: { type: "head" },
        maxIterations: 1,
        logging: { type: "stdout" },
      });
    if (surface === "interactive")
      return interactive({
        ...common,
        sandbox,
        cwd: repo,
        branchStrategy: { type: "head" },
      });
    if (surface.startsWith("Worktree.")) {
      worktree ??= await createWorktree({
        cwd: repo,
        branchStrategy: { type: "merge-to-head" },
      });
      if (surface === "Worktree.run")
        return worktree.run({
          ...common,
          sandbox,
          maxIterations: 1,
          logging: { type: "stdout" },
        });
      if (surface === "Worktree.interactive")
        return worktree.interactive({ ...common, sandbox });
      warm ??= await worktree.createSandbox({ sandbox });
    } else {
      warm ??= await createSandbox({
        cwd: repo,
        sandbox,
        branch: "fixture-warm",
      });
    }
    return surface.endsWith("interactive")
      ? warm.interactive(common)
      : warm.run({ ...common, maxIterations: 1, logging: { type: "stdout" } });
  };

  it.each(surfaces)(
    "%s transfers auth and catalog before launching, never reverse-copies tokens",
    async (surface) => {
      await invoke(surface);
      expect(events).toEqual(["copy", "copy", "agent"]);
      expect(await readFile(join(host, "auth.json"), "utf8")).toBe(AUTH);
      for (const handle of handles) {
        expect(handle.copyFileOut).not.toHaveBeenCalled();
        expect(handle.close).toHaveBeenCalledTimes(
          surface.startsWith("Sandbox.") ||
            surface.startsWith("Worktree.Sandbox.")
            ? 0
            : 1,
        );
      }
    },
  );

  it.each(surfaces)(
    "%s stops on copy failure, cleans staging and supports retry",
    async (surface) => {
      failCopy = true;
      await expect(invoke(surface)).rejects.toThrow(
        /Pi credential transfer could not copy auth.json/,
      );
      expect(events).not.toContain("agent");
      expect(await readdir(target)).toEqual([]);
      expect(await readFile(join(host, "auth.json"), "utf8")).toBe(AUTH);
      failCopy = false;
      events = [];
      await invoke(surface);
      expect(events).toEqual(["copy", "copy", "agent"]);
    },
  );

  it.each(surfaces)(
    "%s handles abort during provisioning without launching; retry remains usable",
    async (surface) => {
      const ac = new AbortController();
      abortOnCopy = ac;
      await expect(invoke(surface, ac.signal)).rejects.toBe(
        "synthetic-copy-abort",
      );
      expect(events).not.toContain("agent");
      expect(await readdir(target)).toEqual([]);
      abortOnCopy = undefined;
      events = [];
      await invoke(surface);
      expect(events).toEqual(["copy", "copy", "agent"]);
    },
  );

  it.each(surfaces)(
    "%s pre-abort neither copies nor launches an agent",
    async (surface) => {
      const ac = new AbortController();
      ac.abort("pre-abort");
      await expect(invoke(surface, ac.signal)).rejects.toBe("pre-abort");
      expect(events).toEqual([]);
    },
  );

  it.each([
    "Sandbox.run",
    "Sandbox.interactive",
    "Worktree.Sandbox.run",
    "Worktree.Sandbox.interactive",
  ] as const)(
    "%s refreshes credentials for every call without restarting the warm sandbox",
    async (surface) => {
      await invoke(surface);
      await writeFile(join(target, "auth.json"), "sandbox-refresh-only");
      expect(await readFile(join(host, "auth.json"), "utf8")).toBe(AUTH);
      await writeFile(join(host, "auth.json"), "new-fixture-token");
      events = [];
      await invoke(surface);
      expect(events).toEqual(["copy", "copy", "agent"]);
      expect(handles).toHaveLength(1);
      expect(handles[0]!.close).not.toHaveBeenCalled();
    },
  );

  it.each(["Sandbox.run", "Worktree.Sandbox.run"] as const)(
    "%s keeps the credential handle separate while capturing and resuming on the same warm session handle",
    async (surface) => {
      emitSession = "fixture-session-id";
      const provision = provider.provisionCredentials!;
      const capture = vi.fn(
        async ({ handle }: { handle: BindMountSandboxHandle }) => {
          expect(handle).toBe(handles[0]);
          expect(handle.copyFileOut).toBeTypeOf("function");
          expect(handle.copyFileIn).toBeTypeOf("function");
        },
      );
      const resume = vi.fn(
        async ({ handle }: { handle: BindMountSandboxHandle }) => {
          expect(handle).toBe(handles[0]);
          expect(handle.copyFileIn).toBeTypeOf("function");
        },
      );
      provider = {
        ...provider,
        captureSessions: true,
        provisionCredentials: async (args) => {
          expect(Object.keys(args.handle).sort()).toEqual(["copyFile", "exec"]);
          await provision(args);
        },
        sessionStorage: {
          ...provider.sessionStorage!,
          captureToHost: capture,
          resumeIntoSandbox: resume,
          existsOnHost: async () => true,
          hostSessionFilePath: () => join(host, "fixture-session.jsonl"),
          readHostSession: async () => undefined,
        },
      };
      await invoke(surface);
      await warm!.run({
        agent: provider,
        prompt: "synthetic resume",
        maxIterations: 1,
        resumeSession: emitSession,
        logging: { type: "stdout" },
      });
      expect(capture).toHaveBeenCalledTimes(2);
      expect(resume).toHaveBeenCalledOnce();
      expect(handles).toHaveLength(1);
      expect(events).toEqual([
        "copy",
        "copy",
        "agent",
        "copy",
        "copy",
        "agent",
      ]);
      expect(await readFile(join(host, "auth.json"), "utf8")).toBe(AUTH);
    },
  );

  it("fails closed on a malformed custom bind-mount handle instead of borrowing the session handle", async () => {
    const originalCreate = sandbox.create;
    sandbox = {
      ...sandbox,
      create: async (options) => {
        const handle = await originalCreate(options);
        return {
          ...handle,
          copyFileIn: undefined,
        } as unknown as BindMountSandboxHandle;
      },
    };
    await expect(invoke("run")).rejects.toThrow(
      /credentials require sandbox exec and host-to-sandbox file copy/,
    );
    expect(events).toEqual([]);
    expect(handles[0]!.close).toHaveBeenCalledOnce();
  });
});
