import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { logger } from "@/utils/logger";
import { requestContext } from "@/utils/requestContext";

/**
 * Assigns a correlation id to each request and logs its start and completion.
 * Everything downstream runs inside requestContext.run(), so the reqId flows
 * (via AsyncLocalStorage) into every log line the request produces.
 */
export const requestLogger: RequestHandler = (req, res, next) => {
  // Honor an incoming X-Request-Id (e.g. from an API gateway) or mint a new one.
  const reqId = req.header("x-request-id") ?? randomUUID();
  res.setHeader("X-Request-Id", reqId);

  requestContext.run({ reqId }, () => {
    // (hrtime.bigint() is a high-precision nanosecond clock
    const startNs = process.hrtime.bigint();
    logger.info(
      { method: req.method, url: req.originalUrl },
      "request received",
    );

    res.on("finish", () => {
      const durationMs = Math.round(
        Number(process.hrtime.bigint() - startNs) / 1e6,
      );
      logger.info(
        {
          method: req.method,
          url: req.originalUrl,
          status: res.statusCode,
          durationMs,
        },
        "request completed",
      );
    });

    next();
  });
};
