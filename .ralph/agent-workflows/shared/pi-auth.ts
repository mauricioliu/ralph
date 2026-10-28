import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const jsonObject = (value: string | undefined, name: string): string => {
  try {
    const parsed: unknown = JSON.parse(value ?? "");
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      Object.keys(parsed).length === 0
    )
      throw new Error();
    return value!;
  } catch {
    // JSON parse errors can include the input (credentials).
    throw new Error(
      `${name} must contain a non-empty JSON object; configure the Pi workflow secret.`,
    );
  }
};

/**
 * CI-only credential lifetime. Never falls back to a runner's existing auth.
 * The callback runs in-process; no agent or subprocess is started here.
 */
export async function withPiAuth<T>(operation: () => Promise<T>): Promise<T> {
  const auth = process.env.PI_AUTH_JSON;
  const models = process.env.PI_MODELS_STORE_JSON;
  delete process.env.PI_AUTH_JSON;
  delete process.env.PI_MODELS_STORE_JSON;

  const authJson = jsonObject(auth, "PI_AUTH_JSON");
  const modelsJson = models
    ? jsonObject(models, "PI_MODELS_STORE_JSON")
    : undefined;
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  let dir: string | undefined;
  const cleanup = () => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  };
  try {
    try {
      dir = mkdtempSync(join(tmpdir(), "ralph-ci-pi-"));
      chmodSync(dir, 0o700);
      writeFileSync(join(dir, "auth.json"), authJson, {
        mode: 0o600,
        flag: "wx",
      });
      if (modelsJson) {
        writeFileSync(join(dir, "models-store.json"), modelsJson, {
          mode: 0o600,
          flag: "wx",
        });
      }
    } catch {
      throw new Error("Unable to stage private Pi workflow credentials.");
    }
    process.env.PI_CODING_AGENT_DIR = dir;
    // Existing workflow fail() paths call process.exit(), which bypasses finally.
    process.once("exit", cleanup);
    return await operation();
  } finally {
    process.removeListener("exit", cleanup);
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    cleanup();
  }
}
