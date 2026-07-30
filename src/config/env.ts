
// Load .env into process.env BEFORE we read it. Node does NOT read .env files
// on its own — dotenv is what makes that happen. This must run first, so it's
// the very first import in the app's config module.
import "dotenv/config";
import { z } from "zod";

/**
 * The schema describes exactly what a valid environment looks like.
 * It is the single source of truth for configuration.
 *
 * `.default(...)` = optional with a fallback.
 * No default = REQUIRED; the app refuses to start if it's missing.
 */

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  // Env vars are always strings ("3000"). z.coerce.number() turns the string
  // into a real number and rejects anything non-numeric.
  PORT: z.coerce.number().int().positive().default(3000),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"), 

  // Required. A URL-shaped connection string like:
  //   postgres://user:pass@host:5432/dbname
  DATABASE_URL: z.string().url(),

  // Required. e.g. redis://host:6379
  REDIS_URL: z.string().url(),

  // How long (seconds) a cached URL lives before Redis evicts it. 1 hour:
  // long enough to absorb traffic on hot links, short enough to self-heal if a
  // cache invalidation is ever missed.
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

  // Short TTL for negative (not-found) cache entries.
  NEGATIVE_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(30),

  // How long a cache-rebuild lock is held before auto-expiring (ms).
  LOCK_TTL_MS: z.coerce.number().int().positive().default(5000),

  // How often buffered click counts are flushed from Redis to Postgres (ms).
  CLICK_FLUSH_INTERVAL_MS: z.coerce.number().int().positive().default(10000),
});

// safeParse (not parse) so WE control the error output instead of getting a
// raw stack trace.
const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:\n");
  console.error(
    JSON.stringify(parsed.error.flatten().fieldErrors, null, 2),
  );

  // Exit immediately: a misconfigured service should never accept traffic.
  process.exit(1);
}

// From here on, `env` is fully typed and guaranteed valid.
// env.PORT is a number, env.NODE_ENV is a union — no `| undefined`, no casts.
export const env = parsed.data;

// The inferred TypeScript type, in case other modules want it.
export type Env = z.infer<typeof envSchema>;
