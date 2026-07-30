import express from "express";
import { urlRouter } from "./routes/url.routes.js";


export function createApp() {
  const app = express();

  // Parse incoming JSON request bodies and expose them as req.body.
  app.use(express.json());

  // Feature routes
  app.use(urlRouter);

  // Temporary liveness route so we can confirm the server runs.
  // The real /health and /ready endpoints arrive in Phase 6.
  app.get("/", (_req, res) => {
    res.json({ status: "ok", service: "link-shortener" });
  });

  return app;
}
