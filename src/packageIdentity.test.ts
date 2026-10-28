import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFile(join(root, path), "utf8");

describe("Ralph distribution identity", () => {
  it("keeps the package, lockfile, CLI and scripts in one namespace/version", async () => {
    const pkg = JSON.parse(await read("package.json"));
    const lock = JSON.parse(await read("package-lock.json"));
    expect(pkg.name).toBe("@mauricioliu/ralph");
    expect(pkg.bin).toEqual({ ralph: "dist/main.js" });
    expect(pkg.repository.url).toBe("https://github.com/mauricioliu/ralph");
    expect(lock.name).toBe(pkg.name);
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[""].name).toBe(pkg.name);
    expect(lock.packages[""].version).toBe(pkg.version);
    expect(lock.packages[""].bin).toEqual(pkg.bin);
    expect(pkg.dependencies["@standard-schema/spec"]).toBe("^1.1.0");
    expect(lock.packages[""].dependencies).toEqual(pkg.dependencies);
    expect(
      lock.packages["node_modules/@standard-schema/spec"].dev,
    ).toBeUndefined();
    expect(pkg.scripts.ralph).toBe("npm run build && tsx .ralph/run.ts");
    expect(JSON.stringify(pkg)).not.toContain("sandcastle");
    expect(Object.keys(pkg.exports)).toEqual([
      ".",
      "./sandboxes/docker",
      "./sandboxes/vercel",
      "./sandboxes/podman",
      "./sandboxes/daytona",
      "./sandboxes/no-sandbox",
    ]);
  });

  it("discovers configuration-owned tests under .ralph without executing them or legacy tests", async () => {
    // createVitest + globTestSpecifications only: never startVitest/runFiles,
    // collectTests, a workflow entry point, or another test runner recursively.
    const discover = async (directory: string): Promise<string[]> => {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import { createVitest } from "vitest/node";
const ctx = await createVitest("test", { root: process.argv[1], config: process.argv[2], watch: false });
try { console.log(JSON.stringify((await ctx.globTestSpecifications()).map(spec => spec.moduleId))); }
finally { await ctx.close(); }`,
          directory,
          join(root, "vitest.config.ts"),
        ],
        { cwd: root, timeout: 15_000 },
      );
      return (JSON.parse(stdout) as string[])
        .map((path) => relative(directory, path).replace(/\\/g, "/"))
        .sort();
    };
    const paths = await discover(root);
    const expected = (await readdir(join(root, ".ralph"), { recursive: true }))
      .filter((path) => path.endsWith(".test.ts"))
      .map((path) => `.ralph/${path.replace(/\\/g, "/")}`)
      .sort();
    expect(expected).toContain(".ralph/agent-workflows/explore/batch.test.ts");
    expect(paths.filter((path) => path.startsWith(".ralph/"))).toEqual(
      expected,
    );
    expect(paths.some((path) => path.startsWith(".sandcastle/"))).toBe(false);

    const fixture = await mkdtemp(join(tmpdir(), "ralph-discovery-"));
    try {
      for (const namespace of [".ralph", ".sandcastle"]) {
        await mkdir(join(fixture, namespace));
        await writeFile(
          join(fixture, namespace, "probe.test.ts"),
          'throw new Error("Discovery must never execute this file");',
        );
      }
      expect(await discover(fixture)).toEqual([".ralph/probe.test.ts"]);
      // A harmless describe-title change cannot affect discovery. Even an
      // invalid test module above is safe because discovery doesn't import it.
      await writeFile(
        join(fixture, ".ralph", "probe.test.ts"),
        'describe("a renamed suite", () => { throw new Error("Must not execute"); });',
      );
      expect(await discover(fixture)).toEqual([".ralph/probe.test.ts"]);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  }, 20_000);

  it("retains upstream attribution and historical release notes", async () => {
    expect(await read("LICENSE")).toContain("Copyright (c) 2026 Matt Pocock");
    expect(await read("CHANGELOG.md")).toContain("Sandcastle");
    const readme = await read("README.md");
    expect(readme).toContain("https://github.com/mattpocock/sandcastle");
    expect(readme).toContain("a53e227250fb51df0ad54155b85fecc1c090c937");
    expect(readme).toContain("@mauricioliu/ralph");
  });
});

describe("upstream PR workflow security survives the namespace change", () => {
  it.each(["agent-review", "agent-implement-pr"])(
    "%s uses the unprivileged fork-safe PR event and exact head SHA",
    async (name) => {
      const workflow = await read(`.github/workflows/${name}.yml`);
      expect(workflow).toMatch(/^  pull_request:\n    types: \[labeled\]/m);
      expect(workflow).not.toMatch(/^  pull_request_target:/m);
      expect(workflow).toContain(
        "ref: ${{ github.event.pull_request.head.sha }}",
      );
      expect(workflow).toContain(
        `npx tsx .ralph/agent-workflows/with-pi-auth.ts .ralph/agent-workflows/${name.slice("agent-".length)}/${name.slice("agent-".length)}.ts`,
      );
      expect(workflow).not.toContain(".sandcastle");
    },
  );

  it("retains the same-repository guard on privileged conflict updates", async () => {
    const workflow = await read(".github/workflows/agent-update-branch.yml");
    expect(workflow).toMatch(
      /^  pull_request_target:\n    types: \[labeled\]/m,
    );
    const [beforeSteps] = workflow.split("    steps:");
    expect(beforeSteps).toContain(
      "github.event.pull_request.head.repo.full_name == github.repository",
    );
    expect(beforeSteps).toContain(
      "github.event.label.name == 'agent:update-branch'",
    );
    expect(workflow).toContain(
      "ref: ${{ github.event.pull_request.head.sha }}",
    );
    expect(workflow).toContain(
      "npx tsx .ralph/agent-workflows/with-pi-auth.ts .ralph/agent-workflows/update-branch/update-branch.ts",
    );
  });
});
