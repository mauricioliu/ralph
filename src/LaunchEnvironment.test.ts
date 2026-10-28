import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { pi } from "./AgentProvider.js";
import { makeSandboxFromHandle } from "./SandboxFactory.js";
import { noSandbox } from "./sandboxes/no-sandbox.js";
import { prepareInteractiveLaunch } from "./LaunchEnvironment.js";

const boundary = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: boundary.spawn,
}));
const platform = process.platform;
afterEach(() => {
  Object.defineProperty(process, "platform", { value: platform });
  vi.clearAllMocks();
});

const dir = 'C:\\fixture auth\\x" & echo NEVER %PATH%';
const provider = () =>
  pi("synthetic", {
    captureSessions: false,
    env: { PI_CODING_AGENT_DIR: "loser" },
    credentials: { sandboxAgentDir: dir },
  });
const opts = {
  prompt: "fixture",
  dangerouslySkipPermissions: false,
  resumeSession: "session-fixture",
};

describe("launch environment execution boundary (inert process only)", () => {
  it("keeps Pi command and argv independent of directory spelling", () => {
    const agent = provider();
    expect(agent.buildPrintCommand(opts).command).toMatch(/^pi -p /);
    expect(agent.buildPrintCommand(opts).command).toContain(
      "--session 'session-fixture'",
    );
    expect(agent.buildPrintCommand(opts).stdin).toBe("fixture");
    expect(agent.buildInteractiveArgs!(opts)).toEqual([
      "pi",
      "--model",
      "synthetic",
      "fixture",
    ]);
  });

  it.each(["bind-mount", "isolated"] as const)(
    "uses the Linux target, not Windows host, for %s execution",
    async (tag) => {
      Object.defineProperty(process, "platform", { value: "win32" });
      const handle = {
        worktreePath: "/workspace",
        exec: async (command: string) => {
          // Cross the external transport into the fixture's Linux execution runtime.
          Object.defineProperty(process, "platform", { value: platform });
          return {
            ...(await promisify(execFile)("sh", ["-c", command])),
            exitCode: 0,
          };
        },
        interactiveExec: async () => ({ exitCode: 0 }),
        close: async () => {},
      };
      const result = await Effect.runPromise(
        makeSandboxFromHandle(handle, tag).exec(
          'printf %s "$PI_CODING_AGENT_DIR"',
          { env: { PI_CODING_AGENT_DIR: dir } },
        ),
      );
      expect(result.stdout).toBe(dir);
      Object.defineProperty(process, "platform", { value: "win32" });
      const [argv] = prepareInteractiveLaunch(
        ["sh", "-c", 'printf %s "$PI_CODING_AGENT_DIR"'],
        {
          stdin: new PassThrough(),
          stdout: new PassThrough(),
          stderr: new PassThrough(),
        },
        { PI_CODING_AGENT_DIR: dir },
        tag,
      );
      Object.defineProperty(process, "platform", { value: platform });
      const interactive = await promisify(execFile)(argv[0]!, argv.slice(1));
      expect(interactive.stdout).toBe(dir);
    },
  );

  it("passes cold and warm Windows launch overrides as spawn environment, never cmd syntax", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    boundary.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      });
      queueMicrotask(() => child.emit("close", 0));
      return child;
    });
    for (const cold of [false, true]) {
      const agent = provider();
      const handle = await noSandbox().create({
        worktreePath: "C:\\fixture",
        env: cold ? agent.env : { PI_CODING_AGENT_DIR: "stale", KEEP: "kept" },
      });
      const command = agent.buildPrintCommand(opts);
      const service = makeSandboxFromHandle(handle, "none");
      await Effect.runPromise(
        service.exec(command.command, {
          stdin: command.stdin,
          env: agent.launchEnv,
        }),
      );
      await handle.interactiveExec(agent.buildInteractiveArgs!(opts), {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        env: agent.launchEnv,
      });
    }
    expect(boundary.spawn.mock.calls).toHaveLength(4);
    expect(boundary.spawn.mock.calls[0]![2].env.KEEP).toBe("kept");
    for (const [executable, args, options] of boundary.spawn.mock.calls) {
      expect(options.env.PI_CODING_AGENT_DIR).toBe(dir);
      expect(JSON.stringify([executable, args])).not.toContain("NEVER");
      expect(executable === "cmd.exe" ? args.slice(0, 3) : executable).toEqual(
        executable === "cmd.exe" ? ["/d", "/s", "/c"] : "pi",
      );
    }
  });
});
