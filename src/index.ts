import { createApp } from "./app.js";
import { logger } from "./utils/logger.js";
import { env } from "./config/env.js";
import { prisma } from "./config/db.js";
import { redis } from "./config/redis.js";
import { startClickFlush } from "./services/clickTracker.service.js";


async function main() {
  // Fail fast: open the DB connection before we accept any traffic.
  await prisma.$connect();
  logger.info("Connected to Postgres (Prisma)");

  // Fail fast on Redis too — PING returns "PONG" from a healthy server.
  await redis.ping();
  logger.info("Connected to Redis");

  // Start the background job that flushes buffered click counts to Postgres.
  startClickFlush();

  const app = createApp();

  app.listen(env.PORT, () => {
    logger.info(`Server listening on http://localhost:${env.PORT}`);
  });
}

main().catch((err) => {
  logger.error({ err }, "Failed to start the application");
  process.exit(1);
});
