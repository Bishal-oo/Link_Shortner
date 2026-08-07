import { prisma } from "@/config/db";
import type { Url } from "@prisma/client";

// Re-export the Prisma-generated `Url` type so the rest of the app imports it
// from the repository, not from Prisma directly — keeping the ORM contained.
export type { Url };

/**
 * Insert a new URL and return the saved record.
 */
export async function insertUrl(input: {
  code: string;
  originalUrl: string;
  expiresAt: Date | null;
}): Promise<Url> {
  return prisma.url.create({
    data: {
      code: input.code,
      originalUrl: input.originalUrl,
      expiresAt: input.expiresAt,
    },
  });
}

/** Look up a URL by its short code. Returns null if it doesn't exist. */
export async function findByCode(code: string): Promise<Url | null> {
  return prisma.url.findUnique({ where: { code } });
}

/*
 * Atomically increment a URL's click count and stamp last_accessed_at.
 * `{ increment: 1 }` compiles to `SET click_count = click_count + 1` in ONE
 * SQL statement — no read-modify-write race between concurrent clicks.
 */
export async function addClicks(code: string, count: number): Promise<void> {
  await prisma.url.update({
    where: { code },
    data: {
      clickCount: { increment: count },
      lastAccessedAt: new Date(),
    },
  });
}

/**
 * Update a URL's alias (code) and/or expiry. Only the fields that are provided
 * (not undefined) are written — this is how PATCH does a partial update.
 */
export async function updateUrlRecord(
  code: string,
  data: { code?: string; expiresAt?: Date | null },
): Promise<Url> {
  return prisma.url.update({
    where: { code },
    data: {
      ...(data.code !== undefined ? { code: data.code } : {}),
      ...(data.expiresAt !== undefined ? { expiresAt: data.expiresAt } : {}),
    },
  });
}

/**
 * List URLs newest-first with pagination, plus the total row count (for page
 * math). Both queries run in ONE transaction so the count is consistent with
 * the page slice.
 */
export async function listUrlRecords(args: {
  skip: number;
  take: number;
}): Promise<{ rows: Url[]; total: number }> {
  const [rows, total] = await prisma.$transaction([
    prisma.url.findMany({
      orderBy: { createdAt: "desc" },
      skip: args.skip,
      take: args.take,
    }),
    prisma.url.count(),
  ]);
  return { rows, total };
}

/** Delete a URL by its code. Throws Prisma P2025 if the row doesn't exist. */
export async function deleteUrlRecord(code: string): Promise<void> {
  await prisma.url.delete({ where: { code } });
}


/**
 * Refill a user's quota to `max` IF the refill window has elapsed. Uses
 * updateMany with a WHERE guard so the reset only fires when due — atomic, no
 * read-then-write race.
 */
export async function refillQuotaIfDue(
  userId: string,
  max: number,
  cutoff: Date,
): Promise<void> {
  await prisma.user.updateMany({
    where: { id: userId, quotaRefreshedAt: { lte: cutoff } },
    data: { quota: max, quotaRefreshedAt: new Date() },
  });
}

/**
 * Atomically spend one generation. The `quota: { gt: 0 }` guard means the
 * decrement only happens if there's quota left; count === 0 means exhausted.
 */
export async function trySpendQuota(userId: string): Promise<boolean> {
  const res = await prisma.user.updateMany({
    where: { id: userId, quota: { gt: 0 } },
    data: { quota: { decrement: 1 } },
  });
  return res.count > 0;
}

/** Hand a generation back (used when a create fails after spending). */
export async function refundQuota(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { quota: { increment: 1 } },
  });
}