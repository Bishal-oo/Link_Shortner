import { redis } from "@/config/redis";
import { env } from "@/config/env";
import { logger } from "@/utils/logger";
import { redisSafe } from "@/utils/redisSafe";
import { addClicks } from "@/repositories/url.repository";
import { Prisma } from "@prisma/client";

const PENDING_SET = "clicks:pending";
const clickKey = (code: string) => `clicks:${code}`;

/**
 * Buffer a click in Redis: atomic INCR of the code's counter + mark the code as
 * "pending" so the flush job knows to persist it. One pipelined round-trip.
 * As we do not have select where to know which counters not saved
 */
export async function recordClick(code: string): Promise<void> {
  // A redirect must succeed even if Redis is down — dropping a click count is an
  // acceptable loss, breaking the redirect is not.
  await redisSafe(
    () => redis.multi().incr(clickKey(code)).sadd(PENDING_SET, code).exec(),
    null,
    "Redis unavailable on recordClick — dropping click",
  );
}

/** Un-flushed click count for a code — lets stats stay live between flushes. 
 * after flush if again hit to get live stats
*/
export async function getPendingClicks(code: string): Promise<number> {
  const n = await redisSafe(
    () => redis.get(clickKey(code)),
    null,
    "Redis unavailable on getPendingClicks — reporting 0 pending",
  );
  return n ? Number(n) : 0;
}

/**
 * Flush all buffered click counts to Postgres. For each pending code we GETDEL
 * the counter (atomic read + reset) so clicks arriving mid-flush start a fresh
 * counter and re-mark the code pending — nothing is double-counted.
 */
export async function flushClicks(): Promise<void> {
  const codes = await redis.smembers(PENDING_SET);
  for (const code of codes) {
    await redis.srem(PENDING_SET, code);
    const countStr = await redis.getdel(clickKey(code));
    const count = countStr ? Number(countStr) : 0;
    if (count <= 0) continue;

    try {
      await addClicks(code, count);
    } catch (err) {
      // If the URL no longer exists (renamed/deleted), the count can never be
      // written — drop it rather than re-buffer forever (P2025 = record not found).
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2025"
      ) {
        logger.warn({ code, count }, "Dropping buffered clicks for missing URL");
        continue;
      }
      // Otherwise it's likely transient — put the count back for next time.
      logger.error({ err, code, count }, "Flush failed; re-buffering clicks");
      
      // clicks may keep arriving after getdel so use INCRBY
      await redis
        .multi()
        .incrby(clickKey(code), count)
        .sadd(PENDING_SET, code)
        .exec();
    }
  }
}

let timer: NodeJS.Timeout | null = null;

/** Start the periodic flush loop (called once at startup). */
export function startClickFlush(): void {
  if (timer) return;
  timer = setInterval(() => {
    flushClicks().catch((err) => logger.error({ err }, "Click flush error"));
  }, env.CLICK_FLUSH_INTERVAL_MS);
  logger.info(
    { intervalMs: env.CLICK_FLUSH_INTERVAL_MS },
    "Click flush job started",
  );
}

/** Stop the loop and do one final flush (used by graceful shutdown, Phase 7). */
export async function stopClickFlush(): Promise<void> {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  await flushClicks();
}
