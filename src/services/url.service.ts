import { nanoid } from "nanoid";
import { Prisma } from "@prisma/client";
import {
  insertUrl,
  findByCode,
  updateUrlRecord,
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
import { NotFoundError } from "../errors/NotFoundError.js";
import { ConflictError } from "../errors/ConflictError.js";
import { GoneError } from "../errors/GoneError.js";

const CODE_LENGTH = 7; // 64^7 ≈ 4.4 trillion possibilities
const MAX_ATTEMPTS = 5;

/** True if the error is a Postgres/Prisma unique-constraint violation. */
function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

/**
 * Create a short URL.
 *  - With a custom `alias`: use it as the code; a collision is the caller's
 *    problem, so throw ConflictError (no retry).
 *  - Without one: generate a random code, retrying only on the rare collision.
 */
export async function createShortUrl(input: {
  originalUrl: string;
  alias?: string;
  expiresAt: Date | null;
}): Promise<Url> {
  if (input.alias) {
    try {
      const created = await insertUrl({
        code: input.alias,
        originalUrl: input.originalUrl,
        expiresAt: input.expiresAt,
      });
      await invalidateUrl(input.alias); // clear any negative-cache entry
      return created;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError(`alias '${input.alias}' is already taken`);
      }
      throw err;
    }
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const code = nanoid(CODE_LENGTH);
    try {
      const created = await insertUrl({
        code,
        originalUrl: input.originalUrl,
        expiresAt: input.expiresAt,
      });
      await invalidateUrl(code);
      return created;
    } catch (err) {
      if (isUniqueViolation(err)) continue; // random collision — try again
      throw err;
    }
  }
  throw new Error(
    `Failed to generate a unique code after ${MAX_ATTEMPTS} attempts`,
  );
}

const STAMPEDE_RETRY_MS = 50;
const STAMPEDE_MAX_RETRIES = 5;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Load a code from Postgres and populate the cache (positive OR negative). */
async function loadFromDbAndCache(
  code: string,
): Promise<CachedUrl | "not_found"> {
  const url = await findByCode(code);
  if (!url) {
    await cacheNegative(code);
    return "not_found";
  }
  const value: CachedUrl = {
    originalUrl: url.originalUrl,
    expiresAt: url.expiresAt ? url.expiresAt.toISOString() : null,
  };
  await cacheUrl(code, value);
  return value;
}

/** Cache-aside + stampede-protected resolve of a code's cached data. */
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
  return loadFromDbAndCache(code);
}

/**
 * Resolve a code for redirecting. Throws NotFoundError / GoneError; on success
 * records a click and returns the original URL.
 */
export async function resolveForRedirect(code: string): Promise<string> {
  const cached = await resolveCachedUrl(code);
  if (cached === "not_found") {
    throw new NotFoundError(`No link for code '${code}'`);
  }
  if (cached.expiresAt && new Date(cached.expiresAt).getTime() <= Date.now()) {
    throw new GoneError("This link has expired");
  }

  await recordClick(code);
  return cached.originalUrl;
}

export interface UrlStats {
  code: string;
  originalUrl: string;
  clickCount: number;
  createdAt: Date;
  lastAccessedAt: Date | null;
  expiresAt: Date | null;
}

/** Stats for a code (live count = Postgres + un-flushed Redis buffer). */
export async function getUrlStats(code: string): Promise<UrlStats> {
  const url = await findByCode(code);
  if (!url) throw new NotFoundError(`No link for code '${code}'`);

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

/**
 * Update a link's alias and/or expiry. Throws NotFoundError / ConflictError.
 * Invalidates the cache for the old (and new) code so redirects aren't stale.
 */
export async function updateUrl(
  code: string,
  changes: { alias?: string; expiresAt?: Date | null },
): Promise<Url> {
  const existing = await findByCode(code);
  if (!existing) throw new NotFoundError(`No link for code '${code}'`);

  const renaming = changes.alias !== undefined && changes.alias !== code;

  if (renaming) {
    const taken = await findByCode(changes.alias as string);
    if (taken) {
      throw new ConflictError(`alias '${changes.alias}' is already taken`);
    }
  }

  try {
    const updated = await updateUrlRecord(code, {
      code: renaming ? changes.alias : undefined,
      expiresAt: changes.expiresAt,
    });

    await invalidateUrl(code);
    if (renaming) await invalidateUrl(changes.alias as string);

    return updated;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(`alias '${changes.alias}' is already taken`);
    }
    throw err;
  }
}
