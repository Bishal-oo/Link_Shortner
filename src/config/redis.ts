// ioredis is a CommonJS module. Under NodeNext ESM, import the class as a NAMED
// import: `import Redis from "ioredis"` resolves to the (non-constructable)
// module namespace, whereas `{ Redis }` gives the actual client class.
import { Redis } from "ioredis";
import { env } from "@/config/env";
import { logger } from "@/utils/logger";

/**
 * ONE shared Redis client for the whole app.
 *
 * ioredis maintains a single long-lived connection and pipelines commands over
 * it — so, like the Prisma client, we create exactly one instance and reuse it.
 */
export const redis = new Redis(env.REDIS_URL, {
  // Fail a command fast if Redis is momentarily unavailable rather than queueing
  // forever — a cache should never become a source of hangs.
  maxRetriesPerRequest: 3,
});

redis.on("error", (err) => {
  logger.error({ err }, "Redis client error");
});
