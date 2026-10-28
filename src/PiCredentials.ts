import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join, posix } from "node:path";
import { randomUUID } from "node:crypto";
import { CredentialProvisionError } from "./errors.js";
import type { CredentialSandboxHandle } from "./SandboxProvider.js";

export interface PiCredentialOptions {
  readonly hostAgentDir?: string;
  readonly sandboxAgentDir?: string;
}

const quote = (s: string): string => "'" + s.replace(/'/g, "'\\''") + "'";
const modeIs = (path: string, mode: string): string =>
  `test "$(stat -c %a -- ${quote(path)})" = ${mode}`;

/**
 * Copy host-owned Pi auth and optional catalog into a private staging directory.
 * No host writes and no sandbox→host capability. Await in-flight copies on abort
 * so a reusable sandbox cannot race with a later provisioning attempt.
 */
export const makePiCredentialProvisioner =
  (options?: PiCredentialOptions) =>
  async ({
    handle,
    signal,
  }: {
    readonly handle: CredentialSandboxHandle;
    readonly signal?: AbortSignal;
  }): Promise<void> => {
    const hostDir =
      options?.hostAgentDir ??
      process.env.PI_CODING_AGENT_DIR ??
      join(homedir(), ".pi", "agent");
    const hostAuth = join(hostDir, "auth.json");
    let step = "read host auth.json";
    let staging: string | undefined;
    let installedDir: string | undefined;
    let succeeded = false;
    const checkedExec = async (
      command: string,
      sudo = false,
    ): Promise<void> => {
      signal?.throwIfAborted();
      const result = await handle.exec(
        command,
        sudo ? { sudo: true } : undefined,
      );
      signal?.throwIfAborted();
      if (result.exitCode !== 0) throw new Error("credential command failed");
    };
    try {
      signal?.throwIfAborted();
      try {
        await access(hostAuth, constants.R_OK);
        if (!(await stat(hostAuth)).isFile()) throw new Error("not a file");
      } catch {
        throw new CredentialProvisionError({
          message:
            "Pi auth.json is missing or unreadable on the host. Authenticate with pi on the host, or set PiOptions.credentials.hostAgentDir.",
          hostPath: hostAuth,
        });
      }
      const files = ["auth.json"];
      step = "read host models-store.json";
      try {
        const catalog = join(hostDir, "models-store.json");
        if (!(await stat(catalog)).isFile()) throw new Error("not a file");
        await access(catalog, constants.R_OK);
        files.push("models-store.json");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }

      step = "discover sandbox HOME (or set credentials.sandboxAgentDir)";
      let dir = options?.sandboxAgentDir;
      if (dir === undefined) {
        // Query the normal exec user, never sudo. Runtime/provider env may
        // select a directory even when PiOptions does not override it.
        const result = await handle.exec(
          'if [ -n "${PI_CODING_AGENT_DIR:-}" ]; then printf %s "$PI_CODING_AGENT_DIR"; else test -n "$HOME" && printf %s "$HOME/.pi/agent"; fi',
        );
        signal?.throwIfAborted();
        if (result.exitCode !== 0) throw new Error("HOME discovery failed");
        dir = result.stdout;
      }
      if (
        !posix.isAbsolute(dir) ||
        /[\r\n\0]/.test(dir) ||
        posix.normalize(dir) === "/"
      ) {
        throw new Error("invalid sandbox agent directory");
      }
      dir = posix.resolve(dir);
      step = "validate physical sandbox credential directory";
      await handle.validateDirectory(dir);
      step =
        "create private sandbox agent directory (requires writable access and stat/chmod)";
      await checkedExec(
        `test ! -L ${quote(dir)} && umask 077 && mkdir -p -- ${quote(dir)} && chmod 700 -- ${quote(dir)} && test -d ${quote(dir)} && ${modeIs(dir, "700")}`,
      );
      staging = posix.join(dir, `.ralph-credentials-${randomUUID()}`);
      await checkedExec(
        `umask 077 && mkdir -- ${quote(staging)} && ${modeIs(staging, "700")}`,
      );
      for (const file of files) {
        step = `copy ${file} host→sandbox; check file-copy support and destination access`;
        signal?.throwIfAborted();
        await handle.copyFile(join(hostDir, file), posix.join(staging, file));
        signal?.throwIfAborted();
        step = `restrict sandbox ${file} permissions (requires agent ownership or sudo chown support)`;
        const staged = posix.join(staging, file);
        // docker cp can create root-owned files even when exec runs as the
        // agent user. Repair ownership only when necessary, through the
        // provider's existing sudo exec capability; never loosen file modes.
        await checkedExec(
          `test ! -L ${quote(staged)} && test -f ${quote(staged)}`,
        );
        const owner = await handle.exec(`test -O ${quote(staged)}`);
        signal?.throwIfAborted();
        if (owner.exitCode !== 0) {
          const identity = await handle.exec(
            'printf "%s:%s" "$(id -u)" "$(id -g)"',
          );
          signal?.throwIfAborted();
          if (identity.exitCode !== 0 || !/^\d+:\d+$/.test(identity.stdout)) {
            throw new Error("cannot discover sandbox user identity");
          }
          await checkedExec(
            `chown ${quote(identity.stdout)} -- ${quote(staged)}`,
            true,
          );
        }
        await checkedExec(
          `test ! -L ${quote(staged)} && test -f ${quote(staged)} && chmod 600 -- ${quote(staged)} && test -O ${quote(staged)} && test -r ${quote(staged)} && test -w ${quote(staged)} && ${modeIs(staged, "600")}`,
        );
      }
      step = "install and verify sandbox credentials";
      installedDir = dir;
      for (const file of files) {
        const target = posix.join(dir, file);
        // Refuse directory targets; mv replaces file symlinks instead of following them.
        await checkedExec(
          `test ! -d ${quote(target)} && mv -f -- ${quote(posix.join(staging, file))} ${quote(target)} && test ! -L ${quote(target)} && test -f ${quote(target)} && ${modeIs(target, "600")}`,
        );
      }
      // A reused sandbox must not retain a catalog absent from the authoritative host.
      if (!files.includes("models-store.json")) {
        await checkedExec(
          `rm -f -- ${quote(posix.join(dir, "models-store.json"))}`,
        );
      }
      succeeded = true;
    } catch (error) {
      signal?.throwIfAborted();
      throw error instanceof CredentialProvisionError
        ? error
        : new CredentialProvisionError({
            message: `Pi credential transfer could not ${step}. No sandbox credentials were written back to the host.`,
          });
    } finally {
      // Cleanup deliberately ignores cancellation, but failures must still stop launch.
      const cleanupCommands = staging ? [`rm -rf -- ${quote(staging)}`] : [];
      if (!succeeded && installedDir) {
        const dir = installedDir;
        cleanupCommands.push(
          `rm -f -- ${["auth.json", "models-store.json"].map((file) => quote(posix.join(dir, file))).join(" ")}`,
        );
      }
      if (cleanupCommands.length) {
        let clean = false;
        try {
          const result = await handle.exec(cleanupCommands.join(" && "));
          clean = result.exitCode === 0;
        } catch {
          /* Do not expose provider errors. */
        }
        if (!clean)
          throw new CredentialProvisionError({
            message:
              "Pi credential staging cleanup failed. Close the sandbox before retrying.",
          });
      }
    }
  };
