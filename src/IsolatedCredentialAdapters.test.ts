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
import { Effect } from "effect";
import { syncIn } from "./syncIn.js";
import { pi } from "./AgentProvider.js";
import { provisionAgentCredentials } from "./CredentialProvision.js";
import {
  toCredentialHandle,
  type IsolatedSandboxHandle,
} from "./SandboxProvider.js";
import { daytona } from "./sandboxes/daytona.js";
import { vercel } from "./sandboxes/vercel.js";

const sdk = vi.hoisted(() => ({
  vercelCreate: vi.fn(),
  daytonaCreate: vi.fn(),
  daytonaDelete: vi.fn(),
}));
vi.mock("@vercel/sandbox", () => ({ Sandbox: { create: sdk.vercelCreate } }));
vi.mock("@daytona/sdk", () => ({
  Daytona: class {
    create = sdk.daytonaCreate;
    delete = sdk.daytonaDelete;
  },
}));
const exec = promisify(execFile);
const AUTH = '{"fixture":{"access":"sdk-synthetic-secret-only"}}';

describe.each(["vercel", "daytona"] as const)(
  "%s native isolated credential adapter (SDK doubles, no service)",
  (name) => {
    let root: string;
    let host: string;
    let home: string;
    let workspace: string;
    let remoteEnv: Record<string, string>;
    let handle: IsolatedSandboxHandle | undefined;
    let uploads: string[];
    let sudo: boolean[];
    let failCopy: boolean;
    let nonOwner: boolean;
    let failChown: boolean;
    let remove: ReturnType<typeof vi.fn>;
    let download: ReturnType<typeof vi.fn>;
    beforeEach(async () => {
      vi.clearAllMocks();
      root = await mkdtemp(join(tmpdir(), "ralph-isolated-sdk-"));
      host = join(root, "host");
      home = join(root, "agent home '$literal");
      workspace = join(root, "workspace");
      for (const dir of [host, home, workspace]) await mkdir(dir);
      await writeFile(join(host, "auth.json"), AUTH, { mode: 0o640 });
      remoteEnv = {};
      uploads = [];
      sudo = [];
      failCopy = false;
      nonOwner = false;
      failChown = false;
      remove = vi.fn(async () => {});
      download = vi.fn();
      const command = async (
        cmd: string,
        privileged = false,
        cwd = workspace,
      ) => {
        sudo.push(privileged);
        // Simulate SDK upload ownership without requiring root on the host.
        if (nonOwner && cmd.startsWith("test -O"))
          return { stdout: "", stderr: "", exitCode: 1 };
        if (cmd.startsWith("chown ")) {
          expect(privileged).toBe(true);
          if (failChown) return { stdout: AUTH, stderr: AUTH, exitCode: 1 };
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        try {
          return {
            ...(await exec("sh", ["-c", cmd], {
              cwd,
              env: {
                ...process.env,
                PI_CODING_AGENT_DIR: "",
                HOME: home,
                ...remoteEnv,
              },
            })),
            exitCode: 0,
          };
        } catch (error) {
          const e = error as { stdout: string; stderr: string; code: number };
          return { stdout: e.stdout, stderr: e.stderr, exitCode: e.code };
        }
      };
      sdk.vercelCreate.mockImplementation(async (params) => {
        remoteEnv = params.env;
        return {
          mkDir: vi.fn(),
          runCommand: vi.fn(async (opts) => {
            expect(opts.cmd).toBe("sh");
            expect(opts.args[0]).toBe("-c");
            // Map the SDK's virtual filesystem root into this fixture only.
            const r = await command(
              opts.args[1].replaceAll("/vercel/sandbox/workspace", workspace),
              opts.sudo ?? false,
            );
            return {
              exitCode: r.exitCode,
              stdout: async () => r.stdout,
              stderr: async () => r.stderr,
            };
          }),
          writeFiles: vi.fn(async (files) => {
            if (failCopy) throw new Error(AUTH);
            for (const file of files) {
              uploads.push(file.path);
              await writeFile(file.path, file.content);
            }
          }),
          readFileToBuffer: download,
          stop: remove,
        };
      });
      sdk.daytonaCreate.mockImplementation(async (params) => {
        remoteEnv = params?.envVars ?? {};
        return {
          getWorkDir: async () => home,
          getUserHomeDir: async () => home,
          process: {
            executeCommand: vi.fn(async (cmd: string, cwd: string) => {
              // SDK cwd is not advisory: a fresh child must exist before exec.
              if (!(await stat(cwd)).isDirectory())
                throw new Error("ENOENT cwd");
              const privileged = cmd.startsWith("sudo ");
              const r = await command(
                privileged ? cmd.slice(5) : cmd,
                privileged,
                cwd,
              );
              return { result: r.stdout, exitCode: r.exitCode };
            }),
          },
          fs: {
            uploadFile: vi.fn(async (source, target) => {
              if (failCopy) throw new Error(AUTH);
              uploads.push(target);
              await copyFile(source, target);
            }),
            downloadFile: download,
          },
        };
      });
      sdk.daytonaDelete.mockImplementation(remove);
    });
    afterEach(async () => {
      await handle?.close();
      handle = undefined;
      await rm(root, { recursive: true, force: true });
    });
    const create = async (env: Record<string, string> = {}) => {
      const provider =
        name === "vercel"
          ? vercel()
          : daytona({
              create: {
                envVars: {
                  TEMPLATE_ENV: "kept",
                  PI_CODING_AGENT_DIR: "template-value",
                },
              },
            });
      handle = await provider.create({ env });
      return handle;
    };
    const provision = async (env: Record<string, string> = {}) => {
      handle ??= await create(env);
      await provisionAgentCredentials({
        provider: pi("fixture", {
          captureSessions: false,
          credentials: { hostAgentDir: host },
        }),
        sandboxTag: "isolated",
        credentialHandle: toCredentialHandle(handle),
      });
    };
    it.each([false, true])(
      "deletes a Daytona sandbox after initialization failure (delete fails: %s) without raw SDK output",
      async (deleteFails) => {
        if (name !== "daytona") return;
        sdk.daytonaCreate.mockResolvedValue({
          getWorkDir: async () => home,
          process: {
            executeCommand: async () => {
              throw new Error(AUTH);
            },
          },
        });
        if (deleteFails) sdk.daytonaDelete.mockRejectedValue(new Error(AUTH));
        await expect(create()).rejects.toMatchObject({
          _tag: "ExecError",
          message: deleteFails
            ? expect.stringContaining("remove it before retrying")
            : expect.stringContaining("sandbox deleted"),
        });
        expect(sdk.daytonaDelete).toHaveBeenCalledOnce();
      },
    );
    it("bootstraps a fresh Daytona worktree through syncIn before credentials", async () => {
      if (name !== "daytona") return;
      home = join(root, "fresh-home");
      await mkdir(home);
      await exec("git", ["init", "-b", "main", host]);
      await exec("git", ["-C", host, "add", "auth.json"]);
      await exec("git", [
        "-C",
        host,
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "-m",
        "synthetic",
      ]);
      const created = await create({ PI_CODING_AGENT_DIR: "" });
      await Effect.runPromise(syncIn(host, created));
      expect(
        (await created.exec("git rev-parse --abbrev-ref HEAD")).stdout.trim(),
      ).toBe("main");
      await provision();
      expect(await readdir(created.worktreePath)).not.toContain(".pi");
    });
    it("discovers the normal exec user's HOME, uploads only auth, verifies modes and never downloads", async () => {
      // Do not let a template override mask the runtime HOME test.
      if (name === "daytona") await create({ PI_CODING_AGENT_DIR: "" });
      await provision();
      const dir = join(home, ".pi", "agent");
      if (name === "daytona")
        expect(handle!.worktreePath).toBe(join(home, "ralph-workspace"));
      expect(await readFile(join(dir, "auth.json"), "utf8")).toBe(AUTH);
      expect((await stat(dir)).mode & 0o777).toBe(0o700);
      expect((await stat(join(dir, "auth.json"))).mode & 0o777).toBe(0o600);
      expect(uploads).toHaveLength(1);
      expect(download).not.toHaveBeenCalled();
      expect(sudo).not.toContain(true);
      expect(await readdir(dir)).toEqual(["auth.json"]);
      expect((await stat(join(host, "auth.json"))).mode & 0o777).toBe(0o640);
      await handle!.close();
      handle = undefined;
      expect(remove).toHaveBeenCalledOnce();
    });
    it("preserves launch env and uses its Pi destination rather than a hardcoded HOME", async () => {
      const dir = join(root, "runtime override");
      await create({ PI_CODING_AGENT_DIR: dir, LAUNCH_ENV: "kept" });
      expect(remoteEnv).toMatchObject({
        PI_CODING_AGENT_DIR: dir,
        LAUNCH_ENV: "kept",
      });
      if (name === "daytona") expect(remoteEnv.TEMPLATE_ENV).toBe("kept");
      await provision();
      expect(await readFile(join(dir, "auth.json"), "utf8")).toBe(AUTH);
    });
    it("maps ownership repair to sudo, leaving HOME and identity discovery unprivileged", async () => {
      await create({ PI_CODING_AGENT_DIR: "" });
      nonOwner = true;
      await provision();
      expect(sudo.filter(Boolean)).toHaveLength(1);
    });
    it.each(["upload", "ownership"] as const)(
      "sanitizes %s failure and cleans staging on the same reusable handle",
      async (failure) => {
        await create({ PI_CODING_AGENT_DIR: "" });
        failCopy = failure === "upload";
        nonOwner = failure === "ownership";
        failChown = nonOwner;
        const error = await provision().then(
          () => {
            throw new Error("Expected failure");
          },
          (e) => e,
        );
        expect(error._tag).toBe("CredentialProvisionError");
        expect(String(error) + JSON.stringify(error)).not.toContain(
          "sdk-synthetic-secret-only",
        );
        expect(await readdir(join(home, ".pi", "agent"))).toEqual([]);
        failCopy = false;
        failChown = false;
        nonOwner = false;
        await provision();
        expect(download).not.toHaveBeenCalled();
        expect(await readFile(join(host, "auth.json"), "utf8")).toBe(AUTH);
      },
    );
  },
);
