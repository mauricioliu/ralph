import * as ralph from "@mauricioliu/ralph";
import { noSandbox } from "@mauricioliu/ralph/sandboxes/no-sandbox";

// /matt-pococks-projects/ralph
const { commits, branch } = await ralph.interactive({
  branchStrategy: {
    type: "merge-to-head",
  },
  name: "Test",
  agent: ralph.claudeCode("claude-sonnet-4-6"),
  prompt: "Add /foobar to the .gitignore, then commit.",
  copyToWorktree: ["node_modules"],
});

console.log("Commits:", commits);
console.log("Branch:", branch);
