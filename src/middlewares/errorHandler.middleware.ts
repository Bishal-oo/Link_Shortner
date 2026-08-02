import type { ErrorRequestHandler } from "express";
import { AppError } from "@/errors/AppError";
import { ValidationError } from "@/errors/ValidationError";
import { RateLimitError } from "@/errors/RateLimitError";
import { logger } from "@/utils/logger";

/**
 * The single place errors become HTTP responses. Registered LAST. Express 5
 * forwards any thrown/rejected error from any handler here automatically.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  // If the response already started, we can't change the status — defer to
  // Express's default handler to close the connection.
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof RateLimitError) {
    res.setHeader("Retry-After", err.retryAfter);
    res.status(err.statusCode).json({ error: err.code, message: err.message });
    return;
  }

  if (err instanceof ValidationError) {
    res.status(err.statusCode).json({
      error: err.code,
      message: err.message,
      details: err.details,
    });
    return;
  }

  if (err instanceof AppError) {
    // Any other expected error (NotFound, Conflict, Gone, …).
    res.status(err.statusCode).json({ error: err.code, message: err.message });
    return;
  }

  // Some libraries (e.g. express.json() on malformed JSON) throw errors that
  // carry a numeric status. Honor client-error statuses instead of masking them.
  const status =
    (err as { status?: number }).status ??
    (err as { statusCode?: number }).statusCode;
  if (typeof status === "number" && status >= 400 && status < 500) {
    res.status(status).json({
      error: "BadRequest",
      message: err instanceof Error ? err.message : "Bad request",
    });
    return;
  }

  // Unknown = unexpected / programmer bug. Log the full error, but return a
  // generic 500 so we never leak internals (stack traces, SQL) to the client.
  logger.error({ err }, "Unhandled error");
  res.status(500).json({
    error: "InternalServerError",
    message: "Something went wrong",
  });
};
