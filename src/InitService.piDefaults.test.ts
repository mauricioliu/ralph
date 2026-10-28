import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import {
  getAgent,
  getIssueTracker,
  getNextStepsLines,
  getSandboxProvider,
  scaffold,
} from "./InitService.js";

const planner = "openai-codex/gpt-6-astra:high";
const worker = "zai-coding-cn/glm-5.3:high";
// Literal expectations, not derived from the registry/templates under test.
const roles = {
  blank: ["individual"],
  "simple-loop": ["worker"],
  "sequential-reviewer": ["implementer", "reviewer"],
  "parallel-planner": ["planner", "implementer", "merger"],
  "parallel-planner-with-review": [
    "planner",
    "implementer",
    "reviewer",
    "merger",
  ],
};
const agents = [
  ["pi", "pi", worker],
  ["claude-code", "claudeCode", "claude-opus-4-8"],
  ["codex", "codex", "gpt-5.4"],
  ["cursor", "cursor", "composer-2"],
  ["opencode", "opencode", "opencode/big-pickle"],
  ["copilot", "copilot", "claude-sonnet-4.5"],
] as const;

/** Inspect the generated source; never import/execute an orchestration template. */
function agentCalls(source: string) {
  const ast = ts.createSourceFile(
    "main.mts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const calls: { role: string; factory: string; model: string }[] = [];
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === "agent") {
      const call = node.initializer;
      if (!ts.isCallExpression(call)) throw new Error("Expected agent factory");
      const model = call.arguments[0];
      if (!model || !ts.isStringLiteral(model))
        throw new Error("Expected model literal");
      const name = ts.isObjectLiteralExpression(node.parent)
        ? node.parent.properties.find(
            (prop) =>
              ts.isPropertyAssignment(prop) &&
              prop.name.getText(ast) === "name",
          )
        : undefined;
      const role =
        name &&
        ts.isPropertyAssignment(name) &&
        ts.isStringLiteral(name.initializer)
          ? name.initializer.text
          : "individual";
      calls.push({
        role,
        factory: call.expression.getText(ast),
        model: model.text,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return calls;
}

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

const makeDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), "ralph-init-models-"));
  dirs.push(dir);
  return dir;
};

for (const sandbox of ["docker", "podman"]) {
  for (const type of ["module", "commonjs"]) {
    describe(`${sandbox}, ${type} scaffold model policy`, () => {
      for (const [templateName, expectedRoles] of Object.entries(roles)) {
        for (const [agentName, factory, defaultModel] of agents) {
          it.each([undefined, "fixture-provider/explicit:high"])(
            `${templateName}, ${agentName}, model=%s`,
            async (model) => {
              const dir = await makeDir();
              await writeFile(
                join(dir, "package.json"),
                JSON.stringify({ type }),
              );
              const { mainFilename } = await Effect.runPromise(
                scaffold(dir, {
                  agent: getAgent(agentName)!,
                  model,
                  templateName,
                  sandboxProvider: getSandboxProvider(sandbox),
                  createLabel: false,
                }).pipe(Effect.provide(NodeFileSystem.layer)),
              );
              expect(mainFilename).toBe(
                type === "module" ? "main.ts" : "main.mts",
              );
              const source = await readFile(
                join(dir, ".ralph", mainFilename),
                "utf8",
              );
              const namespace = ["blank", "simple-loop"].includes(templateName)
                ? ""
                : "ralph.";
              expect(agentCalls(source)).toEqual(
                expectedRoles.map((role) => ({
                  role,
                  factory: namespace + factory,
                  model:
                    model ??
                    (agentName === "pi" && role === "planner"
                      ? planner
                      : defaultModel),
                })),
              );
              expect(source).toContain(
                `from "@mauricioliu/ralph/sandboxes/${sandbox}"`,
              );
              expect(source).toContain(`sandbox: ${sandbox}()`);
              if (namespace === "")
                expect(source).toContain(`import { run, ${factory} }`);
              if (agentName !== "pi") expect(source).not.toMatch(/\bpi\(/);
              if (type === "module") expect(source).not.toContain("main.mts");
              if (sandbox === "podman") expect(source).not.toContain("docker");
              const files = await readdir(join(dir, ".ralph"));
              expect(files).toContain(
                sandbox === "podman" ? "Containerfile" : "Dockerfile",
              );
              expect(files).not.toContain(".env");
              expect(files).not.toContain("auth.json");
              expect(files).not.toContain("models-store.json");
            },
          );
        }
      }
    });
  }
}

describe("explicit Pi model contract", () => {
  it.each([worker, planner, 'fixture/quote"backslash\\dollar$&:high'])(
    "overrides every role even when the value is a default: %s",
    async (model) => {
      const dir = await makeDir();
      await Effect.runPromise(
        scaffold(dir, {
          agent: getAgent("pi")!,
          model,
          templateName: "parallel-planner-with-review",
        }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const source = await readFile(join(dir, ".ralph", "main.mts"), "utf8");
      expect(agentCalls(source).map((call) => call.model)).toEqual([
        model,
        model,
        model,
        model,
      ]);
    },
  );
});

describe("Pi authentication guidance", () => {
  for (const template of Object.keys(roles)) {
    it.each(["github-issues", "beads", "custom"])(
      `${template}, %s`,
      async (tracker) => {
        const dir = await makeDir();
        const agent = getAgent("pi")!;
        const issueTracker = getIssueTracker(tracker)!;
        await Effect.runPromise(
          scaffold(dir, {
            agent,
            templateName: template,
            issueTracker,
          }).pipe(Effect.provide(NodeFileSystem.layer)),
        );
        const env = await readFile(join(dir, ".ralph", ".env.example"), "utf8");
        const steps = getNextStepsLines(
          template,
          "main.mts",
          issueTracker,
          agent,
          "npm",
        ).join("\n");
        for (const text of [env, steps]) {
          expect(text).toContain("host");
          expect(text).toContain("/login");
          expect(text).toContain("openai-codex");
          expect(text).toContain("zai-coding-cn");
          expect(text).toContain("auth.json");
          expect(text).toContain("models-store.json");
          expect(text).toContain("PI_CODING_AGENT_DIR");
          expect(text).toContain("~/.pi/agent");
          expect(text).toContain("never copied back");
          expect(text).not.toMatch(
            /(?:ANTHROPIC|OPENAI|CODEX|ZAI_CODING_CN)_API_KEY=/,
          );
          expect(text).not.toContain("claude setup-token");
          expect(text).not.toContain("issues/191");
        }
        expect(
          env.split("\n").filter((line) => line && !line.startsWith("#")),
        ).toEqual(tracker === "github-issues" ? ["GH_TOKEN="] : []);
        if (tracker === "custom") {
          expect(steps).toContain(agent.setupCommand);
          expect(steps).not.toContain("npm run ralph");
        }
      },
    );
  }
});
