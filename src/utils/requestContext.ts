import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  reqId: string;
}

/**
 * Per-request context that propagates across async boundaries. Any code reached
 * from within `requestContext.run(...)` — controllers, services, repositories —
 * can read the current request's id without it being passed in as an argument.
 * This is how one correlation id ends up on every log line for a request.
 */
export const requestContext = new AsyncLocalStorage<RequestContext>();

/** The current request's correlation id, or undefined if outside a request. */
export function getReqId(): string | undefined {
  return requestContext.getStore()?.reqId;
}
