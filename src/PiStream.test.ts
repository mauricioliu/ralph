import { describe, expect, it } from "vitest";
import { pi } from "./AgentProvider.js";

const provider = pi("synthetic-model", { captureSessions: false });
const parse = (event: unknown) =>
  provider.parseStreamLine(JSON.stringify(event));
const marker = "<promise>COMPLETE</promise>";
const assistant = (content: unknown = [], stopReason = "stop") => ({
  role: "assistant",
  content,
  stopReason,
});

describe("Pi terminal stream events", () => {
  it.each(["error", "aborted"])(
    "rejects assistant stopReason %s before reading its text",
    (stopReason) => {
      const message = {
        ...assistant([{ type: "text", text: marker }], stopReason),
        errorMessage: "synthetic provider failure",
      };
      for (const event of [
        { type: "message_end", message },
        { type: "agent_end", messages: [message] },
      ]) {
        expect(parse(event)).toEqual([
          { type: "error", message: "synthetic provider failure" },
        ]);
      }
    },
  );

  it.each(["error", "aborted"])(
    "supplies a diagnostic for an assistant %s without an error message",
    (stopReason) => {
      expect(
        parse({
          type: "message_end",
          message: { ...assistant([], stopReason), errorMessage: "  " },
        }),
      ).toEqual([{ type: "error", message: `Pi assistant ${stopReason}` }]);
    },
  );

  it.each([undefined, "", "  ", { message: "not a string" }])(
    "keeps exhausted retries as errors without a usable finalError: %j",
    (finalError) => {
      expect(
        parse({ type: "auto_retry_end", success: false, finalError }),
      ).toEqual([{ type: "error", message: "Pi retries exhausted" }]);
    },
  );

  it("retains the final retry diagnostic and does not treat successful retry bookkeeping as output", () => {
    expect(
      parse({
        type: "auto_retry_end",
        success: false,
        finalError: "synthetic quota exhausted",
      }),
    ).toEqual([{ type: "error", message: "synthetic quota exhausted" }]);
    expect(parse({ type: "auto_retry_end", success: true })).toEqual([]);
  });

  it.each([
    { type: "message_start", message: assistant() },
    { type: "auto_retry_start", attempt: 1 },
  ])("invalidates prior output on $type", (event) => {
    expect(parse(event)).toEqual([{ type: "output_reset" }]);
  });

  it("takes only the last assistant result, even when empty or followed by tools", () => {
    expect(
      parse({
        type: "agent_end",
        messages: [
          assistant([{ type: "text", text: marker }]),
          assistant([
            { type: "thinking", thinking: marker },
            null,
            { type: "toolCall", name: marker },
          ]),
          { role: "toolResult", content: [{ type: "text", text: marker }] },
        ],
      }),
    ).toEqual([{ type: "result", result: "" }]);
  });

  it.each([undefined, null, "not blocks", []])(
    "accepts empty or missing assistant content as an authoritative empty result: %j",
    (content) => {
      expect(
        parse({ type: "message_end", message: { role: "assistant", content } }),
      ).toEqual([{ type: "result", result: "" }]);
    },
  );

  it.each(["user", "toolResult"])(
    "never parses %s messages as assistant output",
    (role) => {
      const message = { role, content: [{ type: "text", text: marker }] };
      expect(parse({ type: "message_start", message })).toEqual([]);
      expect(parse({ type: "message_end", message })).toEqual([]);
      expect(
        parse({
          type: "message_update",
          message,
          assistantMessageEvent: { type: "text_delta", delta: marker },
        }),
      ).toEqual([]);
      expect(parse({ type: "agent_end", messages: [message] })).toEqual([]);
    },
  );

  it("opts out of raw stdout as a completion or structured-output source", () => {
    expect(provider.parsedOutputOnly).toBe(true);
  });

  it("rejects unsupported Pi session forks rather than silently resuming in place", () => {
    expect(() =>
      provider.buildPrintCommand({
        prompt: "synthetic prompt",
        dangerouslySkipPermissions: true,
        resumeSession: "synthetic-session",
        forkSession: true,
      }),
    ).toThrow("Pi session fork is not supported");
  });
});
