import express from "express";

/**
 * Builds and configures the Express application.
 *
 * Why a factory function instead of creating the app at module top-level?
 * Because our tests (Phase 8) need to spin up a fresh app instance without
 * starting a real network server. Separating "build the app" (here) from
 * "start listening" (index.ts) is what makes that possible.
 */
export function createApp() {
  const app = express();

  // Parse incoming JSON request bodies and expose them as req.body.
  app.use(express.json());

  // Temporary liveness route so we can confirm the server runs.
  // The real /health and /ready endpoints arrive in Phase 6.
  app.get("/", (_req, res) => {
    res.json({ status: "ok", service: "link-shortener" });
  });

  return app;
}
