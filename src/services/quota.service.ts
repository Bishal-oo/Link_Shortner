import { env } from "@/config/env";
import {
  refillQuotaIfDue,
  trySpendQuota,
  findUserById,
} from "@/repositories/user.repository";
import { QuotaExhaustedError } from "@/errors/QuotaExhaustedError";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Spend one generation for a user: lazily refill if the window has passed, then
 * atomically decrement. Throws QuotaExhaustedError (with the next refill time)
 * if none remain. No cron job needed — the refill happens on demand.
 */
export async function spendOneGeneration(userId: string): Promise<void> {
  const cutoff = new Date(Date.now() - env.QUOTA_REFILL_HOURS * HOUR_MS);
  await refillQuotaIfDue(userId, env.QUOTA_MAX, cutoff);

  const spent = await trySpendQuota(userId);
  if (!spent) {
    const user = await findUserById(userId);
    const nextRefill = user
      ? new Date(user.quotaRefreshedAt.getTime() + env.QUOTA_REFILL_HOURS * HOUR_MS)
      : null;
    throw new QuotaExhaustedError(nextRefill);
  }
}