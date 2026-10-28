import { describe, expect, it, vi } from "vitest";
import { claudeCode, pi } from "./AgentProvider.js";
import { provisionAgentCredentials } from "./CredentialProvision.js";
import { CredentialProvisionError } from "./errors.js";
import { CredentialProvisionError as PublicCredentialError } from "./CredentialProvisionError.js";
import { formatErrorMessage } from "./ErrorHandler.js";
import {
  toCredentialHandle,
  type BindMountSandboxHandle,
  type IsolatedSandboxHandle,
  type NoSandboxHandle,
} from "./SandboxProvider.js";

const result = { stdout: "", stderr: "", exitCode: 0 };
const base = () => ({
  worktreePath: "/workspace",
  exec: vi.fn(async () => result),
  close: vi.fn(async () => {}),
});

describe("credential capability and policy", () => {
  it("normalizes bind-mount and isolated copies, preserving method receivers and no reverse channel", async () => {
    for (const method of ["copyFileIn", "copyIn"] as const) {
      const copy = vi.fn(function (this: unknown) {
        expect(this).toBe(raw);
        return Promise.resolve();
      });
      const raw = { ...base(), copyFileOut: vi.fn(), [method]: copy };
      const handle = toCredentialHandle(
        raw as unknown as BindMountSandboxHandle | IsolatedSandboxHandle,
      )!;
      await handle.copyFile("host", "/outside/sandbox");
      await handle.exec("true");
      expect(copy).toHaveBeenCalledWith("host", "/outside/sandbox");
      expect(raw.exec).toHaveBeenCalledWith("true", undefined);
      expect(Object.keys(handle).sort()).toEqual([
        "copyFile",
        "exec",
        "validateDirectory",
      ]);
      expect(raw.copyFileOut).not.toHaveBeenCalled();
    }
  });

  it.each(["copyFileIn", "copyIn"] as const)(
    "rejects %s credential destinations inside the synced worktree before copying",
    async (method) => {
      const copy = vi.fn(async () => {});
      const raw = { ...base(), [method]: copy };
      const handle = toCredentialHandle(
        raw as unknown as IsolatedSandboxHandle,
      )!;
      for (const destination of [
        "/workspace/auth.json",
        "/workspace/.pi/agent/auth.json",
        "/workspace/../workspace/auth.json",
        "/workspace",
      ]) {
        await expect(
          handle.copyFile("synthetic-source", destination),
        ).rejects.toMatchObject({
          _tag: "CredentialProvisionError",
          message: expect.stringContaining("outside the sandbox worktree"),
        });
      }
      expect(copy).not.toHaveBeenCalled();
      await handle.copyFile("synthetic-source", "/workspace-sibling/auth.json");
      expect(copy).toHaveBeenCalledOnce();
    },
  );

  it("rejects missing or non-function copy/exec capabilities", () => {
    for (const handle of [
      base(),
      { ...base(), copyFileIn: undefined },
      { ...base(), copyIn: true },
      { ...base(), exec: null, copyFileIn: () => {} },
    ]) {
      expect(
        toCredentialHandle(handle as unknown as NoSandboxHandle),
      ).toBeUndefined();
    }
  });

  it("skips providers without an opt-in and all no-sandbox transfers", async () => {
    await provisionAgentCredentials({
      provider: claudeCode("synthetic"),
      sandboxTag: "bind-mount",
      credentialHandle: undefined,
    });
    const provider = pi("synthetic", {
      credentials: { hostAgentDir: "/nonexistent/synthetic-auth" },
    });
    provider.provisionCredentials = vi.fn();
    await provisionAgentCredentials({
      provider,
      sandboxTag: "none",
      credentialHandle: undefined,
    });
    expect(provider.provisionCredentials).not.toHaveBeenCalled();
  });

  it.each(["bind-mount", "isolated"] as const)(
    "fails closed without a credential handle in %s",
    async (sandboxTag) => {
      await expect(
        provisionAgentCredentials({
          provider: pi("synthetic"),
          sandboxTag,
          credentialHandle: undefined,
        }),
      ).rejects.toMatchObject({
        _tag: "CredentialProvisionError",
        message: expect.stringContaining("copyFileIn"),
      });
    },
  );

  it("passes a typed failure through and formats its actionable message", async () => {
    const error = new CredentialProvisionError({
      message: "Authenticate on host first",
    });
    const provider = {
      ...pi("synthetic"),
      provisionCredentials: async () => {
        throw error;
      },
    };
    await expect(
      provisionAgentCredentials({
        provider,
        sandboxTag: "bind-mount",
        credentialHandle: {
          exec: async () => result,
          validateDirectory: async () => {},
          copyFile: async () => {},
        },
      }),
    ).rejects.toBe(error);
    expect(formatErrorMessage(error)).toBe(error.message);
    expect(error).toBeInstanceOf(PublicCredentialError);
    expect(new PublicCredentialError({ message: "fixture" })).toBeInstanceOf(
      CredentialProvisionError,
    );
  });

  it("never copies an untyped provider exception into the public error", async () => {
    const provider = {
      ...pi("synthetic"),
      provisionCredentials: async () => {
        throw new Error("synthetic-secret-token");
      },
    };
    await expect(
      provisionAgentCredentials({
        provider,
        sandboxTag: "isolated",
        credentialHandle: {
          exec: async () => result,
          validateDirectory: async () => {},
          copyFile: async () => {},
        },
      }),
    ).rejects.toMatchObject({
      _tag: "CredentialProvisionError",
      message: expect.not.stringContaining("synthetic-secret-token"),
    });
  });

  it("checks cancellation even for skipped transfers", async () => {
    const ac = new AbortController();
    ac.abort("synthetic abort");
    await expect(
      provisionAgentCredentials({
        provider: pi("synthetic"),
        sandboxTag: "none",
        credentialHandle: undefined,
        signal: ac.signal,
      }),
    ).rejects.toBe("synthetic abort");
  });
});
