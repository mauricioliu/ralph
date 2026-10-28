import * as ralph from "@mauricioliu/ralph";
import { vercel } from "@mauricioliu/ralph/sandboxes/vercel";

const piInstallHook = {
  command: "npm install -g @earendil-works/pi-coding-agent",
  sudo: true,
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
  agent: ralph.pi("zai-coding-cn/glm-5.3:high"),
  prompt: "Add /foobar to the .gitignore, then commit.",
  hooks: {
    sandbox: {
      onSandboxReady: [
        piInstallHook,
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
