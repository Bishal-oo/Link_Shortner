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

/**
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
