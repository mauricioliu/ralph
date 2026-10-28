import { Effect } from "effect";
import { CredentialProvisionError } from "./errors.js";
import type { AgentProvider } from "./AgentProvider.js";
import type {
  CredentialSandboxHandle,
  SandboxProvider,
} from "./SandboxProvider.js";

/** Shared policy for all agent entry points. Only no-sandbox skips an opted-in provider. */
export const provisionAgentCredentials = async (args: {
  readonly provider: AgentProvider;
  readonly sandboxTag: SandboxProvider["tag"];
  readonly credentialHandle: CredentialSandboxHandle | undefined;
  readonly signal?: AbortSignal;
}): Promise<void> => {
  const { provider, sandboxTag, credentialHandle, signal } = args;
  signal?.throwIfAborted();
  if (!provider.provisionCredentials || sandboxTag === "none") return;
  if (!credentialHandle) {
    throw new CredentialProvisionError({
      message:
        "Agent credentials require sandbox exec and host-to-sandbox file copy. Implement copyFileIn (bind-mount) or copyIn (isolated) before launching the agent.",
    });
  }
  try {
    await provider.provisionCredentials({ handle: credentialHandle, signal });
    signal?.throwIfAborted();
  } catch (error) {
    signal?.throwIfAborted();
    // Provider errors may include tokens, stdout, stderr or file contents.
    throw error instanceof CredentialProvisionError
      ? error
      : new CredentialProvisionError({
          message:
            "Agent credential transfer failed. Check sandbox exec/copy support and destination access; authenticate again on the host if necessary.",
        });
  }
};

/** Keep credential failures in Effect's typed error channel, not defects. */
export const provisionAgentCredentialsEffect = (
  args: Parameters<typeof provisionAgentCredentials>[0],
): Effect.Effect<void, CredentialProvisionError> =>
  Effect.tryPromise({
    try: () => provisionAgentCredentials(args),
    catch: (error) =>
      error instanceof CredentialProvisionError
        ? error
        : new CredentialProvisionError({
            message:
              "Agent credential transfer interrupted; retry with a new signal.",
          }),
  });
