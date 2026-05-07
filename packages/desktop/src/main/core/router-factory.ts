/**
 * Router factory — eliminate boilerplate across feature routers.
 *
 * Each feature router previously duplicated the same skeleton:
 *   - `const log = debug("neovate:<feature>")`
 *   - `const os = implement({ <feature>: contract }).$context<AppContext>()`
 *   - a `wrapError` helper that throws ORPCError BAD_GATEWAY (or BAD_REQUEST)
 *
 * `defineRouter` consolidates the shared shape so handlers can focus on
 * domain logic. Returns `{ os, log, wrapError }` with full type information
 * preserved through the contract generic.
 *
 * @example
 *   const { os, wrapError } = defineRouter({
 *     contract: { storage: storageContract },
 *     debugNs: "neovate:storage",
 *   });
 *   export const storageRouter = os.storage.router({ ... });
 */

import type { AnyContractRouter } from "@orpc/contract";

import { ORPCError, implement } from "@orpc/server";
import debug from "debug";

import type { AppContext } from "../router";

/**
 * ORPCError codes used by feature routers. Restricted to the small set
 * needed today; expand on demand.
 */
export type RouterErrorCode = "BAD_REQUEST" | "BAD_GATEWAY" | "INTERNAL_SERVER_ERROR";

interface BaseDefineRouterOptions<C extends AnyContractRouter> {
  /** Contract object passed to `implement()`. Usually `{ key: featureContract }`. */
  contract: C;
  /** debug namespace, e.g. "neovate:storage". Defaults to "neovate:router". */
  debugNs?: string;
  /** Default fallback message when wrapError receives a non-Error value. */
  fallbackError?: string;
  /** ORPCError code thrown by wrapError. Defaults to "BAD_GATEWAY". */
  errorCode?: RouterErrorCode;
}

export type DefineRouterOptions<C extends AnyContractRouter> = BaseDefineRouterOptions<C>;

export interface DefinedRouter<TOs> {
  /** Implementer instance bound to `AppContext`. */
  os: TOs;
  /** Pre-configured debug logger. */
  log: debug.Debugger;
  /**
   * Throws an ORPCError with the configured code. Logs the message via `log`
   * before throwing so production builds (where stack traces are stripped)
   * still surface the cause.
   */
  wrapError: (e: unknown, fallback?: string) => never;
}

/**
 * Standard router factory: contract is implemented and bound to `AppContext`.
 * Use this for any router whose handlers read from `context`.
 */
export function defineRouter<C extends AnyContractRouter>(
  opts: DefineRouterOptions<C>,
): DefinedRouter<ReturnType<typeof contextualImplement<C>>> {
  const log = debug(opts.debugNs ?? "neovate:router");
  const os = contextualImplement(opts.contract);
  return { os, log, wrapError: makeWrapError(log, opts) };
}

/**
 * Variant for routers that do NOT consume `AppContext` (e.g. stats, which
 * uses a singleton service). Returns the implementer without `$context`
 * binding so that direct, non-nested `implement(contract.X)` form works.
 */
export function defineRouterNoContext<C extends AnyContractRouter>(
  opts: DefineRouterOptions<C>,
): DefinedRouter<ReturnType<typeof flatImplement<C>>> {
  const log = debug(opts.debugNs ?? "neovate:router");
  const os = flatImplement(opts.contract);
  return { os, log, wrapError: makeWrapError(log, opts) };
}

function contextualImplement<C extends AnyContractRouter>(contract: C) {
  return implement(contract).$context<AppContext>();
}

function flatImplement<C extends AnyContractRouter>(contract: C) {
  return implement(contract);
}

function makeWrapError<C extends AnyContractRouter>(
  log: debug.Debugger,
  opts: BaseDefineRouterOptions<C>,
) {
  const fallbackError = opts.fallbackError ?? "Internal error";
  const errorCode: RouterErrorCode = opts.errorCode ?? "BAD_GATEWAY";

  return (e: unknown, fallback?: string): never => {
    const message = e instanceof Error ? e.message : (fallback ?? fallbackError);
    log("handler error: %s", message);
    throw new ORPCError(errorCode, { defined: true, message });
  };
}
