import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pi } from "./AgentProvider.js";
import {
  toCredentialHandle,
  type CredentialSandboxHandle,
} from "./SandboxProvider.js";

const exec = promisify(execFile);
const AUTH = '{"synthetic":{"type":"oauth","access":"fixture-only-token"}}';
const CATALOG = '{"models":[{"id":"synthetic-model"}]}';

describe("Pi one-way credentials (synthetic files, local shell only)", () => {
  let root: string;
  let host: string;
  let home: string;
  let dest: string;
  let handle: CredentialSandboxHandle;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ralph-credentials-"));
    host = join(root, "host");
    home = join(root, "sandbox home '$literal");
    dest = join(home, ".pi", "agent");
    await mkdir(host);
    await mkdir(home);
    await mkdir(join(root, "worktree"));
    await writeFile(join(host, "auth.json"), AUTH, { mode: 0o644 });
    const guard = toCredentialHandle({
      worktreePath: join(root, "worktree"),
      exec: (command, options) => handle.exec(command, options),
      copyIn: copyFile,
      copyFileOut: async () => {},
      close: async () => {},
    })!;
    handle = {
      validateDirectory: guard.validateDirectory,
      exec: vi.fn(async (command) => {
        try {
          const result = await exec("sh", ["-c", command], {
            // The host directory override is not inherited by an isolated runtime.
            env: { ...process.env, PI_CODING_AGENT_DIR: "", HOME: home },
          });
          return { ...result, exitCode: 0 };
        } catch (error) {
          const e = error as { stdout: string; stderr: string; code: number };
          return { stdout: e.stdout, stderr: e.stderr, exitCode: e.code };
        }
      }),
      copyFile: vi.fn(copyFile),
    };
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });
  const provision = (override?: string, signal?: AbortSignal) =>
    pi("synthetic", {
      credentials: { hostAgentDir: host, sandboxAgentDir: override },
    }).provisionCredentials!({ handle, signal });
  const expectPrivate = async (path: string, mode: number) =>
    expect((await stat(path)).mode & 0o777).toBe(mode);
  const expectClean = async () =>
    expect(
      (await readdir(dest)).filter((name) =>
        name.startsWith(".ralph-credentials-"),
      ),
    ).toEqual([]);

  it("discovers sandbox HOME, copies auth and optional catalog, and verifies restrictive permissions", async () => {
    await writeFile(join(host, "models-store.json"), CATALOG);
    await provision();
    expect(await readFile(join(dest, "auth.json"), "utf8")).toBe(AUTH);
    expect(await readFile(join(dest, "models-store.json"), "utf8")).toBe(
      CATALOG,
    );
    await expectPrivate(dest, 0o700);
    await expectPrivate(join(dest, "auth.json"), 0o600);
    await expectPrivate(join(dest, "models-store.json"), 0o600);
    await expectPrivate(join(host, "auth.json"), 0o644);
    await expectClean();
    const calls = vi
      .mocked(handle.exec)
      .mock.calls.map(([command]) => command)
      .join("\n");
    expect(calls).not.toContain("fixture-only-token");
  });

  it("allows directory overrides and makes Pi use the sandbox override", async () => {
    const override = join(root, "nonstandard '$agent");
    const provider = pi("synthetic", {
      env: { OTHER: "kept" },
      credentials: { hostAgentDir: host, sandboxAgentDir: override },
    });
    await provider.provisionCredentials!({ handle });
    expect(await readFile(join(override, "auth.json"), "utf8")).toBe(AUTH);
    expect(provider.env).toEqual({
      OTHER: "kept",
      PI_CODING_AGENT_DIR: override,
    });
    expect(vi.mocked(handle.exec).mock.calls[0]![0]).not.toContain("$HOME");
  });

  it("honors host and provider PI_CODING_AGENT_DIR overrides using synthetic paths", async () => {
    vi.stubEnv("PI_CODING_AGENT_DIR", host);
    const override = join(root, "env-agent");
    await pi("synthetic", { env: { PI_CODING_AGENT_DIR: override } })
      .provisionCredentials!({ handle });
    expect(await readFile(join(override, "auth.json"), "utf8")).toBe(AUTH);
  });

  it("resolves the default host directory at provisioning time, not factory time", async () => {
    vi.stubEnv("PI_CODING_AGENT_DIR", host);
    const provider = pi("synthetic");
    await provider.provisionCredentials!({ handle });
    expect(await readFile(join(dest, "auth.json"), "utf8")).toBe(AUTH);
  });

  it("uses HOME/.pi/agent when no host override exists", async () => {
    const fixtureHome = join(root, "fixture-home");
    await mkdir(join(fixtureHome, ".pi", "agent"), { recursive: true });
    await copyFile(
      join(host, "auth.json"),
      join(fixtureHome, ".pi", "agent", "auth.json"),
    );
    vi.stubEnv("HOME", fixtureHome);
    vi.stubEnv("PI_CODING_AGENT_DIR", undefined);
    await pi("synthetic").provisionCredentials!({ handle });
    expect(await readFile(join(dest, "auth.json"), "utf8")).toBe(AUTH);
  });

  it("rejects an empty sandbox HOME rather than writing under the filesystem root", async () => {
    home = "";
    await expect(provision()).rejects.toMatchObject({
      _tag: "CredentialProvisionError",
    });
    expect(handle.copyFile).not.toHaveBeenCalled();
  });

  it("requires readable host auth before any sandbox operation", async () => {
    await rm(join(host, "auth.json"));
    await expect(provision()).rejects.toMatchObject({
      _tag: "CredentialProvisionError",
      hostPath: join(host, "auth.json"),
      message: expect.stringContaining("Authenticate"),
    });
    expect(handle.exec).not.toHaveBeenCalled();
    expect(handle.copyFile).not.toHaveBeenCalled();
  });

  it("does not treat a malformed catalog source as absent", async () => {
    await mkdir(join(host, "models-store.json"));
    await expect(provision()).rejects.toMatchObject({
      _tag: "CredentialProvisionError",
      message: expect.stringContaining("models-store.json"),
    });
    expect(handle.copyFile).not.toHaveBeenCalled();
  });

  it.each(["relative", "", "/", "/tmp/unsafe\npath"])(
    "rejects invalid destination %j",
    async (path) => {
      await expect(provision(path)).rejects.toMatchObject({
        _tag: "CredentialProvisionError",
      });
      expect(handle.copyFile).not.toHaveBeenCalled();
    },
  );

  it.each([
    { stdout: "fixture-only-token", exitCode: 1 },
    { stdout: "relative", exitCode: 0 },
    { stdout: "", exitCode: 0 },
  ])(
    "rejects failed or invalid HOME discovery without including stdout",
    async (result) => {
      handle.exec = vi.fn(async () => ({
        ...result,
        stderr: "fixture-only-token",
      }));
      await expect(provision()).rejects.toMatchObject({
        _tag: "CredentialProvisionError",
        message: expect.not.stringContaining("fixture-only-token"),
      });
      expect(handle.copyFile).not.toHaveBeenCalled();
    },
  );

  it.each(["mkdir -p", "chmod 600", "mv -f"])(
    "checks nonzero %s results, redacts output and cleans staging",
    async (failCommand) => {
      const real = handle.exec;
      handle.exec = vi.fn(async (command, options) =>
        command.includes(failCommand)
          ? { exitCode: 1, stdout: AUTH, stderr: AUTH }
          : real(command, options),
      );
      await expect(provision()).rejects.toMatchObject({
        _tag: "CredentialProvisionError",
        message: expect.not.stringContaining("fixture-only-token"),
      });
      if (failCommand !== "mkdir -p") await expectClean();
    },
  );

  it("verifies copied files exist even when a copy falsely reports success", async () => {
    handle.copyFile = vi.fn(async () => {});
    await expect(provision()).rejects.toMatchObject({
      _tag: "CredentialProvisionError",
      message: expect.stringContaining("permissions"),
    });
    await expectClean();
  });

  it("repairs cp-created ownership via sudo without relaxing modes", async () => {
    const real = handle.exec;
    handle.exec = vi.fn(async (command, options) => {
      if (command.startsWith("test -O"))
        return { exitCode: 1, stdout: "", stderr: "" };
      if (command.startsWith('printf "%s:%s"'))
        return { exitCode: 0, stdout: "1234:5678", stderr: "" };
      if (command.startsWith("chown")) {
        expect(options).toEqual({ sudo: true });
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      return real(command, options);
    });
    await provision();
    expect(handle.exec).toHaveBeenCalledWith(
      expect.stringContaining("chown '1234:5678'"),
      { sudo: true },
    );
    await expectPrivate(join(dest, "auth.json"), 0o600);
  });

  it("fails safely when ownership repair is unavailable", async () => {
    const real = handle.exec;
    handle.exec = vi.fn(async (command, options) => {
      if (command.startsWith("test -O"))
        return { exitCode: 1, stdout: "", stderr: "" };
      if (command.startsWith('printf "%s:%s"'))
        return { exitCode: 0, stdout: "1234:5678", stderr: "" };
      if (options?.sudo) throw new Error(AUTH);
      return real(command, options);
    });
    await expect(provision()).rejects.toMatchObject({
      _tag: "CredentialProvisionError",
      message: expect.not.stringContaining("fixture-only-token"),
    });
    await expectClean();
  });

  it("does not launch successfully if cleanup fails", async () => {
    const real = handle.exec;
    handle.exec = vi.fn(async (command, options) =>
      command.startsWith("rm -rf")
        ? { exitCode: 1, stdout: AUTH, stderr: AUTH }
        : real(command, options),
    );
    await expect(provision()).rejects.toMatchObject({
      _tag: "CredentialProvisionError",
      message: expect.stringContaining("Close the sandbox"),
    });
  });

  it("cleans partial copies on failure without exposing copy exception contents", async () => {
    await writeFile(join(host, "models-store.json"), CATALOG);
    handle.copyFile = vi.fn(async (source, target) => {
      await copyFile(source, target);
      if (source.endsWith("models-store.json")) throw new Error(AUTH);
    });
    await expect(provision()).rejects.toMatchObject({
      _tag: "CredentialProvisionError",
      message: expect.not.stringContaining("fixture-only-token"),
    });
    await expectClean();
    await expect(readFile(join(dest, "auth.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(join(host, "auth.json"), "utf8")).toBe(AUTH);
  });

  it("rejects a symlink agent directory without changing its target", async () => {
    await mkdir(join(home, ".pi"));
    await symlink(host, dest);
    await expect(provision(`${dest}/`)).rejects.toMatchObject({
      _tag: "CredentialProvisionError",
    });
    expect(await readFile(join(host, "auth.json"), "utf8")).toBe(AUTH);
    await expectPrivate(join(host, "auth.json"), 0o644);
  });

  it.each(["bind-mount", "isolated"] as const)(
    "rejects %s ancestor aliases before copying or changing repository modes",
    async (family) => {
      const workspace = join(root, "worktree '$literal");
      await mkdir(workspace, { mode: 0o755 });
      const alias = join(home, ".pi");
      await symlink(workspace, alias);
      const raw = {
        worktreePath: workspace,
        exec: handle.exec,
        copyFileOut: async () => {},
        close: async () => {},
        ...(family === "bind-mount"
          ? { copyFileIn: handle.copyFile }
          : { copyIn: handle.copyFile }),
      };
      handle = toCredentialHandle(
        raw as import("./SandboxProvider.js").IsolatedSandboxHandle,
      )!;
      await expect(provision()).rejects.toMatchObject({
        _tag: "CredentialProvisionError",
      });
      expect(await readdir(workspace)).toEqual([]);
      await expectPrivate(workspace, 0o755);
    },
  );

  it.each(["bind-mount", "isolated"] as const)(
    "compares physical worktree paths for %s even when the worktree itself is aliased",
    async (family) => {
      const workspace = join(root, "actual worktree");
      const alias = join(root, "worktree alias");
      await mkdir(workspace, { mode: 0o755 });
      await symlink(workspace, alias);
      const raw = {
        worktreePath: alias,
        exec: handle.exec,
        copyFileOut: async () => {},
        close: async () => {},
        ...(family === "bind-mount"
          ? { copyFileIn: handle.copyFile }
          : { copyIn: handle.copyFile }),
      };
      handle = toCredentialHandle(
        raw as import("./SandboxProvider.js").IsolatedSandboxHandle,
      )!;
      await expect(provision(workspace)).rejects.toMatchObject({
        _tag: "CredentialProvisionError",
      });
      await expectPrivate(workspace, 0o755);
      expect(await readdir(workspace)).toEqual([]);
    },
  );

  it("fails closed when the physical worktree cannot be verified", async () => {
    handle = toCredentialHandle({
      worktreePath: join(root, "missing worktree"),
      exec: handle.exec,
      copyIn: handle.copyFile,
      copyFileOut: async () => {},
      close: async () => {},
    })!;
    await expect(provision()).rejects.toMatchObject({
      _tag: "CredentialProvisionError",
    });
    expect(await readdir(home)).toEqual([]);
  });

  it("replaces a destination file symlink, never writes through it", async () => {
    await mkdir(dest, { recursive: true });
    const other = join(root, "other-file");
    await writeFile(other, "unchanged");
    await symlink(other, join(dest, "auth.json"));
    await provision();
    expect(await readFile(other, "utf8")).toBe("unchanged");
    expect(await readFile(join(dest, "auth.json"), "utf8")).toBe(AUTH);
  });

  it("never overwrites host tokens; re-provisions fresh host files on reuse and removes stale catalog", async () => {
    await writeFile(join(host, "models-store.json"), CATALOG);
    await provision();
    await writeFile(join(dest, "auth.json"), "sandbox-refresh-only");
    expect(await readFile(join(host, "auth.json"), "utf8")).toBe(AUTH);
    await writeFile(join(host, "auth.json"), "synthetic-new-host-token");
    await rm(join(host, "models-store.json"));
    await provision();
    expect(await readFile(join(dest, "auth.json"), "utf8")).toBe(
      "synthetic-new-host-token",
    );
    await expect(
      readFile(join(dest, "models-store.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expectClean();
  });

  it("pre-abort performs no I/O", async () => {
    const ac = new AbortController();
    ac.abort("fixture-stop");
    await expect(provision(undefined, ac.signal)).rejects.toBe("fixture-stop");
    expect(handle.exec).not.toHaveBeenCalled();
    expect(handle.copyFile).not.toHaveBeenCalled();
  });

  it("awaits in-flight copy on abort, cleans staging, and permits subsequent reuse", async () => {
    const ac = new AbortController();
    let copied!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      copied = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    handle.copyFile = vi.fn(async (source, target) => {
      copied();
      await pending;
      await copyFile(source, target);
    });
    let settled = false;
    const run = provision(undefined, ac.signal).finally(() => {
      settled = true;
    });
    await started;
    ac.abort("fixture-stop");
    expect(settled).toBe(false);
    release();
    await expect(run).rejects.toBe("fixture-stop");
    await expectClean();
    handle.copyFile = vi.fn(copyFile);
    await provision();
    expect(await readFile(join(dest, "auth.json"), "utf8")).toBe(AUTH);
  });
});
