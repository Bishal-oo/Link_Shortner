import { Router } from "express";
import { prisma } from "@/config/db";
import { redis } from "@/config/redis";

export const healthRouter = Router();

/**
 * Liveness — "is the process up and serving?" Deliberately does NOT check
 * dependencies: an orchestrator uses this to decide whether to RESTART the
 * process, and you don't want a transient Redis blip to trigger restart loops.
 */
healthRouter.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

/**
 * Readiness — "can I actually serve traffic right now?" Checks Postgres AND
 * Redis. An orchestrator uses this to decide whether to route TRAFFIC to us;
 * a 503 pulls this instance out of rotation until its dependencies recover.
 */
healthRouter.get("/ready", async (_req, res) => {
  const checks = { postgres: false, redis: false };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.postgres = true;
  } catch {
    // leave false
  }

  try {
    await redis.ping();
    checks.redis = true;
  } catch {
    // leave false
  }

  const ready = checks.postgres && checks.redis;
  res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "not_ready",
    checks,
  });
});
