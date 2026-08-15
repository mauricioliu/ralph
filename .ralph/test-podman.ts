import * as ralph from "@mauricioliu/ralph";
import { podman } from "@mauricioliu/ralph/sandboxes/podman";

const { commits, branch } = await ralph.run({
  sandbox: podman(),
  name: "Test",
  agent: ralph.claudeCode("claude-sonnet-4-6"),
  prompt: "Add /foobar to the .gitignore, then commit.",
  hooks: {
    sandbox: {
      onSandboxReady: [
        {
          command: "npm install && npm run build",
        },
      ],
    },
  },
});

console.log("Commits:", commits);
console.log("Branch:", branch);
