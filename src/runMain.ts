import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { constants } from "node:os";
import { join } from "node:path";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { ExecHostError } from "./errors.js";

const require = createRequire(import.meta.url);
const failure = (message: string) =>
  new ExecHostError({ command: "ralph run", message });

/** Execute the current project's unique scaffold with the bundled TypeScript runtime. */
export const runMain = (cwd: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const candidates = yield* Effect.forEach(
      ["main.ts", "main.mts"],
      (name) => {
        const path = join(cwd, ".ralph", name);
        return fs.stat(path).pipe(
          Effect.map((info) => (info.type === "File" ? path : undefined)),
          Effect.catchAll((error) =>
            error._tag === "SystemError" && error.reason === "NotFound"
              ? Effect.succeed(undefined)
              : Effect.fail(
                  failure(
                    "Cannot inspect the entry points. Check access to .ralph/.",
                  ),
                ),
          ),
        );
      },
    );
    const entries = candidates.filter(
      (entry): entry is string => entry !== undefined,
    );
    if (entries.length === 0) {
      return yield* Effect.fail(
        failure(
          "No .ralph/main.ts or .ralph/main.mts found. Run ralph init first.",
        ),
      );
    }
    if (entries.length > 1) {
      return yield* Effect.fail(
        failure(
          "Both .ralph/main.ts and .ralph/main.mts exist. Keep only the intended entry point.",
        ),
      );
    }
    const runtime = yield* Effect.try({
      try: () => require.resolve("tsx/cli"),
      catch: () =>
        failure(
          "The included TypeScript runtime is unavailable. Reinstall Ralph.",
        ),
    });
    // The CLI runtime may request interruption on SIGINT/SIGTERM. Forward the
    // signal once, then let the child finish cleanup before restoring its status.
    yield* Effect.async<void, ExecHostError>((resume) => {
      const child = spawn(process.execPath, [runtime, entries[0]!], {
        cwd,
        env: process.env,
        stdio: "inherit",
        // Isolate POSIX group signals: terminal Ctrl-C reaches Ralph, which
        // forwards once through tsx rather than also broadcasting to the entry.
        // Inherited descriptors still provide the original terminal streams.
        detached: process.platform !== "win32",
      });
      const interrupt = () => {
        child.kill("SIGINT");
      };
      const terminate = () => {
        child.kill("SIGTERM");
      };
      const cleanup = () => {
        process.off("SIGINT", interrupt);
        process.off("SIGTERM", terminate);
      };
      process.on("SIGINT", interrupt);
      process.on("SIGTERM", terminate);
      child.once("error", () => {
        cleanup();
        resume(
          Effect.fail(
            failure(
              "Could not start the entry point. Check the Ralph installation.",
            ),
          ),
        );
      });
      // Wait for inherited output streams and the runtime to finish, not just exit.
      child.once("close", (code, signal) => {
        cleanup();
        resume(
          Effect.sync(() => {
            process.exitCode =
              code ?? (signal ? 128 + constants.signals[signal] : 1);
          }),
        );
      });
      return Effect.sync(() => {
        cleanup();
        child.kill("SIGTERM");
      });
    }).pipe(Effect.uninterruptible);
  });
