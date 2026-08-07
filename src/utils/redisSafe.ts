import { logger } from "@/utils/logger";

/**
 * Run a Redis operation that must NOT take down the request when Redis is
 * unavailable. On any error we log and return `fallback`, letting the caller
 * degrade gracefully rather than surface a 500:
 *   - a cache READ becomes a miss  -> the caller falls through to Postgres
 *   - a cache WRITE becomes a no-op -> the DB stays the source of truth
 *
 * Redis is a cache here, i.e. a SOFT dependency; only the rate limiter and
 * readiness probe are allowed to observe its absence directly.
 */
export async function redisSafe<T>(
  op: () => Promise<T>,
  fallback: T,
  context: string,
): Promise<T> {
  try {
    return await op();
  } catch (err) {
    logger.error({ err }, context);
    return fallback;
  }
}
