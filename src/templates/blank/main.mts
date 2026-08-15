import { run, pi } from "@mauricioliu/ralph";
import { docker } from "@mauricioliu/ralph/sandboxes/docker";

// Blank template: customize this to build your own orchestration.
// Run this with: npx tsx .ralph/main.mts
// Or add to package.json scripts: "ralph": "npx tsx .ralph/main.mts"

await run({
  // The lone agent runs on the worker model (a lone agent is a worker).
  agent: pi("zai-coding-cn/glm-5.3:high"),
  sandbox: docker(),
  promptFile: "./.ralph/prompt.md",
});
