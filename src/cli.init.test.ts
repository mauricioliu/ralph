import { NodeContext } from "@effect/platform-node";
import { Effect, Ref } from "effect";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({
  select: vi.fn(),
  confirm: vi.fn(),
  cancel: Symbol("synthetic-cancel"),
  execSync: vi.fn(() => {
    throw new Error("Unexpected host command during init test");
  }),
  execFile: vi.fn((..._args: unknown[]) => {
    throw new Error("Unexpected external executable during init test");
  }),
  otherProcess: vi.fn(() => {
    throw new Error("Unexpected process API during init test");
  }),
}));
vi.mock("@clack/prompts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@clack/prompts")>()),
  select: doubles.select,
  confirm: doubles.confirm,
  isCancel: (value: unknown) => value === doubles.cancel,
}));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execSync: doubles.execSync,
  execFile: doubles.execFile,
  exec: doubles.otherProcess,
  execFileSync: doubles.otherProcess,
  spawn: doubles.otherProcess,
  spawnSync: doubles.otherProcess,
  fork: doubles.otherProcess,
}));

import { cli } from "./cli.js";
import { SilentDisplay, type DisplayEntry } from "./Display.js";

const planner = "openai-codex/gpt-6-astra:high";
const worker = "zai-coding-cn/glm-5.3:high";

describe("interactive init with prompt and process doubles", () => {
  let dir: string;
  let ttyDescriptor: PropertyDescriptor | undefined;
  let template: string;
  let selectedAgent: string | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    dir = await mkdtemp(join(tmpdir(), "ralph-init-interactive-"));
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    vi.stubEnv("HOME", dir);
    vi.stubEnv("PI_CODING_AGENT_DIR", join(dir, "synthetic-pi"));
    ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    template = "parallel-planner-with-review";
    selectedAgent = undefined;
    doubles.select.mockImplementation(async (options) => {
      switch (options.message) {
        case "Select an agent:":
          return selectedAgent ?? options.initialValue;
        case "Select a sandbox provider:":
          return "podman";
        case "Select an issue tracker:":
          return "github-issues";
        case "Select a template:":
          return template;
        default:
          throw new Error(`Unexpected prompt: ${options.message}`);
      }
    });
    // Decline label creation, dependency installation and image build.
    doubles.confirm.mockResolvedValue(false);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    if (ttyDescriptor)
      Object.defineProperty(process.stdin, "isTTY", ttyDescriptor);
    else Reflect.deleteProperty(process.stdin, "isTTY");
    await rm(dir, { recursive: true, force: true });
  });

  async function runInit(args: string[] = [], expectedBuild?: string) {
    const entries = Ref.unsafeMake<ReadonlyArray<DisplayEntry>>([]);
    await Effect.runPromise(
      cli(["node", "ralph", "init", ...args]).pipe(
        Effect.provide(NodeContext.layer),
        Effect.provide(SilentDisplay.layer(entries)),
      ),
    );
    expect(doubles.execSync).not.toHaveBeenCalled();
    expect(doubles.otherProcess).not.toHaveBeenCalled();
    if (expectedBuild === undefined)
      expect(doubles.execFile).not.toHaveBeenCalled();
    else {
      expect(doubles.execFile).toHaveBeenCalledOnce();
      const [executable, argv] = doubles.execFile.mock.calls[0]!;
      expect(executable).toBe(expectedBuild);
      expect((argv as string[]).slice(0, 3)).toEqual([
        "build",
        "-t",
        "synthetic-init-image",
      ]);
      expect((argv as string[]).at(-1)).toBe(join(dir, ".ralph"));
    }
    return {
      source: await readFile(join(dir, ".ralph", "main.mts"), "utf8"),
      output: (await Effect.runPromise(Ref.get(entries)))
        .filter((entry) => entry._tag === "text" || entry._tag === "status")
        .map((entry) => entry.message)
        .join("\n"),
    };
  }

  it.each([
    "blank",
    "simple-loop",
    "sequential-reviewer",
    "parallel-planner",
    "parallel-planner-with-review",
  ])("preselects Pi and retains template models: %s", async (name) => {
    template = name;
    const { source, output } = await runInit();
    expect(doubles.select).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Select an agent:",
        initialValue: "pi",
        options: expect.arrayContaining([
          expect.objectContaining({
            value: "pi",
            hint: `Planner ${planner} · workers ${worker}`,
          }),
          expect.objectContaining({
            value: "claude-code",
            hint: "Default model: claude-opus-4-8",
          }),
          expect.objectContaining({
            value: "codex",
            hint: "Default model: gpt-5.4",
          }),
        ]),
      }),
    );
    expect(source).toContain(`pi("${worker}")`);
    expect(source.includes(`pi("${planner}")`)).toBe(
      name.startsWith("parallel-planner"),
    );
    expect(source).not.toContain("claudeCode");
    expect(source).toContain("sandbox: podman()");
    const files = await readdir(join(dir, ".ralph"));
    expect(files).toContain("Containerfile");
    expect(files).not.toContain("Dockerfile");
    const env = await readFile(join(dir, ".ralph", ".env.example"), "utf8");
    expect(env).toContain("GH_TOKEN=");
    expect(env).not.toMatch(/^[A-Z_]*API_KEY=/m);
    expect(output).toContain("/login");
    expect(output).toContain("auth.json");
    expect(output).toContain("host stays authoritative");
  });

  it("an explicit --model equal to the worker default still overrides the planner", async () => {
    const { source } = await runInit(["--model", worker]);
    expect(source.match(/ralph\.pi\(/g)).toHaveLength(4);
    expect(source.match(/pi\("zai-coding-cn\/glm-5\.3:high"\)/g)).toHaveLength(
      4,
    );
    expect(source).not.toContain(planner);
  });

  it.each([
    [
      "claude-code",
      "claudeCode",
      "claude-opus-4-8",
      "CLAUDE_CODE_OAUTH_TOKEN=",
    ],
    ["codex", "codex", "gpt-5.4", "CODEX_API_KEY="],
    ["cursor", "cursor", "composer-2", "CURSOR_API_KEY="],
    ["opencode", "opencode", "opencode/big-pickle", "OPENCODE_API_KEY="],
    ["copilot", "copilot", "claude-sonnet-4.5", "GITHUB_TOKEN="],
  ])(
    "allows selecting %s instead of Pi",
    async (agent, factory, model, key) => {
      selectedAgent = agent;
      const { source, output } = await runInit();
      expect(
        source.match(new RegExp(`ralph\\.${factory}\\(`, "g")),
      ).toHaveLength(4);
      expect(source.split(`${factory}("${model}")`)).toHaveLength(5);
      expect(source).not.toMatch(/\bpi\(/);
      expect(source).not.toContain(planner);
      const env = await readFile(join(dir, ".ralph", ".env.example"), "utf8");
      expect(env).toContain(key);
      if (agent === "claude-code") {
        expect(env).toContain("# ANTHROPIC_API_KEY=");
        expect(output).toContain("claude setup-token");
      } else if (agent === "codex") {
        expect(env).not.toContain("OPENAI_KEY=");
        expect(env).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
        expect(output).not.toContain("claude setup-token");
      }
    },
  );

  it.each(["docker", "podman"])(
    "honors an approved %s build through the external process boundary",
    async (sandbox) => {
      doubles.execFile.mockImplementationOnce((...args) => {
        const callback = args.at(-1) as (
          error: null,
          stdout: string,
          stderr: string,
        ) => void;
        callback(null, "synthetic build completed", "");
      });
      const { output } = await runInit(
        [
          "--sandbox",
          sandbox,
          "--build-image",
          "true",
          "--image-name",
          "synthetic-init-image",
        ],
        sandbox,
      );
      expect(output).toContain("Image built successfully");
    },
  );

  it.each(["docker", "podman"])(
    "declining %s build keeps scaffolding but launches no process",
    async (sandbox) => {
      const { output } = await runInit(["--sandbox", sandbox]);
      expect(output).toContain(`ralph ${sandbox} build-image`);
      expect(output).not.toContain("Image built successfully");
    },
  );

  it.each(["docker", "podman"])(
    "reports an external %s build failure rather than claiming success",
    async (sandbox) => {
      doubles.execFile.mockImplementationOnce((...args) => {
        const callback = args.at(-1) as (
          error: Error,
          stdout: string,
          stderr: string,
        ) => void;
        callback(
          new Error("synthetic build rejected"),
          "",
          "synthetic build rejected",
        );
      });
      await expect(
        runInit(["--sandbox", sandbox, "--build-image", "true"]),
      ).rejects.toThrow("synthetic build rejected");
      expect(doubles.execFile).toHaveBeenCalledOnce();
      expect(doubles.execSync).not.toHaveBeenCalled();
      expect(doubles.otherProcess).not.toHaveBeenCalled();
    },
  );

  it("cancelling the agent picker does not scaffold or launch anything", async () => {
    doubles.select.mockResolvedValueOnce(doubles.cancel);
    await expect(runInit()).rejects.toThrow("Agent selection cancelled");
    expect(await readdir(dir)).toEqual([]);
    expect(doubles.execSync).not.toHaveBeenCalled();
    expect(doubles.execFile).not.toHaveBeenCalled();
    expect(doubles.otherProcess).not.toHaveBeenCalled();
  });
});
