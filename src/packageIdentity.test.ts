import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

  it("discovers configuration-owned tests under .ralph", async () => {
    const config = await read("vitest.config.ts");
    expect(config).toContain('".ralph/**/*.test.ts"');
    expect(config).not.toContain(".sandcastle");
    expect(
      await read(".ralph/agent-workflows/explore/batch.test.ts"),
    ).toContain('describe("planEffects verdict labels"');
  });

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
        `npx tsx .ralph/agent-workflows/${name.slice("agent-".length)}/${name.slice("agent-".length)}.ts`,
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
      "npx tsx .ralph/agent-workflows/update-branch/update-branch.ts",
    );
  });
});
