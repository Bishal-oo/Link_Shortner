import pino from "pino";
import { env } from "../config/env.js";
import { getReqId } from "./requestContext.js";

/**
 * The single shared pino logger.
 *
 * `mixin` runs on every log call and merges extra fields into the line. We use
 * it to auto-attach the current request's correlation id (read from
 * AsyncLocalStorage) to EVERY log — so a cache-miss log buried in a service is
 * stamped with the same reqId as the "request received" line, with no threading.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  mixin() {
    const reqId = getReqId();
    return reqId ? { reqId } : {};
  },
});
