import { randomUUID } from "node:crypto";
import { redis } from "@/config/redis";
import { env } from "@/config/env";
import { redisSafe } from "@/utils/redisSafe";

const urlKey = (code: string) => `url:${code}`;
const lockKey = (code: string) => `lock:${code}`;

// Sentinel stored to represent a KNOWN-missing code (the negative cache).
// Plain ASCII, and shaped so it can never collide with a real cached value
// (which is always JSON starting with "{").
const NEGATIVE = "__NEGATIVE__";

/**
 * The minimal, STABLE data we cache for a redirect. Excludes clickCount (which
 * changes on every hit). Stored as JSON, so the Date becomes an ISO string.
 */
export interface CachedUrl {
  originalUrl: string;
  expiresAt: string | null;
}

export type CacheLookup =|{ state: "hit"; value: CachedUrl }| { state: "negative" } | { state: "miss" }; 
/** Read from cache: hit (value), negative (known-missing), or miss.
 * If Redis is unreachable, degrade to a miss so the caller queries Postgres. */
export async function lookupCache(code: string): Promise<CacheLookup> {
  const raw = await redisSafe(
    () => redis.get(urlKey(code)),
    null,
    "Redis unavailable on cache lookup — treating as miss",
  );
  if (raw === null) return { state: "miss" };
  if (raw === NEGATIVE) return { state: "negative" };
  try {
    return { state: "hit", value: JSON.parse(raw) as CachedUrl };
  } catch {
    return { state: "miss" }; // corrupt entry -> treat as a miss
  }
}

/** Cache a real URL with the normal TTL. No-op if Redis is unreachable. */
export async function cacheUrl(code: string, value: CachedUrl): Promise<void> {
  await redisSafe(
    () =>
      redis.set(urlKey(code), JSON.stringify(value), "EX", env.CACHE_TTL_SECONDS),
    null,
    "Redis unavailable on cacheUrl — skipping write",
  );
}

/**
 * Cache the ABSENCE of a code with a SHORT TTL — so repeated lookups for a
 * nonexistent code don't keep hitting Postgres, while a code created moments
 * later isn't stuck returning 404 for long.
 */
export async function cacheNegative(code: string): Promise<void> {
  await redisSafe(
    () => redis.set(urlKey(code), NEGATIVE, "EX", env.NEGATIVE_CACHE_TTL_SECONDS),
    null,
    "Redis unavailable on cacheNegative — skipping write",
  );
}

/** Remove any cached entry (real or negative) — used on create/update/delete.
 * No-op if Redis is unreachable; Postgres remains the source of truth. */
export async function invalidateUrl(code: string): Promise<void> {
  await redisSafe(
    () => redis.del(urlKey(code)),
    0,
    "Redis unavailable on invalidateUrl — skipping delete",
  );
}

/**
 * Try to acquire a short-lived rebuild lock. `SET NX` = "set only if absent",
 * so exactly one caller wins. Returns a token on success (needed to release
 * safely), or null if someone else already holds it.
 */
export async function acquireRebuildLock(code: string): Promise<string | null> {
  const token = randomUUID();
  // On a Redis outage, hand back the token so the caller rebuilds directly from
  // Postgres. Stampede protection only matters when the cache is up, and a
  // fallback release() below is a harmless no-op.
  const ok = await redisSafe(
    () => redis.set(lockKey(code), token, "PX", env.LOCK_TTL_MS, "NX"),
    "OK",
    "Redis unavailable acquiring rebuild lock — rebuilding from DB",
  );
  return ok === "OK" ? token : null;
}

/**
 * Release the lock, but ONLY if we still own it — compare the token and delete
 * in a single atomic Lua script. This prevents deleting a lock that expired and
 * was since acquired by another request.
 */
export async function releaseRebuildLock(
  code: string,
  token: string,
): Promise<void> {
  const lua =
    'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';
  await redisSafe(
    () => redis.eval(lua, 1, lockKey(code), token),
    0,
    "Redis unavailable releasing rebuild lock — skipping",
  );
}
