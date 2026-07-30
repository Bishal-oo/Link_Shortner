import { PrismaClient } from "@prisma/client";
import { env } from "./env.js";

/**
 * ONE shared PrismaClient for the whole app.
 *
 * PrismaClient manages its own connection pool internally — so, like the pg
 * Pool before it, we create exactly one instance and reuse it everywhere.
 * Creating a new client per request would exhaust database connections.
 *
 * Prisma reads the connection URL from DATABASE_URL (via the datasource in
 * schema.prisma), so we don't pass it here.
 */
export const prisma = new PrismaClient({
  log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});
