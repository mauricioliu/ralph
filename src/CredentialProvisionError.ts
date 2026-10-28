import { CredentialProvisionError as Impl } from "./errors.js";

/** Public Effect-free shape of the runtime tagged credential error. */
export interface CredentialProvisionError extends Error {
  readonly _tag: "CredentialProvisionError";
  readonly message: string;
  readonly hostPath?: string;
}

interface CredentialProvisionErrorConstructor {
  new (args: {
    readonly message: string;
    readonly hostPath?: string;
  }): CredentialProvisionError;
  readonly prototype: CredentialProvisionError;
}

/** Failed one-way credential provisioning; authenticate on the host or check sandbox capabilities. */
export const CredentialProvisionError: CredentialProvisionErrorConstructor =
  Impl as unknown as CredentialProvisionErrorConstructor;
