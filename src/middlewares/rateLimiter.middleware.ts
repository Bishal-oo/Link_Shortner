import type { Request, RequestHandler } from "express";
import { redis } from "@/config/redis";
import { env } from "@/config/env";
import { logger } from "@/utils/logger";
import { RateLimitError } from "@/errors/RateLimitError";

/**
 * Atomically increment the counter and, on the FIRST hit of a window, set its
 * expiry — one server-side script, so there's no INCR/EXPIRE race.
 * Returns [currentCount, ttlMillis].
 */
const RATE_LIMIT_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
return { current, redis.call("PTTL", KEYS[1]) }
`;


interface Tier {
  name: string;
  max: number;
  windowMs: number;
}

/** Decide which tier (and identity) a request belongs to. */
function resolveTier(req: Request): { tier: Tier; id: string } {
  const windowMs = env.RATE_LIMIT_WINDOW_SEC * 1000;
  const apiKey = req.header("x-api-key");

  if (apiKey) {
    return {
      tier: { name: "apikey", max: env.RATE_LIMIT_APIKEY_MAX, windowMs },
      id: apiKey,
    };
  }

  return {
    tier: { name: "anon", max: env.RATE_LIMIT_ANON_MAX, windowMs },
    id: req.ip ?? "unknown",
  };
}

/**
 * Redis-backed, tiered fixed-window rate limiter. Sets RateLimit-* headers on
 * every response and THROWS a RateLimitError when a caller exceeds their window
 * (the central handler adds Retry-After and returns 429). Fails OPEN if Redis
 * is unreachable — a limiter outage must not take down the API.
 */
export const rateLimiter: RequestHandler = async (req, res, next) => {
  const { tier, id } = resolveTier(req);
  const key = `ratelimit:${tier.name}:${id}`;

  let count: number;
  let ttlMs: number;
  try {
    const result = (await redis.eval(
      RATE_LIMIT_SCRIPT,
      1,
      key,
      tier.windowMs,
    )) as [number, number];
    count = Number(result[0]);
    ttlMs = Number(result[1]);
  } catch (err) {
    logger.error({ err }, "Rate limiter Redis error — allowing request");
    next();
    return;
  }

  const resetSec = Math.max(1, Math.ceil(ttlMs / 1000));
  const remaining = Math.max(0, tier.max - count);

  res.setHeader("RateLimit-Limit", tier.max);
  res.setHeader("RateLimit-Remaining", remaining);
  res.setHeader("RateLimit-Reset", resetSec);

  if (count > tier.max) {
    logger.warn(
      { tier: tier.name, id, count, limit: tier.max },
      "Rate limit exceeded",
    );
    throw new RateLimitError(
      resetSec,
      `Rate limit exceeded. Try again in ${resetSec}s.`,
    );
  }

  next();
};
