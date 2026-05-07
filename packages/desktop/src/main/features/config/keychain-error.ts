import { ORPCError } from "@orpc/server";

import { KEYCHAIN_UNAVAILABLE_KIND } from "../../../shared/features/config/types";
import { KeychainUnavailableError } from "./config-store";

export { KEYCHAIN_UNAVAILABLE_KIND };

/**
 * Re-throw `err` after converting any {@link KeychainUnavailableError} into a
 * typed ORPCError the renderer can identify. Anything else propagates with its
 * original stack so unexpected throws stay debuggable.
 *
 * `defined: true` keeps the error on the contract surface in production builds.
 *
 * Usage in router handlers:
 *
 *     try {
 *       return context.configStore.getProviders();
 *     } catch (err) {
 *       wrapKeychainError(err);
 *     }
 */
export function wrapKeychainError(err: unknown): never {
  if (err instanceof KeychainUnavailableError) {
    throw new ORPCError("FAILED_PRECONDITION", {
      defined: true,
      message: err.message,
      data: { kind: KEYCHAIN_UNAVAILABLE_KIND },
    });
  }
  throw err;
}
