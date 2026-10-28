import type {
  InteractiveExecOptions,
  SandboxProvider,
} from "./SandboxProvider.js";
import { ExecError } from "./errors.js";

const quote = (s: string): string => "'" + s.replace(/'/g, "'\\''") + "'";
const assignments = (env: Record<string, string>): string[] =>
  Object.entries(env).map(([key, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
      throw new ExecError({
        command: "agent launch",
        message: "Invalid launch environment variable name.",
      });
    return `${key}=${value}`;
  });

/** Linux sandboxes use POSIX env regardless of host OS; host launches use native process env. */
export const preparePrintLaunch = (
  command: string,
  env: Record<string, string> | undefined,
  tag: SandboxProvider["tag"],
): { command: string; env?: Record<string, string> } => {
  if (!env || Object.keys(env).length === 0) return { command };
  if (tag === "none") return { command, env };
  return {
    command: `env ${assignments(env).map(quote).join(" ")} sh -c ${quote(command)}`,
  };
};

/** Keep directory values out of host shell syntax, including cmd.exe and npm wrappers. */
export const prepareInteractiveLaunch = (
  args: string[],
  options: InteractiveExecOptions,
  env: Record<string, string> | undefined,
  tag: SandboxProvider["tag"],
): [string[], InteractiveExecOptions] => {
  if (!env || Object.keys(env).length === 0) return [args, options];
  return tag === "none"
    ? [args, { ...options, env }]
    : [["env", ...assignments(env), ...args], options];
};
