import { z } from "zod";

/**
 * Aliases that would collide with our own routes, or are otherwise sensitive.
 * Compared case-insensitively. A custom alias may not be one of these.
 */
const RESERVED_ALIASES = new Set([
  "urls",
  "api",
  "admin",
  "health",
  "ready",
  "login",
  "logout",
  "signup",
  "static",
  "assets",
  "public",
  "favicon.ico",
  "robots.txt",
]);

/**
 * A custom alias: URL-safe characters only, 1–20 chars (matches VARCHAR(20)),
 * and not a reserved word. Reused by both create and update.
 */
const aliasSchema = z
  .string()
  .min(1)
  .max(20)
  .regex(/^[A-Za-z0-9_-]+$/, "alias may only contain letters, numbers, - and _")
  .refine((a) => !RESERVED_ALIASES.has(a.toLowerCase()), {
    message: "this alias is reserved and cannot be used",
  });
  // custom validation msg refine

/**
 * An expiry that must be in the FUTURE. Since createdAt is "now" at creation
 * time, "in the future" IS the assignment's "expiresAt must be after createdAt"
 * rule — expressed with Zod's .refine(). z.coerce.date() first turns an ISO
 * string ("2027-01-01") into a real Date.
 */
const futureDate = z.coerce.date().refine((d) => d.getTime() > Date.now(), {
  message: "expiresAt must be in the future",
});

/** POST /urls */
export const createUrlSchema = z.object({
  body: z.object({
    originalUrl: z.string().url(),
    alias: aliasSchema.optional(), // optional custom code; auto-generated if absent
    expiresAt: futureDate.optional(),
  }),
});
export type CreateUrlBody = z.infer<typeof createUrlSchema>["body"];

/**
 * PATCH /urls/:code — a .partial() body so the client may send ANY subset of
 * the fields. `.refine` then insists at least one is present (an empty PATCH is
 * a mistake, not a no-op).
 */
export const updateUrlSchema = z.object({
  params: z.object({ code: z.string().min(1).max(20) }),
  body: z
    .object({
      alias: aliasSchema,
      // null clears the expiry; a future date sets it; omitted = leave as-is.
      expiresAt: futureDate.nullable(),
    })
    .partial()
    .refine((b) => Object.keys(b).length > 0, {
      message: "provide at least one field to update (alias or expiresAt)",
    }),
});
export type UpdateUrlBody = z.infer<typeof updateUrlSchema>["body"];

/** Routes that take a :code URL param (redirect + stats). */
export const codeParamsSchema = z.object({
  params: z.object({
    code: z.string().min(1).max(20),
  }),
});
