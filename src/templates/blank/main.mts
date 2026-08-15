import { run, claudeCode } from "@mauricioliu/ralph";
import { docker } from "@mauricioliu/ralph/sandboxes/docker";

// Blank template: customize this to build your own orchestration.
// Run this with: npx tsx .ralph/main.mts
// Or add to package.json scripts: "ralph": "npx tsx .ralph/main.mts"

await run({
  agent: claudeCode("claude-opus-4-7"),
  sandbox: docker(),
  promptFile: "./.ralph/prompt.md",
});
