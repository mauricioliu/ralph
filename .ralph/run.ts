import { docker } from "../src/sandboxes/docker.js";
import { runDogfood } from "./workflow.js";

await runDogfood({ sandbox: docker(), cwd: process.cwd() });
