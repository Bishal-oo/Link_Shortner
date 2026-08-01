import type { Server } from "node:http";
import { createApp } from "./app.js";
import { logger } from "./utils/logger.js";
import { env } from "./config/env.js";
import { prisma } from "./config/db.js";
import { redis } from "./config/redis.js";
import {
  startClickFlush,
  stopClickFlush,
} from "./services/clickTracker.service.js";

async function main() {
  // Fail fast: verify both datastores before we accept any traffic.
  await prisma.$connect();
  logger.info("Connected to Postgres (Prisma)");

  await redis.ping();
  logger.info("Connected to Redis");

  // Start the background job that flushes buffered click counts to Postgres.
  startClickFlush();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`Server listening on http://localhost:${env.PORT}`);
  });

  registerShutdown(server);
}

/**
 * Graceful shutdown: on SIGTERM/SIGINT — stop accepting new requests, FLUSH the
 * click buffer (so no clicks are lost), close Postgres + Redis, then exit. A
 * hard timeout forces exit if any step hangs.
 */
function registerShutdown(server: Server): void {
  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return; // ignore repeated signals
    shuttingDown = true;
    logger.info({ signal }, "Graceful shutdown started");

    const forceExit = setTimeout(() => {
      logger.error("Shutdown timed out — forcing exit");
      process.exit(1);
    }, 10_000);
    forceExit.unref(); // don't keep the process alive just for this timer

    try {
      // 1. Stop accepting new connections; existing in-flight requests finish.
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      logger.info("HTTP server closed");

      // 2. Final flush of buffered clicks + stop the interval.
      await stopClickFlush();
      logger.info("Click buffer flushed");

      // 3. Close datastore connections.
      await prisma.$disconnect();
      await redis.quit();

      logger.info("Shutdown complete");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Error during shutdown");
      process.exit(1);
    }
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "Failed to start the application");
  process.exit(1);
});
