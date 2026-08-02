import express from "express";
import { healthRouter } from "@/routes/health.routes";
import { urlRouter } from "@/routes/url.routes";
import { requestLogger } from "@/middlewares/requestLogger.middleware";
import { rateLimiter } from "@/middlewares/rateLimiter.middleware";
import { errorHandler } from "@/middlewares/errorHandler.middleware";
import { NotFoundError } from "@/errors/NotFoundError";

/**
 * Builds and configures the Express application (a factory, so tests can create
 * an instance without opening a network port).
 */
export function createApp() {
  const app = express();

  // Health/readiness probes come FIRST — before logging and rate limiting — so
  // monitoring traffic isn't logged as app requests nor throttled.
  app.use(healthRouter);

  // Correlation id + start/finish logging for every real request.
  app.use(requestLogger);

  // Rate limiting runs early so over-limit requests are rejected cheaply.
  app.use(rateLimiter);

  // Parse JSON request bodies into req.body.
  app.use(express.json());

  // Feature routes.
  app.use(urlRouter);

  // Any unmatched route → a consistent JSON 404 (via the error handler).
  app.use((req, _res, next) => {
    next(new NotFoundError(`Route ${req.method} ${req.path} not found`));
  });

  // Centralized error handler — MUST be registered last.
  app.use(errorHandler);

  return app;
}
