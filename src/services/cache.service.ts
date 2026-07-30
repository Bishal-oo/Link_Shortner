import { randomUUID } from "node:crypto";
import { redis } from "../config/redis.js";
import { env } from "../config/env.js";

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

export type CacheLookup =
  | { state: "hit"; value: CachedUrl }
  | { state: "negative" } // we know this code does not exist
  | { state: "miss" }; //     nothing cached — must ask the DB

/** Read from cache: hit (value), negative (known-missing), or miss. */
export async function lookupCache(code: string): Promise<CacheLookup> {
  const raw = await redis.get(urlKey(code));
  if (raw === null) return { state: "miss" };
  if (raw === NEGATIVE) return { state: "negative" };
  try {
    return { state: "hit", value: JSON.parse(raw) as CachedUrl };
  } catch {
    return { state: "miss" }; // corrupt entry -> treat as a miss
  }
}

/** Cache a real URL with the normal TTL. */
export async function cacheUrl(code: string, value: CachedUrl): Promise<void> {
  await redis.set(
    urlKey(code),
    JSON.stringify(value),
    "EX",
    env.CACHE_TTL_SECONDS,
  );
}

/**
 * Cache the ABSENCE of a code with a SHORT TTL — so repeated lookups for a
 * nonexistent code don't keep hitting Postgres, while a code created moments
 * later isn't stuck returning 404 for long.
 */
export async function cacheNegative(code: string): Promise<void> {
  await redis.set(
    urlKey(code),
    NEGATIVE,
    "EX",
    env.NEGATIVE_CACHE_TTL_SECONDS,
  );
}

/** Remove any cached entry (real or negative) — used on create/update/delete. */
export async function invalidateUrl(code: string): Promise<void> {
  await redis.del(urlKey(code));
}

/**
 * Try to acquire a short-lived rebuild lock. `SET NX` = "set only if absent",
 * so exactly one caller wins. Returns a token on success (needed to release
 * safely), or null if someone else already holds it.
 */
export async function acquireRebuildLock(code: string): Promise<string | null> {
  const token = randomUUID();
  const ok = await redis.set(lockKey(code), token, "PX", env.LOCK_TTL_MS, "NX");
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
  await redis.eval(lua, 1, lockKey(code), token);
}
