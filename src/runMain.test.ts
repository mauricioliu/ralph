import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { constants, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const cli = resolve(import.meta.dirname, "../dist/main.js");
const fixtures: string[] = [];
const fixture = async () => {
  const dir = await mkdtemp(join(tmpdir(), "ralph run fixture "));
  fixtures.push(dir);
  await mkdir(join(dir, ".ralph"));
  return dir;
};
const invoke = (
  cwd: string,
  args = ["run"],
  input = "",
  signalOnReady?: NodeJS.Signals,
  signalGroup = false,
) =>
  new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, [cli, ...args], {
        cwd,
        env: { ...process.env, RALPH_RUN_FIXTURE: "synthetic-env" },
        stdio: "pipe",
        detached: signalGroup,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (signalOnReady && stdout.includes("ENTRY_READY")) {
          const signal = signalOnReady;
          signalOnReady = undefined;
          if (signalGroup) process.kill(-child.pid!, signal);
          else child.kill(signal);
        }
      });
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    },
  );

afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("ralph run (built CLI, synthetic entry points only)", () => {
  for (const signalGroup of [false, true]) {
    it
      .skipIf(signalGroup && process.platform === "win32")
      .each(["SIGINT", "SIGTERM"] as const)(
      `forwards %s exactly once (${signalGroup ? "foreground group" : "parent PID"})`,
      async (signal) => {
        const cwd = await fixture();
        await writeFile(
          join(cwd, ".ralph/main.mts"),
          `
      let signals = 0;
      process.on(${JSON.stringify(signal)}, () => {
        signals++;
        setTimeout(() => {
          console.log("SIGNAL_RECEIVED", signals);
          console.log("CLEANUP_COMPLETE");
          process.exit(7);
        }, 75);
      });
      console.log("ENTRY_READY");
      setTimeout(() => process.exit(88), 1500);
    `,
        );
        const result = await invoke(cwd, ["run"], "", signal, signalGroup);
        expect(result.stdout).toContain("CLEANUP_COMPLETE");
        expect(result.stdout).toContain("SIGNAL_RECEIVED 1");
        expect(result.stdout).not.toContain("SIGNAL_RECEIVED 2");
        expect(result.code).toBe(7);
      },
    );
  }

  it("preserves nonzero entry-point exit codes", async () => {
    const cwd = await fixture();
    await writeFile(join(cwd, ".ralph/main.mts"), "process.exit(7);");
    expect((await invoke(cwd)).code).toBe(7);
  });

  it("preserves an entry point terminated by signal", async () => {
    const cwd = await fixture();
    await writeFile(
      join(cwd, ".ralph/main.mts"),
      'process.kill(process.pid, "SIGTERM");',
    );
    expect((await invoke(cwd)).code).toBe(128 + constants.signals.SIGTERM);
  });

  it("explains missing entry points", async () => {
    const cwd = await fixture();
    const result = await invoke(cwd);
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("Run ralph init first");
  });

  it("rejects ambiguity before executing either entry point", async () => {
    const cwd = await fixture();
    for (const ext of ["ts", "mts"])
      await writeFile(
        join(cwd, `.ralph/main.${ext}`),
        'console.log("UNEXPECTED_EXECUTION");',
      );
    const result = await invoke(cwd);
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toContain(
      "Both .ralph/main.ts and .ralph/main.mts exist",
    );
    expect(result.stdout).not.toContain("UNEXPECTED_EXECUTION");
  });

  it.each(["--unknown", "unexpected-argument"])(
    "rejects %s before executing the entry point",
    async (arg) => {
      const cwd = await fixture();
      await writeFile(
        join(cwd, ".ralph/main.mts"),
        'console.log("UNEXPECTED_EXECUTION");',
      );
      const result = await invoke(cwd, ["run", arg]);
      expect(result.code).not.toBe(0);
      expect(result.stdout).not.toContain("UNEXPECTED_EXECUTION");
    },
  );
  it.each(["ts", "mts"])(
    "executes main.%s with TypeScript, cwd, env and terminal streams",
    async (extension) => {
      const cwd = await fixture();
      await writeFile(
        join(cwd, "package.json"),
        JSON.stringify({ type: extension === "ts" ? "module" : "commonjs" }),
      );
      await writeFile(
        join(cwd, `.ralph/main.${extension}`),
        `
      const value: string = "entry-ok";
      process.stdin.setEncoding("utf8");
      let input = "";
      for await (const chunk of process.stdin) input += chunk;
      console.log(JSON.stringify({ value, cwd: process.cwd(), env: process.env.RALPH_RUN_FIXTURE, input }));
      console.error("synthetic-stderr");
    `,
      );
      const result = await invoke(cwd, ["run"], "synthetic-stdin");
      expect(result.code).toBe(0);
      expect(
        JSON.parse(
          result.stdout.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").trim(),
        ),
      ).toEqual({
        value: "entry-ok",
        cwd,
        env: "synthetic-env",
        input: "synthetic-stdin",
      });
      expect(result.stderr).toContain("synthetic-stderr");
    },
  );
});
