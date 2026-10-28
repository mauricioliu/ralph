import { posix } from "node:path";
import { CredentialProvisionError } from "./errors.js";

/**
 * Sandbox provider types — the pluggable interface for sandbox runtimes.
 *
 * Provider authors implement a small Promise-based interface. Ralph
 * handles worktree creation, git mount resolution, and commit extraction.
 */

/** Result of executing a command inside a sandbox. */
export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Options for interactiveExec — the streams the provider should wire to the spawned process. */
export interface InteractiveExecOptions {
  readonly stdin: NodeJS.ReadableStream;
  readonly stdout: NodeJS.WritableStream;
  readonly stderr: NodeJS.WritableStream;
  readonly cwd?: string;
  /** Per-process environment overrides (host execution); sandbox adapters use POSIX env argv. */
  readonly env?: Record<string, string>;
}

/** Handle to a running bind-mount sandbox. */
export interface BindMountSandboxHandle {
  /** Absolute path to the worktree inside the sandbox. */
  readonly worktreePath: string;
  /**
   * Execute a command in the sandbox.
   *
   * Implementations MUST support line-by-line streaming via `onLine`. This is
   * how Ralph delivers live feedback to the user and enforces idle timeouts —
   * without a streaming implementation, neither will work. A buffered/batch
   * implementation that only calls `onLine` after the process exits does NOT
   * satisfy this contract.
   *
   * When `stdin` is set, the implementation pipes the string to the child
   * process's stdin and closes it. This avoids the Linux 128 KB per-arg limit.
   */
  exec(
    command: string,
    options?: {
      onLine?: (line: string) => void;
      cwd?: string;
      sudo?: boolean;
      stdin?: string;
    },
  ): Promise<ExecResult>;
  /**
   * Launch an interactive process inside the sandbox.
   * Optional — providers that support interactive sessions implement this.
   * The provider detects TTY mode from the streams (e.g. stdin.isTTY) and
   * allocates a pseudo-terminal accordingly.
   */
  interactiveExec?(
    args: string[],
    options: InteractiveExecOptions,
  ): Promise<{ exitCode: number }>;
  /** Copy a single file from the host into the sandbox. */
  copyFileIn(hostPath: string, sandboxPath: string): Promise<void>;
  /** Copy a single file from the sandbox to the host. */
  copyFileOut(sandboxPath: string, hostPath: string): Promise<void>;
  /** Tear down the sandbox. */
  close(): Promise<void>;
}

/** Options passed to a bind-mount provider's `create` function. */
export interface BindMountCreateOptions {
  /** Host-side path to the worktree directory. */
  readonly worktreePath: string;
  /** Host-side path to the original repo root. */
  readonly hostRepoPath: string;
  /** Volume mounts to apply (host:sandbox pairs). */
  readonly mounts: Array<{
    hostPath: string;
    sandboxPath: string;
    readonly?: boolean;
  }>;
  /** Environment variables to inject into the sandbox. */
  readonly env: Record<string, string>;
}

/** Configuration for createBindMountSandboxProvider. */
export interface BindMountSandboxProviderConfig {
  /** Human-readable name for this provider (e.g. "docker", "podman"). */
  readonly name: string;
  /** Environment variables injected by this provider. Merged at launch time. */
  readonly env?: Record<string, string>;
  /**
   * Absolute path to the home directory inside the sandbox (e.g. `"/home/agent"`).
   * Used to expand `~` in user-provided `sandboxPath` mount configs.
   * Set to `undefined` for providers that do not have a fixed home directory.
   */
  readonly sandboxHomedir?: string;
  /** Create a sandbox handle from the given options. */
  readonly create: (
    options: BindMountCreateOptions,
  ) => Promise<BindMountSandboxHandle>;
}

/** Handle to a running isolated sandbox (extends bind-mount with file transfer). */
export interface IsolatedSandboxHandle {
  /** Absolute path to the worktree inside the sandbox. */
  readonly worktreePath: string;
  /**
   * Execute a command in the sandbox.
   *
   * Implementations MUST support line-by-line streaming via `onLine`. This is
   * how Ralph delivers live feedback to the user and enforces idle timeouts —
   * without a streaming implementation, neither will work. A buffered/batch
   * implementation that only calls `onLine` after the process exits does NOT
   * satisfy this contract.
   *
   * When `stdin` is set, the implementation pipes the string to the child
   * process's stdin and closes it. This avoids the Linux 128 KB per-arg limit.
   */
  exec(
    command: string,
    options?: {
      onLine?: (line: string) => void;
      cwd?: string;
      sudo?: boolean;
      stdin?: string;
    },
  ): Promise<ExecResult>;
  /**
   * Launch an interactive process inside the sandbox.
   * Optional — providers that support interactive sessions implement this.
   * The provider detects TTY mode from the streams (e.g. stdin.isTTY) and
   * allocates a pseudo-terminal accordingly.
   */
  interactiveExec?(
    args: string[],
    options: InteractiveExecOptions,
  ): Promise<{ exitCode: number }>;
  /** Copy a file or directory from the host into the sandbox. */
  copyIn(hostPath: string, sandboxPath: string): Promise<void>;
  /** Copy a single file from the sandbox to the host. */
  copyFileOut(sandboxPath: string, hostPath: string): Promise<void>;
  /** Tear down the sandbox. */
  close(): Promise<void>;
}

/** Options passed to an isolated provider's `create` function. */
export interface IsolatedCreateOptions {
  /** Environment variables to inject into the sandbox. */
  readonly env: Record<string, string>;
}

/** Configuration for createIsolatedSandboxProvider. */
export interface IsolatedSandboxProviderConfig {
  /** Human-readable name for this provider (e.g. "daytona", "e2b"). */
  readonly name: string;
  /** Environment variables injected by this provider. Merged at launch time. */
  readonly env?: Record<string, string>;
  /** Create an isolated sandbox handle from the given options. */
  readonly create: (
    options: IsolatedCreateOptions,
  ) => Promise<IsolatedSandboxHandle>;
}

/** A bind-mount sandbox provider. */
export interface BindMountSandboxProvider {
  /** @internal Discriminator for internal dispatch. */
  readonly tag: "bind-mount";
  /** Human-readable provider name. */
  readonly name: string;
  /** Environment variables injected by this provider. */
  readonly env: Record<string, string>;
  /**
   * Absolute path to the home directory inside the sandbox (e.g. `"/home/agent"`).
   * `undefined` when the provider does not declare a sandbox home directory.
   */
  readonly sandboxHomedir: string | undefined;
  /** @internal Create a sandbox handle. */
  readonly create: (
    options: BindMountCreateOptions,
  ) => Promise<BindMountSandboxHandle>;
}

/** An isolated sandbox provider. */
export interface IsolatedSandboxProvider {
  /** @internal Discriminator for internal dispatch. */
  readonly tag: "isolated";
  /** Human-readable provider name. */
  readonly name: string;
  /** Environment variables injected by this provider. */
  readonly env: Record<string, string>;
  /** @internal Create an isolated sandbox handle. */
  readonly create: (
    options: IsolatedCreateOptions,
  ) => Promise<IsolatedSandboxHandle>;
}

/** Handle to a no-sandbox session — runs commands directly on the host. */
export interface NoSandboxHandle {
  /** Absolute path to the worktree on the host. */
  readonly worktreePath: string;
  /**
   * Execute a command on the host. `env` overrides apply to this process only.
   *
   * Implementations MUST support line-by-line streaming via `onLine`. This is
   * how Ralph delivers live feedback to the user and enforces idle timeouts —
   * without a streaming implementation, neither will work.
   *
   * When `stdin` is set, the implementation pipes the string to the child
   * process's stdin and closes it. This avoids the Linux 128 KB per-arg limit.
   */
  exec(
    command: string,
    options?: {
      onLine?: (line: string) => void;
      cwd?: string;
      sudo?: boolean;
      stdin?: string;
      env?: Record<string, string>;
    },
  ): Promise<ExecResult>;
  /**
   * Launch an interactive process on the host with inherited stdio.
   */
  interactiveExec(
    args: string[],
    options: InteractiveExecOptions,
  ): Promise<{ exitCode: number }>;
  /** No-op — no container to tear down. */
  close(): Promise<void>;
}

/** A no-sandbox provider — runs the agent directly on the host with no container isolation. */
export interface NoSandboxProvider {
  /** @internal Discriminator for internal dispatch. */
  readonly tag: "none";
  /** Human-readable provider name. */
  readonly name: string;
  /** Environment variables injected by this provider. */
  readonly env: Record<string, string>;
  /** @internal Create a no-sandbox handle. */
  readonly create: (options: {
    readonly worktreePath: string;
    readonly env: Record<string, string>;
  }) => Promise<NoSandboxHandle>;
}

/**
 * Minimal, one-way capability for agent credential provisioning.
 * Deliberately separate from session capture/resume (no sandbox→host copy).
 */
export interface CredentialSandboxHandle {
  /** Use the same user and HOME as agent execution; sudo is only for explicit repair. */
  exec: BindMountSandboxHandle["exec"];
  /** Verify a physical directory is outside the worktree, with no symlink ancestors, before any writes or mode changes. */
  validateDirectory(sandboxPath: string): Promise<void>;
  /** Resolve only after the one-way file copy has settled, including on failure. */
  copyFile(hostPath: string, sandboxPath: string): Promise<void>;
}

/** Normalize provider-family copy methods without exposing reverse copy. */
export const toCredentialHandle = (
  handle: BindMountSandboxHandle | IsolatedSandboxHandle | NoSandboxHandle,
): CredentialSandboxHandle | undefined => {
  if (typeof handle.exec !== "function") return undefined;
  const checkDestination = (sandboxPath: string): void => {
    const relative = posix.relative(handle.worktreePath, sandboxPath);
    if (
      relative === "" ||
      (!relative.startsWith("../") &&
        relative !== ".." &&
        !posix.isAbsolute(relative))
    ) {
      throw new CredentialProvisionError({
        message:
          "Credential destination must be outside the sandbox worktree to avoid syncing secrets into host artifacts. Set credentials.sandboxAgentDir outside the worktree.",
      });
    }
  };
  const validateDirectory = async (sandboxPath: string): Promise<void> => {
    checkDestination(sandboxPath);
    const quote = (s: string): string => "'" + s.replace(/'/g, "'\\''") + "'";
    try {
      if (!posix.isAbsolute(sandboxPath) || /[\r\n\0]/.test(sandboxPath))
        throw new Error("invalid path");
      // No writes here. Walk even missing ancestors, rejecting symlinks and
      // inaccessible existing directories. realpath must be available and succeed.
      const result = await handle.exec(`set -e
p=${quote(posix.resolve(sandboxPath))}
while :; do
  test ! -L "$p"
  if test -e "$p"; then
    test -d "$p"
    test -x "$p"
  fi
  test "$p" != / || break
  p=$(dirname -- "$p")
done
worktree=$(realpath -e -- ${quote(handle.worktreePath)})
test -d "$worktree"
destination=$(realpath -m -- ${quote(sandboxPath)})
case "$destination" in "$worktree"|"$worktree"/*) exit 1;; esac`);
      if (result.exitCode === 0) return;
    } catch {
      /* Transport output is deliberately discarded. */
    }
    throw new CredentialProvisionError({
      message:
        "Cannot verify credential directory outside the physical sandbox worktree without symlink ancestors. Check realpath/directory access or set credentials.sandboxAgentDir outside the worktree.",
    });
  };
  if ("copyFileIn" in handle && typeof handle.copyFileIn === "function") {
    return {
      exec: (command, options) => handle.exec(command, options),
      validateDirectory,
      copyFile: async (hostPath, sandboxPath) => {
        checkDestination(sandboxPath);
        await validateDirectory(posix.dirname(sandboxPath));
        await handle.copyFileIn(hostPath, sandboxPath);
      },
    };
  }
  if ("copyIn" in handle && typeof handle.copyIn === "function") {
    return {
      exec: (command, options) => handle.exec(command, options),
      validateDirectory,
      copyFile: async (hostPath, sandboxPath) => {
        checkDestination(sandboxPath);
        await validateDirectory(posix.dirname(sandboxPath));
        await handle.copyIn(hostPath, sandboxPath);
      },
    };
  }
  return undefined;
};

// ---------- Branch strategy types ----------

/** Head strategy: agent writes directly to host working directory. Bind-mount only. */
export interface HeadBranchStrategy {
  readonly type: "head";
}

/** Merge-to-head strategy: temp branch, merge back to HEAD, delete temp branch. */
export interface MergeToHeadBranchStrategy {
  readonly type: "merge-to-head";
}

/** Branch strategy: commits land on an explicit named branch. */
export interface NamedBranchStrategy {
  readonly type: "branch";
  readonly branch: string;
  /**
   * Git ref to use as the starting point when creating a new branch.
   * Only used when the branch doesn't already exist — ignored otherwise.
   * Callers are responsible for ensuring the ref is current (e.g. `git fetch`).
   * Defaults to `HEAD` when omitted.
   */
  readonly baseBranch?: string;
}

/** Branch strategy for bind-mount providers (all three variants). */
export type BindMountBranchStrategy =
  | HeadBranchStrategy
  | MergeToHeadBranchStrategy
  | NamedBranchStrategy;

/** Branch strategy for isolated providers (no head — can't write to host). */
export type IsolatedBranchStrategy =
  | MergeToHeadBranchStrategy
  | NamedBranchStrategy;

/** Branch strategy for no-sandbox providers (all three — same as bind-mount). */
export type NoSandboxBranchStrategy =
  | HeadBranchStrategy
  | MergeToHeadBranchStrategy
  | NamedBranchStrategy;

/** Union of all branch strategy variants. */
export type BranchStrategy =
  | BindMountBranchStrategy
  | IsolatedBranchStrategy
  | NoSandboxBranchStrategy;

/**
 * A sandbox provider — the pluggable unit that `run()`, `interactive()`, and
 * `createSandbox()` accept. Tagged for internal dispatch: "bind-mount",
 * "isolated", or "none". When `NoSandboxProvider` is used, the agent runs
 * directly on the host with no container isolation — opt in at your own risk.
 */
export type SandboxProvider =
  | BindMountSandboxProvider
  | IsolatedSandboxProvider
  | NoSandboxProvider;

/** @deprecated Use `SandboxProvider` — it now includes `NoSandboxProvider`. */
export type AnySandboxProvider = SandboxProvider;

/**
 * Create a bind-mount sandbox provider from a config object.
 * The returned provider can be passed to `run()` or `createSandbox()`.
 */
export const createBindMountSandboxProvider = (
  config: BindMountSandboxProviderConfig,
): BindMountSandboxProvider => ({
  tag: "bind-mount",
  name: config.name,
  env: config.env ?? {},
  sandboxHomedir: config.sandboxHomedir,
  create: config.create,
});

/**
 * Create an isolated sandbox provider from a config object.
 * The returned provider can be passed to `run()` or `createSandbox()`.
 */
export const createIsolatedSandboxProvider = (
  config: IsolatedSandboxProviderConfig,
): IsolatedSandboxProvider => ({
  tag: "isolated",
  name: config.name,
  env: config.env ?? {},
  create: config.create,
});
