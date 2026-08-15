import * as ralph from "@mauricioliu/ralph";
import { vercel } from "@mauricioliu/ralph/sandboxes/vercel";

const claudeInstallHook = {
  command: "curl -fsSL https://claude.ai/install.sh | bash",
};

const ghCliInstallHook = {
  command:
    "curl -fsSL https://cli.github.com/packages/rpm/gh-cli.repo -o /etc/yum.repos.d/gh-cli.repo && dnf install -y gh",
  sudo: true,
};

// /matt-pococks-projects/ralph
const { commits, branch } = await ralph.run({
  sandbox: vercel({
    token: process.env.VERCEL_OIDC_TOKEN,
    teamId: "matt-pococks-projects",
    projectId: "ralph",
  }),
  name: "Test",
  agent: ralph.claudeCode("claude-sonnet-4-6"),
  prompt: "Add /foobar to the .gitignore, then commit.",
  hooks: {
    sandbox: {
      onSandboxReady: [
        claudeInstallHook,
        ghCliInstallHook,
        {
          command: "npm install && npm run build",
        },
      ],
    },
  },
});

console.log("Commits:", commits);
console.log("Branch:", branch);
