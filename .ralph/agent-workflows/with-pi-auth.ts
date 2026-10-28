import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { withPiAuth } from "./shared/pi-auth";

const script = process.argv[2];
if (!script) throw new Error("Pass a workflow script path.");

await withPiAuth(() => import(pathToFileURL(resolve(script)).href));
