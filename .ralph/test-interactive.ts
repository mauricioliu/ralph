import * as ralph from "@mauricioliu/ralph";
const { commits, branch } = await ralph.interactive({
  branchStrategy: {
    type: "merge-to-head",
  },
  name: "Test",
  agent: ralph.pi("zai-coding-cn/glm-5.3:high"),
  prompt: "Add /foobar to the .gitignore, then commit.",
  copyToWorktree: ["node_modules"],
});

console.log("Commits:", commits);
console.log("Branch:", branch);
