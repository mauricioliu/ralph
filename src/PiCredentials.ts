import { homedir } from "node:os";
import { join, posix } from "node:path";
import { randomUUID } from "node:crypto";
import { Effect, Exit } from "effect";
import { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { CredentialProvisionError } from "./errors.js";
import {
  checkCredentialCancellation,
  runCredentialProgram,
  type CredentialCancelled,
} from "./CredentialProvision.js";
import type { CredentialSandboxHandle } from "./SandboxProvider.js";

/** Host source and sandbox destination overrides for one-way Pi credentials. */
export interface PiCredentialOptions {
  /** Authoritative host directory containing auth.json and optional models-store.json. */
  readonly hostAgentDir?: string;
  /** Private sandbox directory outside the physical worktree, without symlink ancestors. */
  readonly sandboxAgentDir?: string;
}

type ProvisionArgs = {
  readonly handle: CredentialSandboxHandle;
  readonly signal?: AbortSignal;
};

const quote = (s: string): string => "'" + s.replace(/'/g, "'\\''") + "'";
const modeIs = (path: string, mode: string): string =>
  `test "$(stat -c %a -- ${quote(path)})" = ${mode}`;

/** Internal typed program: filesystem and one-way transport primitives are injectable. */
export const provisionPiCredentialsEffect = (
  options: PiCredentialOptions | undefined,
  { handle, signal }: ProvisionArgs,
): Effect.Effect<
  void,
  CredentialProvisionError | CredentialCancelled,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    yield* checkCredentialCancellation(signal);
    const fs = yield* FileSystem.FileSystem;
    const hostDir =
      options?.hostAgentDir ??
      process.env.PI_CODING_AGENT_DIR ??
      join(homedir(), ".pi", "agent");
    const hostAuth = join(hostDir, "auth.json");
    let step = "read host auth.json";
    let staging: string | undefined;
    let installedDir: string | undefined;
    const failure = () =>
      new CredentialProvisionError({
        message: `Pi credential transfer could not ${step}. No sandbox credentials were written back to the host.`,
      });
    // A transport primitive is allowed to settle before observing cancellation.
    const transport = <A>(operation: () => Promise<A>) =>
      Effect.gen(function* () {
        yield* checkCredentialCancellation(signal);
        const value = yield* Effect.tryPromise({
          try: operation,
          catch: (error) =>
            error instanceof CredentialProvisionError ? error : failure(),
        }).pipe(
          Effect.catchAll((error) =>
            checkCredentialCancellation(signal).pipe(
              Effect.zipRight(Effect.fail(error)),
            ),
          ),
        );
        yield* checkCredentialCancellation(signal);
        return value;
      });
    const checkedExec = (command: string, sudo = false) =>
      Effect.gen(function* () {
        const result = yield* transport(() =>
          handle.exec(command, sudo ? { sudo: true } : undefined),
        );
        if (result.exitCode !== 0) yield* Effect.fail(failure());
      });

    const outcome = yield* Effect.exit(
      Effect.gen(function* () {
        yield* Effect.gen(function* () {
          yield* fs.access(hostAuth, { readable: true });
          const info = yield* fs.stat(hostAuth);
          if (info.type !== "File") yield* Effect.fail(failure());
        }).pipe(
          Effect.mapError(
            () =>
              new CredentialProvisionError({
                message:
                  "Pi auth.json is missing or unreadable on the host. Authenticate with pi on the host, or set PiOptions.credentials.hostAgentDir.",
                hostPath: hostAuth,
              }),
          ),
        );
        yield* checkCredentialCancellation(signal);
        const files = ["auth.json"];
        step = "read host models-store.json";
        const catalog = join(hostDir, "models-store.json");
        const info = yield* fs.stat(catalog).pipe(
          Effect.catchIf(
            (error) =>
              error._tag === "SystemError" && error.reason === "NotFound",
            () => Effect.succeed(undefined),
          ),
          Effect.mapError(failure),
        );
        if (info !== undefined) {
          if (info.type !== "File") return yield* Effect.fail(failure());
          yield* fs
            .access(catalog, { readable: true })
            .pipe(Effect.mapError(failure));
          files.push("models-store.json");
        }

        step = "discover sandbox HOME (or set credentials.sandboxAgentDir)";
        let dir = options?.sandboxAgentDir;
        if (dir === undefined) {
          const result = yield* transport(() =>
            handle.exec(
              'if [ -n "${PI_CODING_AGENT_DIR:-}" ]; then printf %s "$PI_CODING_AGENT_DIR"; else test -n "$HOME" && printf %s "$HOME/.pi/agent"; fi',
            ),
          );
          if (result.exitCode !== 0) return yield* Effect.fail(failure());
          dir = result.stdout;
        }
        if (
          !posix.isAbsolute(dir) ||
          /[\r\n\0]/.test(dir) ||
          posix.normalize(dir) === "/"
        ) {
          return yield* Effect.fail(failure());
        }
        dir = posix.resolve(dir);
        step = "validate physical sandbox credential directory";
        yield* transport(() => handle.validateDirectory(dir));
        step =
          "create private sandbox agent directory (requires writable access and stat/chmod)";
        yield* checkedExec(
          `test ! -L ${quote(dir)} && umask 077 && mkdir -p -- ${quote(dir)} && chmod 700 -- ${quote(dir)} && test -d ${quote(dir)} && ${modeIs(dir, "700")}`,
        );
        staging = posix.join(dir, `.ralph-credentials-${randomUUID()}`);
        yield* checkedExec(
          `umask 077 && mkdir -- ${quote(staging)} && ${modeIs(staging, "700")}`,
        );
        for (const file of files) {
          step = `copy ${file} host→sandbox; check file-copy support and destination access`;
          const staged = posix.join(staging, file);
          yield* transport(() => handle.copyFile(join(hostDir, file), staged));
          step = `restrict sandbox ${file} permissions (requires agent ownership or sudo chown support)`;
          yield* checkedExec(
            `test ! -L ${quote(staged)} && test -f ${quote(staged)}`,
          );
          const owner = yield* transport(() =>
            handle.exec(`test -O ${quote(staged)}`),
          );
          if (owner.exitCode !== 0) {
            const identity = yield* transport(() =>
              handle.exec('printf "%s:%s" "$(id -u)" "$(id -g)"'),
            );
            if (identity.exitCode !== 0 || !/^\d+:\d+$/.test(identity.stdout))
              return yield* Effect.fail(failure());
            yield* checkedExec(
              `chown ${quote(identity.stdout)} -- ${quote(staged)}`,
              true,
            );
          }
          yield* checkedExec(
            `test ! -L ${quote(staged)} && test -f ${quote(staged)} && chmod 600 -- ${quote(staged)} && test -O ${quote(staged)} && test -r ${quote(staged)} && test -w ${quote(staged)} && ${modeIs(staged, "600")}`,
          );
        }
        step = "install and verify sandbox credentials";
        installedDir = dir;
        for (const file of files) {
          const target = posix.join(dir, file);
          // mv replaces file symlinks, never follows them; reject directory targets.
          yield* checkedExec(
            `test ! -d ${quote(target)} && mv -f -- ${quote(posix.join(staging, file))} ${quote(target)} && test ! -L ${quote(target)} && test -f ${quote(target)} && ${modeIs(target, "600")}`,
          );
        }
        if (!files.includes("models-store.json")) {
          yield* checkedExec(
            `rm -f -- ${quote(posix.join(dir, "models-store.json"))}`,
          );
        }
      }).pipe(
        Effect.catchAll((error) =>
          checkCredentialCancellation(signal).pipe(
            Effect.zipRight(Effect.fail(error)),
          ),
        ),
      ),
    );

    // Cleanup is inside the uninterruptible program, independent of the caller's
    // signal. Its typed failure overrides the outcome: the handle is not reusable.
    const cleanupCommands = staging ? [`rm -rf -- ${quote(staging)}`] : [];
    if (Exit.isFailure(outcome) && installedDir) {
      cleanupCommands.push(
        `rm -f -- ${["auth.json", "models-store.json"].map((file) => quote(posix.join(installedDir!, file))).join(" ")}`,
      );
    }
    if (cleanupCommands.length) {
      const cleanupError = () =>
        new CredentialProvisionError({
          message:
            "Pi credential staging cleanup failed. Close the sandbox before retrying.",
        });
      const result = yield* Effect.tryPromise({
        try: () => handle.exec(cleanupCommands.join(" && ")),
        catch: cleanupError,
      });
      if (result.exitCode !== 0) return yield* Effect.fail(cleanupError());
    }
    yield* outcome;
  }).pipe(Effect.uninterruptible);

/** Copy host-owned credentials without host writes, settling transports before abort cleanup. */
export const makePiCredentialProvisioner =
  (options?: PiCredentialOptions) =>
  (args: ProvisionArgs): Promise<void> =>
    runCredentialProgram(
      provisionPiCredentialsEffect(options, args).pipe(
        Effect.provide(NodeFileSystem.layer),
      ),
      args.signal,
    );
