import { nanoid } from "nanoid";
import { Prisma } from "@prisma/client";
import {
  insertUrl,
  findByCode,
  type Url,
} from "../repositories/url.repository.js";
import {
  lookupCache,
  cacheUrl,
  cacheNegative,
  invalidateUrl,
  acquireRebuildLock,
  releaseRebuildLock,
  type CachedUrl,
} from "./cache.service.js";
import { recordClick, getPendingClicks } from "./clickTracker.service.js";
import { logger } from "../utils/logger.js";

const CODE_LENGTH = 7; // 64^7 ≈ 4.4 trillion possibilities
const MAX_ATTEMPTS = 5;

/**
 * Create a short URL: generate a random code and persist it.
 *
 * We rely on the DB's UNIQUE constraint on `code` as the arbiter of uniqueness
 * (no "check-then-insert" race). On the astronomically rare collision, Prisma
 * throws error code P2002 — we catch it and retry with a fresh code.
 */
export async function createShortUrl(input: {
  originalUrl: string;
  expiresAt: Date | null;
}): Promise<Url> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const code = nanoid(CODE_LENGTH);
    try {
      const created = await insertUrl({
        code,
        originalUrl: input.originalUrl,
        expiresAt: input.expiresAt,
      });
      // Clear any negative-cache entry so a freshly created code resolves at once.
      await invalidateUrl(code);
      return created;
    } catch (err) {
      const isCodeCollision =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002";
      if (isCodeCollision) {
        continue; // try again with a new code
      }
      throw err; // any other error is a real problem — bubble it up
    }
  }
  throw new Error(
    `Failed to generate a unique code after ${MAX_ATTEMPTS} attempts`,
  );
}

export type RedirectResult =
  | { status: "ok"; originalUrl: string }
  | { status: "not_found" }
  | { status: "expired" };

/**
 * Resolve a code for redirecting: look it up, reject if missing or expired,
 * otherwise count the click and return the URL.
 * (In Phase 3 the click count moves to Redis for speed.)
 */
const STAMPEDE_RETRY_MS = 50;
const STAMPEDE_MAX_RETRIES = 5;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Load a code from Postgres and populate the cache (positive OR negative). */
async function loadFromDbAndCache(
  code: string,
): Promise<CachedUrl | "not_found"> {
  const url = await findByCode(code);
  if (!url) {
    await cacheNegative(code); // remember the absence (3C)
    return "not_found";
  }
  const value: CachedUrl = {
    originalUrl: url.originalUrl,
    expiresAt: url.expiresAt ? url.expiresAt.toISOString() : null,
  };
  await cacheUrl(code, value);
  return value;
}

/**
 * Resolve a code's cached data, rebuilding from the DB on a miss. On a miss for
 * a HOT key, a Redis lock ensures only ONE request rebuilds (stampede
 * protection, 3D); the rest briefly wait for that rebuild before falling back.
 */
async function resolveCachedUrl(
  code: string,
): Promise<CachedUrl | "not_found"> {
  const found = await lookupCache(code);
  if (found.state === "hit") {
    logger.debug({ code }, "cache hit");
    return found.value;
  }
  if (found.state === "negative") {
    logger.debug({ code }, "negative cache hit");
    return "not_found";
  }
  logger.debug({ code }, "cache miss");

  // Only the lock winner rebuilds; everyone else waits and re-reads the cache.
  const token = await acquireRebuildLock(code);
  if (token) {
    try {
      return await loadFromDbAndCache(code);
    } finally {
      await releaseRebuildLock(code, token);
    }
  }

  for (let i = 0; i < STAMPEDE_MAX_RETRIES; i++) {
    await sleep(STAMPEDE_RETRY_MS);
    const retry = await lookupCache(code);
    if (retry.state === "hit") return retry.value;
    if (retry.state === "negative") return "not_found";
  }
  // Rebuilder is slow/dead — rebuild ourselves rather than fail the request.
  return loadFromDbAndCache(code);
}

export async function resolveForRedirect(
  code: string,
): Promise<RedirectResult> {
  const cached = await resolveCachedUrl(code);
  if (cached === "not_found") return { status: "not_found" };

  if (cached.expiresAt && new Date(cached.expiresAt).getTime() <= Date.now()) {
    return { status: "expired" };
  }

  // Count the click in Redis (fast, atomic); the flush job persists it (3E).
  await recordClick(code);

  return { status: "ok", originalUrl: cached.originalUrl };
}

export interface UrlStats {
  code: string;
  originalUrl: string;
  clickCount: number;
  createdAt: Date;
  lastAccessedAt: Date | null;
  expiresAt: Date | null;
}

/**
 * Stats for a code. The live click count = persisted (Postgres) PLUS the
 * not-yet-flushed buffer (Redis), so stats never lag behind reality.
 */
export async function getUrlStats(code: string): Promise<UrlStats | null> {
  const url = await findByCode(code);
  if (!url) return null;

  const pending = await getPendingClicks(code);
  return {
    code: url.code,
    originalUrl: url.originalUrl,
    clickCount: Number(url.clickCount) + pending,
    createdAt: url.createdAt,
    lastAccessedAt: url.lastAccessedAt,
    expiresAt: url.expiresAt,
  };
}
