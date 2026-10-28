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
import { createSandbox, type Sandbox } from "./createSandbox.js";
import { createWorktree, type Worktree } from "./createWorktree.js";
import { interactive } from "./interactive.js";
import { run } from "./run.js";
import type {
  BindMountSandboxHandle,
  IsolatedSandboxHandle,
  NoSandboxHandle,
  InteractiveExecOptions,
  SandboxProvider,
} from "./SandboxProvider.js";

const exec = promisify(execFile);
const AUTH = '{"fixture":{"access":"matrix-synthetic-secret-only"}}';
const CATALOG = '{"models":[{"id":"matrix-synthetic-model"}]}';
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
type RawHandle = BindMountSandboxHandle | IsolatedSandboxHandle;

describe.each(["bind-mount", "isolated", "none"] as const)(
  "%s credential entry-point matrix (provider doubles only)",
  (tag) => {
    let root: string;
    let repo: string;
    let host: string;
    let home: string;
    let target: string;
    let log: string;
    let agent: AgentProvider;
    let sandbox: SandboxProvider;
    let warm: Sandbox | undefined;
    let worktree: Worktree | undefined;
    let handles: RawHandle[];
    let events: string[];
    let commands: string[];
    let streams: unknown[];
    let catalog: boolean;
    let failure: "prepare" | "copy" | "permission" | "cleanup" | undefined;
    let abortOnCopy: AbortController | undefined;
    let destinationInsideWorktree: boolean;

    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), "ralph-provider-matrix-"));
      repo = join(root, "repo");
      home = join(root, tag === "none" ? "host home" : "sandbox home");
      host = tag === "none" ? join(home, ".pi", "agent") : join(root, "host");
      target = tag === "none" ? host : join(home, ".pi", "agent");
      log = join(root, "run.log");
      for (const dir of [repo, host, home])
        await mkdir(dir, { recursive: true });
      await writeFile(join(host, "auth.json"), AUTH, { mode: 0o640 });
      await writeFile(join(host, "models-store.json"), CATALOG, {
        mode: 0o640,
      });
      await writeFile(join(root, "gitconfig"), "");
      for (const args of [
        ["init", "-b", "main"],
        ["config", "user.name", "Fixture"],
        ["config", "user.email", "fixture@example.invalid"],
      ])
        await exec("git", args, { cwd: repo });
      await writeFile(join(repo, "initial.txt"), "fixture");
      await exec("git", ["add", "."], { cwd: repo });
      await exec("git", ["commit", "-m", "fixture"], { cwd: repo });
      handles = [];
      events = [];
      commands = [];
      streams = [];
      catalog = true;
      failure = undefined;
      abortOnCopy = undefined;
      destinationInsideWorktree = false;
      vi.stubEnv("PI_CODING_AGENT_DIR", tag === "none" ? undefined : host);
      if (tag === "none") vi.stubEnv("HOME", home);
      agent = pi("fixture", {
        captureSessions: false,
        credentials: { hostAgentDir: host },
      });
      // Inert process-boundary probe, not an installed agent. Execute the real
      // launch shell/environment so quoting and precedence remain observable.
      await mkdir(join(root, "bin"));
      await writeFile(
        join(root, "bin", "pi"),
        '#!/bin/sh\nprintf %s "${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"',
        { mode: 0o700 },
      );
      const shell = async (
        command: string,
        cwd: string,
        env: Record<string, string>,
      ) => {
        try {
          return {
            ...(await exec("sh", ["-c", command], {
              cwd,
              env: {
                ...process.env,
                ...env,
                GIT_CONFIG_GLOBAL: join(root, "gitconfig"),
              },
            })),
            exitCode: 0,
          };
        } catch (error) {
          const e = error as { stdout: string; stderr: string; code: number };
          return { stdout: e.stdout, stderr: e.stderr, exitCode: e.code };
        }
      };
      const create = async (options: {
        worktreePath?: string;
        env: Record<string, string>;
      }) => {
        const workspace =
          tag === "isolated"
            ? join(root, `workspace-${handles.length}`)
            : options.worktreePath!;
        await mkdir(workspace, { recursive: true });
        // An isolated default HOME must not inherit the host credential override.
        const env = {
          PI_CODING_AGENT_DIR: "",
          ...options.env,
          HOME: home,
          PATH: `${join(root, "bin")}:${process.env.PATH}`,
        };
        if (destinationInsideWorktree) {
          target = join(workspace, ".pi", "agent");
          env.PI_CODING_AGENT_DIR = target;
        }
        const started = async (dir: string) => {
          events.push("agent");
          expect(dir).toBe(target);
          expect(await readFile(join(dir, "auth.json"), "utf8")).toBe(
            await readFile(join(host, "auth.json"), "utf8"),
          );
          if (catalog)
            expect(await readFile(join(dir, "models-store.json"), "utf8")).toBe(
              CATALOG,
            );
          else
            await expect(
              stat(join(dir, "models-store.json")),
            ).rejects.toMatchObject({ code: "ENOENT" });
          if (tag !== "none") {
            expect((await stat(dir)).mode & 0o777).toBe(0o700);
            expect((await stat(join(dir, "auth.json"))).mode & 0o777).toBe(
              0o600,
            );
            expect(
              (await readdir(dir)).filter((n) =>
                n.startsWith(".ralph-credentials-"),
              ),
            ).toEqual([]);
          }
        };
        const handle = {
          worktreePath: workspace,
          exec: vi.fn<NoSandboxHandle["exec"]>(async (command, opts) => {
            commands.push(command);
            if (command.includes("pi -p ")) {
              await started(
                (await shell(command, workspace, { ...env, ...opts?.env }))
                  .stdout,
              );
              const line = JSON.stringify({
                type: "message_end",
                message: {
                  role: "assistant",
                  content: [{ type: "text", text: "fixture done" }],
                },
              });
              opts?.onLine?.(line);
              return { stdout: line, stderr: "", exitCode: 0 };
            }
            if (
              (failure === "prepare" && command.includes("mkdir -p")) ||
              (failure === "permission" && command.includes("chmod 600")) ||
              (failure === "cleanup" &&
                command.startsWith("rm -rf") &&
                command.includes(".ralph-credentials-"))
            )
              return { exitCode: 1, stdout: AUTH, stderr: AUTH };
            return shell(command, opts?.cwd ?? workspace, env);
          }),
          interactiveExec: vi.fn(
            async (args: string[], opts: InteractiveExecOptions) => {
              const override =
                args[0] === "env"
                  ? args[1]!.slice("PI_CODING_AGENT_DIR=".length)
                  : (opts.env?.PI_CODING_AGENT_DIR ?? env.PI_CODING_AGENT_DIR);
              await started(override || join(env.HOME, ".pi", "agent"));
              return { exitCode: 0 };
            },
          ),
          // This is also present on the no-sandbox double to prove tag-based skipping.
          copyFileIn: vi.fn(async (source: string, destination: string) => {
            if (
              source.endsWith("auth.json") ||
              source.endsWith("models-store.json")
            ) {
              events.push("copy");
              if (failure === "copy") throw new Error(AUTH);
              await copyFile(source, destination);
              abortOnCopy?.abort("fixture-cancel");
            } else await copyFile(source, destination);
          }),
          copyFileOut: vi.fn(async () => {
            throw new Error("Unexpected reverse copy (no fixture commits)");
          }),
          close: vi.fn(async () => {}),
        };
        const raw =
          tag === "isolated"
            ? (({ copyFileIn, ...rest }) => ({ ...rest, copyIn: copyFileIn }))(
                handle,
              )
            : handle;
        handles.push(raw);
        return raw;
      };
      sandbox = {
        tag,
        name: "fixture",
        env: {},
        sandboxHomedir: undefined,
        create,
      } as SandboxProvider;
    });
    afterEach(async () => {
      await warm?.close();
      await worktree?.close();
      warm = undefined;
      worktree = undefined;
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    });
    const invoke = async (surface: Surface, signal?: AbortSignal) => {
      const common = { agent, prompt: "fixture", signal };
      const logging = {
        type: "file" as const,
        path: log,
        onAgentStreamEvent: (event: unknown) => {
          streams.push(event);
        },
      };
      if (surface === "run")
        return run({
          ...common,
          sandbox,
          cwd: repo,
          maxIterations: 1,
          logging,
        });
      if (surface === "interactive")
        return interactive({ ...common, sandbox, cwd: repo });
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
            logging,
          });
        if (surface === "Worktree.interactive")
          return worktree.interactive({ ...common, sandbox });
        warm ??= await worktree.createSandbox({ sandbox });
      } else
        warm ??= await createSandbox({
          cwd: repo,
          sandbox,
          branch: "fixture-warm",
        });
      return surface.endsWith("interactive")
        ? warm.interactive(common)
        : warm.run({ ...common, maxIterations: 1, logging });
    };
    const hostUnchanged = async () => {
      expect(await readFile(join(host, "auth.json"), "utf8")).toBe(AUTH);
      expect((await stat(join(host, "auth.json"))).mode & 0o777).toBe(0o640);
      if (catalog) {
        expect(await readFile(join(host, "models-store.json"), "utf8")).toBe(
          CATALOG,
        );
        expect((await stat(join(host, "models-store.json"))).mode & 0o777).toBe(
          0o640,
        );
      }
      expect((await readdir(host)).sort()).toEqual(
        catalog ? ["auth.json", "models-store.json"] : ["auth.json"],
      );
    };
    const noLeaks = async (error?: unknown) => {
      const artifactText = async (dir: string): Promise<string> => {
        const parts: string[] = [];
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          if (entry.name === ".git") continue;
          const path = join(dir, entry.name);
          if (entry.isDirectory()) parts.push(await artifactText(path));
          else if (entry.isFile()) parts.push(await readFile(path, "utf8"));
        }
        return parts.join("\n");
      };
      const output = [
        await artifactText(repo),
        ...(await Promise.all(
          handles.map(
            async (handle) =>
              await stat(handle.worktreePath).then(
                () => artifactText(handle.worktreePath),
                () => "",
              ),
          ),
        )),
        String(error ?? ""),
        JSON.stringify(error),
        JSON.stringify(streams),
        commands.join("\n"),
        await readFile(log, "utf8").catch(() => ""),
      ].join("\n");
      expect(output).not.toContain("matrix-synthetic-secret-only");
      expect(output).not.toContain("matrix-synthetic-model");
    };

    it.each(surfaces)(
      "%s resolves HOME, copies one way (or skips on host), and keeps logs secret-free",
      async (surface) => {
        const result = await invoke(surface);
        expect(events).toEqual(
          tag === "none" ? ["agent"] : ["copy", "copy", "agent"],
        );
        await hostUnchanged();
        await noLeaks(result);
        for (const handle of handles) {
          expect(handle.copyFileOut).not.toHaveBeenCalled();
          expect(handle.close).toHaveBeenCalledTimes(warm ? 0 : 1);
        }
      },
    );
    it.each(surfaces)(
      "%s keeps an explicit Pi directory override effective at agent launch",
      async (surface) => {
        target = tag === "none" ? host : join(root, "override '$literal");
        agent = pi("fixture", {
          captureSessions: false,
          credentials: { hostAgentDir: host, sandboxAgentDir: target },
        });
        await invoke(surface);
        await hostUnchanged();
        await noLeaks();
      },
    );
    it.each(surfaces)(
      "%s honors PiOptions.env directory override, including warm handles",
      async (surface) => {
        target = tag === "none" ? host : join(root, "env override");
        agent = pi("fixture", {
          captureSessions: false,
          env: { PI_CODING_AGENT_DIR: target },
          credentials: { hostAgentDir: host },
        });
        await invoke(surface);
        await hostUnchanged();
      },
    );
    it.each(surfaces)(
      "%s pre-abort does not copy or launch",
      async (surface) => {
        const ac = new AbortController();
        ac.abort("pre-abort");
        await expect(invoke(surface, ac.signal)).rejects.toBe("pre-abort");
        expect(events).toEqual([]);
        await hostUnchanged();
      },
    );
    it.each(surfaces)(
      "%s accepts an absent optional catalog",
      async (surface) => {
        catalog = false;
        await rm(join(host, "models-store.json"));
        await invoke(surface);
        expect(events).toEqual(tag === "none" ? ["agent"] : ["copy", "agent"]);
        await hostUnchanged();
      },
    );
    it.each(surfaces)(
      "%s skips non-opted-in agent providers",
      async (surface) => {
        agent = { ...agent, provisionCredentials: undefined };
        // Pre-existing auth is a provider responsibility when it does not opt in.
        if (tag !== "none") {
          await mkdir(target, { recursive: true, mode: 0o700 });
          await writeFile(join(target, "auth.json"), AUTH, { mode: 0o600 });
          await writeFile(join(target, "models-store.json"), CATALOG);
        }
        await invoke(surface);
        expect(events).toEqual(["agent"]);
        await hostUnchanged();
      },
    );
    if (tag === "none") {
      it.each(surfaces)(
        "%s never invokes the provisioning hook on the host",
        async (surface) => {
          const provision = vi.fn(async () => {
            throw new Error("Host provisioning must be skipped");
          });
          agent = { ...agent, provisionCredentials: provision };
          await invoke(surface);
          expect(provision).not.toHaveBeenCalled();
          expect(events).toEqual(["agent"]);
          await hostUnchanged();
        },
      );
    }
    if (tag !== "none") {
      it.each(surfaces)(
        "%s rejects a runtime credential directory inside the synced worktree before any secret copy",
        async (surface) => {
          destinationInsideWorktree = true;
          const error = await invoke(surface).then(
            () => {
              throw new Error("Expected unsafe destination failure");
            },
            (e) => e,
          );
          expect(String(error)).toContain("outside the sandbox worktree");
          expect(events).toEqual([]);
          await expect(stat(join(target, "auth.json"))).rejects.toMatchObject({
            code: "ENOENT",
          });
          await hostUnchanged();
          await noLeaks(error);
        },
      );
      it.each(surfaces)(
        "%s fails closed on missing copy capability and does not launch",
        async (surface) => {
          const create = sandbox.create;
          sandbox = {
            ...sandbox,
            create: async (options: never) => {
              const raw = await (
                create as (options: never) => Promise<RawHandle>
              )(options);
              return { ...raw, copyFileIn: undefined, copyIn: undefined };
            },
          } as unknown as SandboxProvider;
          // Isolated providers need copyIn for sync-in too; keep it until credentials start.
          if (tag === "isolated") {
            sandbox = {
              ...sandbox,
              create: async (options: never) => {
                const raw = await (
                  create as (options: never) => Promise<IsolatedSandboxHandle>
                )(options);
                const exec = raw.exec;
                raw.exec = async (command, opts) => {
                  const result = await exec(command, opts);
                  if (command === "git rev-parse HEAD")
                    raw.copyIn = undefined as never;
                  return result;
                };
                return raw;
              },
            } as SandboxProvider;
          }
          await expect(invoke(surface)).rejects.toThrow(
            /credentials require sandbox exec and host-to-sandbox file copy/,
          );
          expect(events).toEqual([]);
          await hostUnchanged();
        },
      );
      for (const step of ["prepare", "copy", "permission", "cleanup"] as const)
        it.each(surfaces)(
          `%s fails closed on ${step} failure without leaking provider output`,
          async (surface) => {
            failure = step;
            const error = await invoke(surface).then(
              () => {
                throw new Error("Expected provisioning failure");
              },
              (e) => e,
            );
            expect(String(error)).toContain("Pi credential");
            expect(events).not.toContain("agent");
            expect(handles.at(-1)!.close).toHaveBeenCalledTimes(warm ? 0 : 1);
            await noLeaks(error);
            await hostUnchanged();
            if (step !== "cleanup") {
              if (step !== "prepare") expect(await readdir(target)).toEqual([]);
              failure = undefined;
              events = [];
              await invoke(surface);
              expect(events).toEqual(["copy", "copy", "agent"]);
            } else expect(String(error)).toContain("Close the sandbox");
          },
        );
      it.each(surfaces)(
        "%s awaits copy cancellation and permits a clean retry",
        async (surface) => {
          abortOnCopy = new AbortController();
          await expect(invoke(surface, abortOnCopy.signal)).rejects.toBe(
            "fixture-cancel",
          );
          expect(events).not.toContain("agent");
          expect(await readdir(target)).toEqual([]);
          abortOnCopy = undefined;
          events = [];
          await invoke(surface);
          expect(events).toEqual(["copy", "copy", "agent"]);
          await hostUnchanged();
        },
      );
      it.each([
        "Sandbox.run",
        "Sandbox.interactive",
        "Worktree.Sandbox.run",
        "Worktree.Sandbox.interactive",
      ] as const)(
        "%s refreshes only from host on reuse and removes a stale catalog",
        async (surface) => {
          await invoke(surface);
          await writeFile(
            join(target, "auth.json"),
            "sandbox-refresh-not-authoritative",
          );
          await hostUnchanged();
          await rm(join(host, "models-store.json"));
          catalog = false;
          events = [];
          await invoke(surface);
          expect(handles).toHaveLength(1);
          expect(events).toEqual(["copy", "agent"]);
          await hostUnchanged();
        },
      );
    }
  },
);
