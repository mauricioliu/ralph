import { Data, Effect, Either } from "effect";
import { CredentialProvisionError } from "./errors.js";
import type { AgentProvider } from "./AgentProvider.js";
import type {
  CredentialSandboxHandle,
  SandboxProvider,
} from "./SandboxProvider.js";

/** Internal cancellation channel; the Promise boundary restores the caller's reason. */
export class CredentialCancelled extends Data.TaggedError(
  "CredentialCancelled",
)<{}> {}

/** Cooperative cancellation never abandons an in-flight transport primitive. */
export const checkCredentialCancellation = (signal?: AbortSignal) =>
  Effect.suspend(() =>
    signal?.aborted ? Effect.fail(new CredentialCancelled()) : Effect.void,
  );

/** Thin Promise boundary: preserve typed failures and the public AbortSignal contract. */
export const runCredentialProgram = (
  program: Effect.Effect<void, CredentialProvisionError | CredentialCancelled>,
  signal?: AbortSignal,
): Promise<void> =>
  Effect.runPromise(Effect.either(program)).then((result) => {
    if (Either.isLeft(result)) {
      if (result.left._tag === "CredentialCancelled") signal?.throwIfAborted();
      throw result.left;
    }
  });

type ProvisionArgs = {
  readonly provider: AgentProvider;
  readonly sandboxTag: SandboxProvider["tag"];
  readonly credentialHandle: CredentialSandboxHandle | undefined;
  readonly signal?: AbortSignal;
};

const provisionProgram = ({
  provider,
  sandboxTag,
  credentialHandle,
  signal,
}: ProvisionArgs) =>
  Effect.gen(function* () {
    yield* checkCredentialCancellation(signal);
    if (!provider.provisionCredentials || sandboxTag === "none") return;
    if (!credentialHandle) {
      return yield* Effect.fail(
        new CredentialProvisionError({
          message:
            "Agent credentials require sandbox exec and host-to-sandbox file copy. Implement copyFileIn (bind-mount) or copyIn (isolated) before launching the agent.",
        }),
      );
    }
    yield* Effect.tryPromise({
      try: () =>
        provider.provisionCredentials!({ handle: credentialHandle, signal }),
      catch: (error) =>
        signal?.aborted
          ? new CredentialCancelled()
          : error instanceof CredentialProvisionError
            ? error
            : new CredentialProvisionError({
                message:
                  "Agent credential transfer failed. Check sandbox exec/copy support and destination access; authenticate again on the host if necessary.",
              }),
    });
    yield* checkCredentialCancellation(signal);
  }).pipe(Effect.uninterruptible);

/** Shared policy for all agent entry points. Only no-sandbox skips an opted-in provider. */
export const provisionAgentCredentials = (args: ProvisionArgs): Promise<void> =>
  runCredentialProgram(provisionProgram(args), args.signal);

/** Keep credential failures in Effect's typed error channel, not defects. */
export const provisionAgentCredentialsEffect = (
  args: ProvisionArgs,
): Effect.Effect<void, CredentialProvisionError> =>
  provisionProgram(args).pipe(
    Effect.catchTag("CredentialCancelled", () =>
      Effect.fail(
        new CredentialProvisionError({
          message:
            "Agent credential transfer interrupted; retry with a new signal.",
        }),
      ),
    ),
  );
