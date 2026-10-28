// Run after build. Installs only a local tarball and cached dependencies;
// never executes a scaffold, agent, container, provider, or publishing command.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const zod = JSON.parse(
  await readFile(join(root, "node_modules/zod/package.json"), "utf8"),
);
const temp = await mkdtemp(join(tmpdir(), "ralph-package-smoke-"));
const fixture = join(temp, "consumer");
const home = join(temp, "home");
const env = {
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  HOME: home,
  USERPROFILE: home,
  CI: "true",
  NO_COLOR: "1",
  // npm ci populates this cache. Isolate config/auth from the user's home.
  npm_config_cache: process.env.npm_config_cache ?? join(homedir(), ".npm"),
  npm_config_userconfig: join(home, ".npmrc"),
  npm_config_globalconfig: join(home, "global.npmrc"),
};
const exec = (command, args, cwd) =>
  execFileSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 60_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
const npm = (args, cwd) =>
  process.env.npm_execpath
    ? exec(process.execPath, [process.env.npm_execpath, ...args], cwd)
    : exec("npm", args, cwd);

try {
  await mkdir(fixture);
  await mkdir(home);
  await writeFile(env.npm_config_userconfig, "");
  await writeFile(env.npm_config_globalconfig, "");
  const [pack] = JSON.parse(
    npm(
      [
        "pack",
        "--offline",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        temp,
      ],
      root,
    ),
  );
  assert.equal(pack.name, "@mauricioliu/ralph");
  assert.equal(pack.version, pkg.version);
  const files = new Set(pack.files.map((file) => file.path));
  for (const entry of Object.values(pkg.exports)) {
    for (const target of Object.values(entry)) {
      assert(
        files.has(target.replace(/^\.\//, "")),
        `Missing export ${target}`,
      );
    }
  }
  assert(files.has(pkg.bin.ralph));
  assert(files.has("LICENSE"));
  assert(files.has("README.md"));
  assert(
    ![...files].some((file) => /^(src|\.ralph|\.sandcastle)\//.test(file)),
  );

  await writeFile(
    join(fixture, "package.json"),
    JSON.stringify({
      name: "ralph-smoke-consumer",
      private: true,
      type: "module",
    }),
  );
  npm(
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--legacy-peer-deps",
      "--no-audit",
      "--no-fund",
      join(temp, pack.filename),
      `zod@${zod.version}`,
    ],
    fixture,
  );
  const installed = join(fixture, "node_modules/@mauricioliu/ralph");
  const installedPkg = JSON.parse(
    await readFile(join(installed, "package.json"), "utf8"),
  );
  assert.deepEqual(installedPkg.exports, pkg.exports);
  assert.deepEqual(installedPkg.bin, { ralph: "dist/main.js" });
  const bins = await readdir(join(fixture, "node_modules/.bin"));
  assert(bins.includes("ralph") || bins.includes("ralph.cmd"));
  assert(!bins.some((bin) => bin.startsWith("sandcastle")));
  const cli = join(installed, pkg.bin.ralph);
  assert((await readFile(cli, "utf8")).startsWith("#!/usr/bin/env node"));
  const installedBin =
    process.platform === "win32"
      ? cli
      : join(fixture, "node_modules/.bin/ralph");
  const version = exec(process.execPath, [installedBin, "--version"], fixture);
  assert.equal(
    version.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").trim(),
    pkg.version,
  );
  const help = exec(process.execPath, [cli, "--help"], fixture);
  assert(help.includes("ralph"));
  assert(!help.includes("sandcastle"));

  // Execute only synthetic entry points, never a generated agent workflow.
  for (const extension of ["ts", "mts"]) {
    const cwd = join(fixture, `run-${extension}`);
    await mkdir(join(cwd, ".ralph"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ type: extension === "ts" ? "module" : "commonjs" }),
    );
    await writeFile(
      join(cwd, `.ralph/main.${extension}`),
      'const value: string = "PACKAGED_RUN_OK"; console.log(value);',
    );
    assert(
      exec(process.execPath, [installedBin, "run"], cwd).includes(
        "PACKAGED_RUN_OK",
      ),
    );
  }

  const runtimeExports = [
    "run",
    "interactive",
    "createSandbox",
    "createWorktree",
    "CwdError",
    "CredentialProvisionError",
    "StructuredOutputError",
    "claudeCode",
    "codex",
    "copilot",
    "cursor",
    "opencode",
    "pi",
    "transferClaudeSession",
    "transferCodexSession",
    "encodeProjectPath",
    "claudeHostSessionPath",
    "claudeSandboxSessionPath",
    "findClaudeSessionOnHost",
    "findCodexSessionOnHost",
    "createBindMountSandboxProvider",
    "createIsolatedSandboxProvider",
  ];
  const imports = `
    import assert from 'node:assert/strict';
    const api = await import('@mauricioliu/ralph');
    for (const name of ${JSON.stringify(runtimeExports)}) assert.equal(typeof api[name], 'function', name);
    assert.equal(typeof api.Output.object, 'function');
    assert.deepEqual(Object.keys(api).sort(), ${JSON.stringify([...runtimeExports, "Output"].sort())});
    for (const name of ['docker', 'podman', 'vercel', 'daytona', 'no-sandbox']) {
      const provider = await import('@mauricioliu/ralph/sandboxes/' + name);
      assert.equal(typeof provider[name === 'no-sandbox' ? 'noSandbox' : name], 'function');
    }
  `;
  exec(process.execPath, ["--input-type=module", "-e", imports], fixture);

  const templates = [
    "blank",
    "simple-loop",
    "sequential-reviewer",
    "parallel-planner",
    "parallel-planner-with-review",
  ];
  const publicApiFixture = join(fixture, "credentials.ts");
  await writeFile(
    publicApiFixture,
    `
    import { CredentialProvisionError, pi, type CredentialSandboxHandle, type AgentProvider } from '@mauricioliu/ralph';
    const error: Error = new CredentialProvisionError({ message: 'synthetic', hostPath: '/fixture/auth.json' });
    const agent: AgentProvider = pi('fixture', {
      credentials: { hostAgentDir: '/fixture/host', sandboxAgentDir: '/fixture/sandbox' },
    });
    async function provision(handle: CredentialSandboxHandle, signal: AbortSignal) {
      await agent.provisionCredentials?.({ handle, signal });
    }
    void error; void provision;
  `,
  );
  const mains = [publicApiFixture];
  const scenarios = [
    { name: "pi-default", agent: "pi", factory: "pi" },
    {
      name: "pi-override",
      agent: "pi",
      factory: "pi",
      model: "fixture-provider/fixture-model",
    },
    {
      name: "claude",
      agent: "claude-code",
      factory: "claudeCode",
      defaultModel: "claude-opus-4-8",
      key: "CLAUDE_CODE_OAUTH_TOKEN=",
    },
    {
      name: "codex",
      agent: "codex",
      factory: "codex",
      defaultModel: "gpt-5.4",
      key: "CODEX_API_KEY=",
    },
    {
      name: "cursor",
      agent: "cursor",
      factory: "cursor",
      defaultModel: "composer-2",
      key: "CURSOR_API_KEY=",
    },
    {
      name: "opencode",
      agent: "opencode",
      factory: "opencode",
      defaultModel: "opencode/big-pickle",
      key: "OPENCODE_API_KEY=",
    },
    {
      name: "copilot",
      agent: "copilot",
      factory: "copilot",
      defaultModel: "claude-sonnet-4.5",
      key: "GITHUB_TOKEN=",
    },
  ];
  for (const scenario of scenarios) {
    for (const type of ["module", "commonjs"]) {
      for (const [i, template] of templates.entries()) {
        const cwd = join(fixture, `${template}-${type}-${scenario.name}`);
        await mkdir(cwd);
        await writeFile(
          join(cwd, "package.json"),
          JSON.stringify({ private: true, type }),
        );
        const sandbox = i % 2 === 0 ? "docker" : "podman";
        exec(
          process.execPath,
          [
            cli,
            "init",
            "--agent",
            scenario.agent,
            ...(scenario.model === undefined
              ? []
              : ["--model", scenario.model]),
            "--template",
            template,
            "--sandbox",
            sandbox,
            "--issue-tracker",
            "github-issues",
            "--create-label",
            "false",
            "--build-image",
            "false",
            "--install-template-deps",
            "false",
          ],
          cwd,
        );
        assert(!(await readdir(cwd)).includes(".sandcastle"));
        const configDir = join(cwd, ".ralph");
        const main = join(
          configDir,
          type === "module" ? "main.ts" : "main.mts",
        );
        mains.push(main);
        const source = await readFile(main, "utf8");
        assert(source.includes('"@mauricioliu/ralph"'));
        assert(source.includes(`"@mauricioliu/ralph/sandboxes/${sandbox}"`));
        const calls = [
          ...source.matchAll(/\bagent:\s*(?:ralph\.)?(\w+)\("([^"]+)"\)/g),
        ];
        assert.equal(calls.length, [1, 1, 2, 3, 4][i]);
        for (const [callIndex, call] of calls.entries()) {
          assert.equal(call[1], scenario.factory);
          const expectedModel =
            scenario.model ??
            scenario.defaultModel ??
            (template.startsWith("parallel-planner") && callIndex === 0
              ? "openai-codex/gpt-6-astra:high"
              : "zai-coding-cn/glm-5.3:high");
          assert.equal(call[2], expectedModel);
        }
        const envExample = await readFile(
          join(configDir, ".env.example"),
          "utf8",
        );
        if (scenario.key) assert(envExample.includes(scenario.key));
        if (scenario.agent === "codex")
          assert(!envExample.includes("OPENAI_KEY="));
        if (scenario.agent === "claude-code") {
          assert(envExample.includes("claude setup-token"));
          assert(envExample.includes("# ANTHROPIC_API_KEY="));
        }
        if (scenario.agent === "pi") {
          assert(!/^[A-Z_]*API_KEY=/m.test(envExample));
          assert(envExample.includes("/login"));
          const imageSource = await readFile(
            join(
              configDir,
              sandbox === "docker" ? "Dockerfile" : "Containerfile",
            ),
            "utf8",
          );
          assert(imageSource.includes("@earendil-works/pi-coding-agent"));
          assert(!imageSource.includes("@mariozechner/pi-coding-agent"));
        }
        for (const name of await readdir(configDir)) {
          const contents = await readFile(join(configDir, name), "utf8");
          assert(
            !/sandcastle/i.test(contents),
            `${template}/${name} has a stale namespace`,
          );
        }
        const configFiles = await readdir(configDir);
        assert(
          configFiles.includes(
            sandbox === "docker" ? "Dockerfile" : "Containerfile",
          ),
        );
        assert(!configFiles.includes(".env"));
      }
    }
  }
  // Compile, don't import/execute, the generated entry points. Resolve their
  // public declarations from the installed tarball and host-only Node types.
  const program = ts.createProgram(mains, {
    noEmit: true,
    strict: true,
    skipLibCheck: false,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: ["node"],
    typeRoots: [join(root, "node_modules/@types")],
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => fixture,
      getCanonicalFileName: (name) => name,
      getNewLine: () => "\n",
    }),
  );
  console.log(
    `PASS @mauricioliu/ralph@${pkg.version}: offline tarball installation, CLI, all public imports, credential API types, 70 compiled scaffolds (Pi defaults/override and all alternate agents); no agent/provider execution.`,
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
