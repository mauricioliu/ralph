import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withPiAuth } from "./pi-auth";
import { piAgent } from "./common";

// Deliberately synthetic, never read the developer's real home or auth files.
const fixture = JSON.stringify({
  "fixture-provider": { type: "oauth", access: "SYNTHETIC-ONLY" },
});
afterEach(() => vi.unstubAllEnvs());

describe("Pi workflow credential lifetime", () => {
  it("isolates credentials and session lookup; cleans on success without copying refreshes back", async () => {
    vi.stubEnv("PI_AUTH_JSON", fixture);
    vi.stubEnv("PI_MODELS_STORE_JSON", '{"fixture-provider":{"models":[]}}');
    vi.stubEnv("PI_CODING_AGENT_DIR", "/unused-previous-fixture");
    let dir = "";
    const value = await withPiAuth(async () => {
      dir = process.env.PI_CODING_AGENT_DIR!;
      expect(dir).not.toBe("/unused-previous-fixture");
      expect(dir.startsWith(process.cwd())).toBe(false);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      for (const name of ["auth.json", "models-store.json"]) {
        expect(statSync(join(dir, name)).mode & 0o777).toBe(0o600);
      }
      expect(readFileSync(join(dir, "auth.json"), "utf8")).toBe(fixture);
      expect(process.env.PI_AUTH_JSON).toBeUndefined();
      expect(process.env.PI_MODELS_STORE_JSON).toBeUndefined();

      const provider = piAgent();
      expect(provider.name).toBe("pi");
      expect(provider.env).toEqual({ PI_CODING_AGENT_DIR: dir });
      // Synthetic Pi session: extraction/resume must find the *same* temp home,
      // not the machine's normal ~/.pi/agent/sessions.
      const sessionDir = join(dir, "sessions", "--fixture--");
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(
        join(sessionDir, "2026-01-01_fixture-session.jsonl"),
        '{"type":"session","id":"fixture-session","cwd":"/fixture"}\n',
      );
      expect(
        await provider.sessionStorage.existsOnHost(
          "/fixture",
          "fixture-session",
        ),
      ).toBe(true);
      expect(
        provider.buildPrintCommand({
          prompt: "fixture",
          resumeSession: "fixture-session",
          dangerouslySkipPermissions: false,
        }).command,
      ).toContain("--session 'fixture-session'");
      writeFileSync(
        join(dir, "auth.json"),
        '{"fixture":"refreshed-synthetic"}',
      );
      return 42;
    });
    expect(value).toBe(42);
    expect(existsSync(dir)).toBe(false);
    expect(process.env.PI_CODING_AGENT_DIR).toBe("/unused-previous-fixture");
    expect(process.env.PI_AUTH_JSON).toBeUndefined();
  });

  it("cleans on rejection and restores an absent directory setting", async () => {
    vi.stubEnv("PI_AUTH_JSON", fixture);
    vi.stubEnv("PI_MODELS_STORE_JSON", undefined);
    vi.stubEnv("PI_CODING_AGENT_DIR", undefined);
    let dir = "";
    await expect(
      withPiAuth(async () => {
        dir = process.env.PI_CODING_AGENT_DIR!;
        expect(existsSync(join(dir, "models-store.json"))).toBe(false);
        throw new Error("synthetic callback failure");
      }),
    ).rejects.toThrow("synthetic callback failure");
    expect(existsSync(dir)).toBe(false);
    expect(process.env.PI_CODING_AGENT_DIR).toBeUndefined();
  });

  it("registers synchronous cleanup for existing process.exit failure paths", async () => {
    vi.stubEnv("PI_AUTH_JSON", fixture);
    vi.stubEnv("PI_MODELS_STORE_JSON", undefined);
    const previous = new Set(process.listeners("exit"));
    await withPiAuth(async () => {
      const dir = process.env.PI_CODING_AGENT_DIR!;
      const added = process.listeners("exit").filter((fn) => !previous.has(fn));
      expect(added).toHaveLength(1);
      // Exercise just this handler, never actually exit the test process.
      added[0]!(1);
      expect(existsSync(dir)).toBe(false);
    });
    expect(process.listeners("exit")).toEqual([...previous]);
  });

  it.each([
    undefined,
    "",
    "null",
    "[]",
    "{}",
    '"SYNTHETIC-SECRET"',
    '{"token":"SYNTHETIC-SECRET"',
  ])(
    "fails closed on invalid or missing auth (%s), without echoing input",
    async (input) => {
      vi.stubEnv("PI_AUTH_JSON", input);
      vi.stubEnv("PI_MODELS_STORE_JSON", undefined);
      vi.stubEnv("PI_CODING_AGENT_DIR", "/unused-host-fixture");
      const callback = vi.fn();
      await expect(withPiAuth(callback)).rejects.toThrow(
        "PI_AUTH_JSON must contain a non-empty JSON object; configure the Pi workflow secret.",
      );
      expect(callback).not.toHaveBeenCalled();
      expect(process.env.PI_CODING_AGENT_DIR).toBe("/unused-host-fixture");
      expect(process.env.PI_AUTH_JSON).toBeUndefined();
    },
  );

  it("rejects malformed optional catalogs without starting work or leaking content", async () => {
    vi.stubEnv("PI_AUTH_JSON", fixture);
    vi.stubEnv("PI_MODELS_STORE_JSON", "SYNTHETIC-SECRET");
    const callback = vi.fn();
    await expect(withPiAuth(callback)).rejects.toThrow(
      "PI_MODELS_STORE_JSON must contain a non-empty JSON object; configure the Pi workflow secret.",
    );
    expect(callback).not.toHaveBeenCalled();
    expect(process.env.PI_MODELS_STORE_JSON).toBeUndefined();
  });
});

describe("Pi workflow roles (construction only)", () => {
  it.each([
    ["planner", "openai-codex/gpt-6-astra:high"],
    ["worker", "zai-coding-cn/glm-5.3:high"],
  ] as const)(
    "%s uses the documented model and supports resume",
    (role, model) => {
      vi.stubEnv("PI_CODING_AGENT_DIR", undefined);
      const provider = piAgent(role);
      const print = provider.buildPrintCommand({
        prompt: "fixture",
        dangerouslySkipPermissions: false,
      });
      expect(print.command).toContain(`--model '${model}'`);
      expect(print.stdin).toBe("fixture");
      expect(provider.sessionStorage).toBeDefined();
      expect(provider.provisionCredentials).toBeTypeOf("function");
      expect(provider.env).toEqual({});
    },
  );
});
