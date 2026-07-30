import { z } from "zod";

/**
 * Validation schema for POST /urls.
 *
 * We wrap the fields under `body` so ONE schema can describe body/params/query
 * together — the generic validate middleware feeds all three parts in. Here we
 * only care about the body.
 */
export const createUrlSchema = z.object({
  body: z.object({
    // Must be a syntactically valid URL, or we reject with 400.
    originalUrl: z.string().url(),

    // Optional. z.coerce.date() turns an ISO string like "2027-01-01" into a
    // real Date. (The "must be after createdAt" rule lands in Phase 4.)
    expiresAt: z.coerce.date().optional(),
  }),
});

// The parsed shape, inferred from the schema — no duplicate type to maintain.
export type CreateUrlBody = z.infer<typeof createUrlSchema>["body"];

/**
 * Validation for routes that take a :code URL param (redirect + stats).
 * Codes are short URL-safe strings; we bound the length (custom aliases can be
 * up to 20 chars — Phase 4).
 */
export const codeParamsSchema = z.object({
  params: z.object({
    code: z.string().min(1).max(20),
  }),
});
