import express from "express";
import cors from "cors";
import { healthRouter } from "@/routes/health.routes";
import { urlRouter } from "@/routes/url.routes";
import { requestLogger } from "@/middlewares/requestLogger.middleware";
import { rateLimiter } from "@/middlewares/rateLimiter.middleware";
import { errorHandler } from "@/middlewares/errorHandler.middleware";
import { NotFoundError } from "@/errors/NotFoundError";
import cookieParser from "cookie-parser";
import { authRouter } from "@/routes/auth.routes";
/**
 * Builds and configures the Express application (a factory, so tests can create
 * an instance without opening a network port).
 */
export function createApp() {
  const app = express();

  // CORS FIRST — so the browser's cross-origin preflight (OPTIONS) and every
  // response carry the Access-Control-* headers, before rate limiting can
  // reject anything. `exposedHeaders` lets the frontend JS READ these custom
  // headers (browsers hide non-simple headers from fetch() unless listed here).
  app.use(
    cors({
      origin: "http://localhost:5173", 
       credentials: true,// the Vite dev server
      exposedHeaders: [
       
        "Retry-After",
        "RateLimit-Limit",
        "RateLimit-Remaining",
        "RateLimit-Reset",
      ],
    }),
  );

  // Health/readiness probes come FIRST — before logging and rate limiting — so
  // monitoring traffic isn't logged as app requests nor throttled.
  app.use(healthRouter);

  // Correlation id + start/finish logging for every real request.
  app.use(requestLogger);

  // Rate limiting runs early so over-limit requests are rejected cheaply.
  app.use(rateLimiter);

  // Parse JSON request bodies into req.body.
  app.use(express.json());

  // Before otheer reads req.cookies
  app.use(cookieParser())

  app.use(authRouter);

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
