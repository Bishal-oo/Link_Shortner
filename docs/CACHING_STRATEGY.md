# Link Shortener — Caching Strategy

This document explains **what caching patterns the project uses, why, and what would
change if we'd chosen differently.** It's written so you can defend the design in a
code review.

The short version: this project does **not** use a single cache pattern. A URL
shortener has a lopsided traffic shape — read-heavy redirects, write-heavy click
counts — so we use **two different patterns**, each matched to one job.

- **Cache-Aside** for reads (resolving/redirecting a short link)
- **Write-Behind** for writes (counting clicks)

---

## 1. Why a shortener needs this

A URL shortener does two things at very different rates:

- **Writes** (creating a link): rare.
- **Reads** (redirecting a link): potentially enormous — one popular link can be hit
  thousands of times per second, and the *same* hot links get hit over and over.

Postgres is the durable, correct, but disk-bound **source of truth**. Redis is the
in-memory **fast path** that absorbs read load. A read from RAM is ~0.2–1 ms; a read
from Postgres is ~5–50 ms. Caching turns the common case from the second into the
first — and stops the DB from being the bottleneck.

---

## 2. Pattern #1 — Cache-Aside (reads)

**Where:** `src/services/cache.service.ts`, `src/services/url.service.ts`
(`resolveCachedUrl`).

The application code manages the cache "on the side" of the database. A code is
cached **lazily** — the first time someone asks for it, not before.

```
GET /:code
   │
   ▼
lookupCache(code)  ── Redis
   ├─ HIT       → return cached URL                (Postgres NOT touched)
   ├─ NEGATIVE  → return 404                        (Postgres NOT touched)
   └─ MISS
        │
        ▼
     acquire rebuild lock (SET NX)
        ├─ won  → findByCode() ─ Postgres → cache result → return
        └─ lost → wait & retry cache (someone else is rebuilding)
```

Three refinements layered on top:

- **Negative caching** (`cacheNegative`, `NEGATIVE_CACHE_TTL_SECONDS = 30s`) — we
  cache the *absence* of a code, so a flood of requests for a nonexistent code
  doesn't keep hitting Postgres. Short TTL so a code created moments later isn't
  stuck 404-ing for long.
- **TTL expiry** (`CACHE_TTL_SECONDS = 3600s`) — cached URLs live 1 hour, so a
  missed invalidation self-heals.
- **Stampede protection** (`acquireRebuildLock` / `releaseRebuildLock`) — when a hot
  key expires, a Redis `SET NX` lock ensures only **one** request rebuilds it from
  the DB while others briefly wait, instead of thousands stampeding Postgres at once.

**Consistency:** on every create/update we `invalidateUrl(code)` so redirects never
serve a stale URL.

---

## 3. Pattern #2 — Write-Behind (click counts)

**Where:** `src/services/clickTracker.service.ts`.

Every redirect increments a click counter, but we do **not** write each click to
Postgres. Writes are absorbed by Redis and flushed to the DB in batches.

```
GET /:code (successful redirect)
   │
   ▼
recordClick(code)  → INCR clicks:<code> in Redis   (instant, no DB)
                     SADD clicks:pending <code>

        ... every CLICK_FLUSH_INTERVAL_MS (10s) ...

flushClicks()  → for each pending code: GETDEL counter → addClicks() batch → Postgres
```

Stats stay **live** despite the delay: `getUrlStats` adds the un-flushed Redis buffer
(`getPendingClicks`) to the persisted DB count, so the number a user sees is always
current. The flush uses `GETDEL` (atomic read + reset) so clicks arriving mid-flush
start a fresh counter and re-mark the code pending — nothing is double-counted or
lost.

---

## 4. The other patterns, and what would change

| Pattern | Who manages cache | Reads | Writes |
|---|---|---|---|
| **Cache-Aside** *(ours, reads)* | App code | App checks cache, falls back to DB | App writes DB, then invalidates cache |
| **Read-Through** | Cache library | Cache auto-loads from DB on miss | (paired with a write pattern) |
| **Write-Through** | Cache library | — | Every write → cache **and** DB, synchronously |
| **Write-Behind** *(ours, clicks)* | Cache library | — | Write to cache now, DB later in batches |
| **Write-Around** | App code | — | Writes skip cache, go straight to DB |

**If reads used Read-Through instead of Cache-Aside** — near-identical performance,
but the cache library (not our code) owns the DB fetch. We'd lose the seam that our
negative caching, stampede lock, and expiry logic all live in. No gain, less control.

**If clicks used Write-Through instead of Write-Behind** — every click blocks on a
Postgres write. User wait time ↑, DB writes ↑ massively (10k clicks/s = 10k writes/s),
consistency perfect but throughput collapses under exactly the load a shortener sees.

**If clicks used Write-Around** — bad fit; counters are write-heavy *and* read back
constantly for stats. You'd get the worst of both.

**If there were no cache at all** — every redirect hits Postgres (reads ↑), every
click is a DB write (writes ↑), user wait time ↑. Simplest code, doesn't scale past
low traffic.

### Effect on the four metrics

| Metric | No cache | Write-Through clicks | **Our design** |
|---|---|---|---|
| User wait (redirect) | High (DB read) | High (DB write in path) | **Lowest (Redis, no DB in hot path)** |
| DB reads | One per redirect | One per redirect | **Only on cache miss** |
| DB writes | One per click | One per click | **Batched ~every 10s** |
| Count consistency | Strong | Strong | Eventually consistent (≤10s), shown live via buffer merge |

---

## 5. Why this is the best fit

There is no single "best cache" — the right answer is to **match the pattern to the
access shape**, and a shortener has two very different shapes:

- **Redirects are read-heavy, repetitive, and need custom fallback logic**
  (negative cache, expiry, stampede). → **Cache-Aside.**
- **Clicks are write-heavy, high-volume, and tolerant of a few seconds' delay.**
  → **Write-Behind.**

If forced to name the single most important pattern, it's **Cache-Aside** — a
shortener is overwhelmingly a read/redirect service, so that's the pattern doing the
heaviest lifting. Write-behind is what keeps that read path fast under real load.

---

## 6. Config knobs

All in `src/config/env.ts` (validated at startup):

| Variable | Default | Meaning |
|---|---|---|
| `CACHE_TTL_SECONDS` | 3600 | How long a cached URL lives before Redis evicts it |
| `NEGATIVE_CACHE_TTL_SECONDS` | 30 | TTL for known-missing (404) entries |
| `LOCK_TTL_MS` | 5000 | How long a cache-rebuild lock is held before auto-expiring |
| `CLICK_FLUSH_INTERVAL_MS` | 10000 | How often buffered clicks flush from Redis to Postgres |
