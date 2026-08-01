import { describe, it, expect, afterAll } from "@jest/globals";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/db.js";
import { redis } from "../src/config/redis.js";

// NOTE: this is an INTEGRATION test — it exercises the real app against the real
// Postgres and Redis from docker-compose. Make sure the datastores are running
// (`docker compose up -d postgres redis`) before `npm test`.

const app = createApp();

// Use the API-key tier so repeated test runs don't trip the anonymous limiter.
const API_KEY = "integration-test-key";

afterAll(async () => {
  // Close the shared connections so Jest can exit cleanly.
  await prisma.$disconnect();
  await redis.quit();
});

describe("URL shortener — integration", () => {
  it("create → redirect → cache populated → stats reflect the click", async () => {
    const originalUrl = "https://example.com/integration-test";

    // 1. CREATE a short link.
    const createRes = await request(app)
      .post("/urls")
      .set("X-API-Key", API_KEY)
      .send({ originalUrl })
      .expect(201);

    const code: string = createRes.body.code;
    expect(code).toBeTruthy();
    expect(createRes.body.originalUrl).toBe(originalUrl);

    // 2. REDIRECT — first hit is a cache miss that populates the cache and
    //    records a click. supertest does NOT follow redirects, so we see the 302.
    const redirectRes = await request(app)
      .get(`/${code}`)
      .set("X-API-Key", API_KEY)
      .expect(302);
    expect(redirectRes.headers.location).toBe(originalUrl);

    // 3. CACHE POPULATED — the redirect wrote the mapping into Redis.
    const cached = await redis.get(`url:${code}`);
    expect(cached).not.toBeNull();
    expect(JSON.parse(cached as string).originalUrl).toBe(originalUrl);

    // 4. STATS reflect the click (Postgres count + un-flushed Redis buffer).
    const statsRes = await request(app)
      .get(`/urls/${code}/stats`)
      .set("X-API-Key", API_KEY)
      .expect(200);
    expect(statsRes.body.originalUrl).toBe(originalUrl);
    expect(statsRes.body.clickCount).toBeGreaterThanOrEqual(1);

    // Clean up this test's data so re-runs stay independent.
    await prisma.url.delete({ where: { code } }).catch(() => undefined);
    await redis.del(`url:${code}`, `clicks:${code}`);
    await redis.srem("clicks:pending", code);
  });

  it("returns 404 for an unknown code's stats", async () => {
    await request(app)
      .get("/urls/definitely-not-real/stats")
      .set("X-API-Key", API_KEY)
      .expect(404);
  });
});
