# Backend Documentation — Link Shortener API

A complete, top-to-bottom guide to the backend: **what** each file does, **how** it does it, **where** it sits in the request flow, and **why** it was built that way. Special focus on **caching**, **rate limiting**, and the **full workflow of every CRUD operation**.

---

## Table of Contents

1. [The Big Picture](#1-the-big-picture)
2. [Technology Stack](#2-technology-stack)
3. [Layered Architecture — Why Layers?](#3-layered-architecture--why-layers)
4. [File-by-File Reference](#4-file-by-file-reference)
5. [The Request Lifecycle (Middleware Pipeline)](#5-the-request-lifecycle-middleware-pipeline)
6. [Validation — How & Where](#6-validation--how--where)
7. [Caching — Deep Dive](#7-caching--deep-dive)
8. [Rate Limiting — Deep Dive](#8-rate-limiting--deep-dive)
9. [Click Tracking (Write-Behind Buffer)](#9-click-tracking-write-behind-buffer)
10. [Error Handling](#10-error-handling)
11. [Complete CRUD Workflows](#11-complete-crud-workflows)
12. [Startup & Graceful Shutdown](#12-startup--graceful-shutdown)

---

## 1. The Big Picture

This is a **URL shortener**: it turns a long URL into a short 7-character code (or a custom alias), then redirects anyone who visits `/<code>` to the original URL — while counting every click.

The backend is an **Express (Node.js + TypeScript)** API backed by two datastores:

- **PostgreSQL** (via **Prisma ORM**) — the *source of truth*. Every link lives here permanently.
- **Redis** — a fast in-memory layer used for **three separate jobs**:
  1. **Caching** redirect lookups (so hot links don't hammer Postgres).
  2. **Rate limiting** (counting requests per client per time window).
  3. **Buffering click counts** (batching writes instead of one DB write per click).

```
                    ┌─────────────────────────────────────────┐
   Browser  ──────▶ │  Express App (middleware pipeline)       │
   / API client     │  CORS → health → log → ratelimit → JSON  │
                    │        → routes → 404 → errorHandler      │
                    └───────────────┬─────────────────────────┘
                                    │
                    ┌───────────────▼───────────────┐
                    │  Controller (HTTP in/out)      │
                    ├───────────────────────────────┤
                    │  Service (business logic)      │
                    ├───────────────────────────────┤
                    │  Repository (Prisma/SQL)       │
                    └───────┬───────────────┬────────┘
                            │               │
                     ┌──────▼─────┐   ┌─────▼──────┐
                     │ PostgreSQL │   │   Redis    │
                     │(truth)     │   │(cache/RL/  │
                     │            │   │ click buf) │
                     └────────────┘   └────────────┘
```

---

## 2. Technology Stack

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node.js + TypeScript | Type safety across every layer |
| HTTP framework | Express 5 | Express 5 auto-forwards async errors to the error handler |
| Database | PostgreSQL | Relational, ACID, unique constraints for aliases |
| ORM | Prisma | Type-safe queries, migrations, generated `Url` type |
| Cache / counters | Redis (via `ioredis`) | Sub-millisecond reads, atomic scripts, TTLs |
| Validation | Zod | Schema-first validation that also produces TS types |
| Logging | Pino | Fast structured JSON logs with correlation ids |
| ID generation | nanoid | Short, URL-safe, collision-resistant random codes |

---

## 3. Layered Architecture — Why Layers?

Every feature flows through **four layers**, each with one job. This separation means you can change the database without touching HTTP code, or change the HTTP shape without touching business rules.

| Layer | File(s) | Responsibility | Knows about... |
|---|---|---|---|
| **Route** | `routes/url.routes.ts` | Maps `METHOD /path` → validation + controller | HTTP paths |
| **Controller** | `controllers/url.controller.ts` | Reads `req`, calls a service, writes `res` | HTTP (req/res) |
| **Service** | `services/url.service.ts` | Business rules: caching, collisions, expiry | Domain logic |
| **Repository** | `repositories/url.repository.ts` | Raw data access via Prisma | The database |

**Golden rule:** dependencies point *downward* only. A repository never imports a controller. This is why the repository re-exports Prisma's `Url` type — so the ORM stays "contained" and the rest of the app doesn't import Prisma directly.

---

## 4. File-by-File Reference

### Entry & Application

**`src/index.ts` — the process entry point.**
Connects to Postgres and Redis *first* (fail-fast: a misconfigured service should never accept traffic), starts the background click-flush job, builds the app via `createApp()`, and listens on the port. Also registers **graceful shutdown** (see §12).

**`src/app.ts` — the Express application factory.**
`createApp()` assembles the middleware pipeline *in a specific order* (see §5). It's a **factory function** (not a top-level app) so tests can spin up an instance without opening a real network port.

### Configuration (`src/config/`)

**`config/env.ts` — validated environment configuration.**
Loads `.env` via `dotenv`, then validates *every* variable through a **Zod schema**. Variables with `.default(...)` are optional; those without are **required** — if any is missing or malformed, the app prints the errors and `process.exit(1)`. After this file, `env` is fully typed and guaranteed valid (e.g. `env.PORT` is a `number`, never `string | undefined`). This is the **single source of truth for configuration**.

Key knobs it defines:
- `CACHE_TTL_SECONDS` (default 3600) — how long a cached URL lives.
- `NEGATIVE_CACHE_TTL_SECONDS` (default 30) — TTL for "known-missing" entries.
- `LOCK_TTL_MS` (default 5000) — cache-rebuild lock lifetime.
- `CLICK_FLUSH_INTERVAL_MS` (default 10000) — how often clicks flush to Postgres.
- `RATE_LIMIT_WINDOW_SEC` (60), `RATE_LIMIT_ANON_MAX` (60), `RATE_LIMIT_APIKEY_MAX` (600).

**`config/db.ts` — the shared Prisma client.**
Creates **one** `PrismaClient` for the whole app (it manages its own connection pool internally). Creating a client per request would exhaust database connections.

**`config/redis.ts` — the shared Redis client.**
One long-lived `ioredis` connection reused everywhere. `maxRetriesPerRequest: 3` makes a command fail fast rather than hang forever — "a cache should never become a source of hangs."

### HTTP layer

**`routes/url.routes.ts`** — declares all URL endpoints. **Route order matters** (see the note in §5).

**`routes/health.routes.ts`** — two probes:
- `GET /health` (**liveness**) — "is the process up?" Deliberately does *not* check dependencies, so a transient Redis blip doesn't trigger restart loops.
- `GET /ready` (**readiness**) — "can I serve traffic *now*?" Pings Postgres **and** Redis; returns `503` if either is down, pulling the instance out of rotation until it recovers.

**`controllers/url.controller.ts`** — one handler per endpoint. Controllers only handle the **success path**; every error case is *thrown* deeper down and formatted centrally. Controllers also build the public `shortUrl` string from `req.protocol` + `req.get("host")`.

### Business logic

**`services/url.service.ts`** — the heart of the app. Orchestrates repository calls, the cache, click recording, and enforces business rules (alias collisions, expiry, unique-code generation). Detailed per-operation in §11.

**`services/cache.service.ts`** — all Redis caching primitives (§7).

**`services/clickTracker.service.ts`** — the write-behind click buffer and its flush loop (§9).

### Data access

**`repositories/url.repository.ts`** — thin Prisma wrappers: `insertUrl`, `findByCode`, `addClicks`, `updateUrlRecord`, `listUrlRecords`, `deleteUrlRecord`. Each maps to one (or one transactional) Prisma call.

**`prisma/schema.prisma`** — the data model. The `Url` model maps to the `urls` table; `code` has a `@unique` constraint (this is what makes alias collisions a *database-enforced* guarantee, surfaced as Prisma error `P2002`).

### Validation & types

**`types/url.schema.ts`** — Zod schemas that validate request bodies/params/queries **and** generate the TypeScript types (`CreateUrlBody`, `UpdateUrlBody`, `ListQuery`). Includes alias rules, a reserved-word blocklist, and the "expiry must be in the future" rule (§6).

### Middleware (`src/middlewares/`)

- **`validate.middleware.ts`** — generic Zod runner (§6).
- **`rateLimiter.middleware.ts`** — Redis-backed tiered limiter (§8).
- **`requestLogger.middleware.ts`** — correlation id + start/finish logs (below).
- **`errorHandler.middleware.ts`** — turns thrown errors into JSON responses (§10).

### Errors (`src/errors/`)

A small hierarchy so the error handler can format everything uniformly:

| Class | HTTP | `code` | Meaning |
|---|---|---|---|
| `AppError` (base) | — | — | Carries `statusCode`, `code`, `isOperational` |
| `ValidationError` | 400 | `ValidationError` | Bad input (+ `details`) |
| `NotFoundError` | 404 | `NotFound` | No link for that code |
| `ConflictError` | 409 | `Conflict` | Alias already taken |
| `GoneError` | 410 | `Gone` | Link expired |
| `RateLimitError` | 429 | `TooManyRequests` | Over the limit (+ `retryAfter`) |

### Utilities (`src/utils/`)

**`utils/logger.ts`** — a shared **Pino** logger. Its `mixin` auto-attaches the current request's `reqId` (read from `AsyncLocalStorage`) to *every* log line — so a cache-miss log buried in a service carries the same id as the "request received" line, with no manual threading.

**`utils/requestContext.ts`** — an `AsyncLocalStorage` store holding the per-request `reqId`. `requestContext.run({ reqId }, ...)` in the logger middleware makes that id available to all downstream async code.

---

## 5. The Request Lifecycle (Middleware Pipeline)

`createApp()` in `app.ts` registers middleware **in this exact order** — and the order is deliberate:

```
1. CORS               ── added first so preflight (OPTIONS) & every response
                         carry Access-Control-* headers, even a 429 rejection.
                         exposedHeaders lets frontend JS READ RateLimit-* headers.
2. healthRouter       ── /health & /ready BEFORE logging/limiting, so monitoring
                         traffic is neither logged as app traffic nor throttled.
3. requestLogger      ── assigns a correlation id, logs start & finish.
4. rateLimiter        ── runs early so over-limit requests are rejected cheaply.
5. express.json()     ── parse JSON body into req.body (after rate limiting,
                         so we don't parse bodies for requests we'll reject).
6. urlRouter          ── the feature routes.
7. 404 catch-all      ── any unmatched route → NotFoundError.
8. errorHandler       ── MUST be last; every thrown error lands here.
```

**Route ordering inside `url.routes.ts` also matters.** The catch-all redirect `GET /:code` is registered **last**, because `/:code` would otherwise swallow `/urls`, `/urls/:code/stats`, etc. Specific routes always come before the greedy one.

**Correlation ids:** `requestLogger` honors an incoming `X-Request-Id` (e.g. from a gateway) or mints a UUID, echoes it back in the response header, and runs the rest of the request inside `requestContext.run(...)` so every log line is stamped with it. It also logs request duration using a high-precision `hrtime` clock on the response's `finish` event.

---

## 6. Validation — How & Where

Validation is **schema-first** using Zod. Schemas live in `types/url.schema.ts`; the `validate()` middleware applies them.

**How `validate(schema)` works:**
1. Runs `schema.safeParse({ body, params, query })`.
2. On failure → **throws** `ValidationError` with `error.flatten()` as `details` → central handler returns **400**.
3. On success → replaces `req.body` with the *parsed* value (only `req.body` — Express 5 makes `query`/`params` read-only).

**The rules enforced:**

- **`originalUrl`** must be a valid URL (`z.string().url()`).
- **`alias`** (optional): 1–20 chars, only `[A-Za-z0-9_-]`, and **not a reserved word** (`urls`, `api`, `admin`, `health`, `favicon.ico`, …). Reserved words are blocked because an alias like `urls` would collide with real routes.
- **`expiresAt`**: `z.coerce.date()` turns an ISO string into a `Date`, then `.refine()` insists it's **in the future**. Since `createdAt` is "now", "in the future" *is* the "expiresAt must be after createdAt" rule.

**Two special cases that bypass the middleware:**

1. **PATCH body** uses `.partial()` (any subset of fields) plus a `.refine()` that **at least one** field is present — an empty PATCH is a mistake, not a no-op. `expiresAt: null` explicitly **clears** the expiry.
2. **List query** (`?page=&pageSize=`) is parsed **inside the controller**, not via the middleware. Why? Express 5's `req.query` is read-only, so coerced numbers wouldn't survive reassignment. The controller calls `listQuerySchema.safeParse(req.query)` directly — coercing `"2"` → `2`, applying defaults (`page=1`, `pageSize=20`), capping `pageSize` at 100, and rejecting junk like `page=abc` as a 400.

---

## 7. Caching — Deep Dive

Caching exists to make **redirects** fast. A redirect is the hot path (every click hits it), and it only needs two stable fields: `originalUrl` and `expiresAt`. `clickCount` is deliberately **excluded** from the cache because it changes on every hit.

All cache primitives live in `services/cache.service.ts`. Keys:
- `url:<code>` — the cached URL data (or the negative sentinel).
- `lock:<code>` — a short-lived cache-rebuild lock.

### 7.1 Cache-aside pattern

The service uses **cache-aside** (lazy loading): check cache → on miss, load from DB → populate cache → return. Implemented in `resolveCachedUrl()` + `loadFromDbAndCache()` in `url.service.ts`.

A lookup can be in **one of three states** (`lookupCache` returns a discriminated union):

| State | Meaning | Redis content |
|---|---|---|
| `hit` | Real cached value | JSON `{ originalUrl, expiresAt }` |
| `negative` | Known-missing code | the sentinel `__NEGATIVE__` |
| `miss` | Not in cache at all | `null` |

### 7.2 Negative caching (why `__NEGATIVE__`?)

If someone repeatedly requests a code that doesn't exist, every request would fall through to Postgres. To prevent that, a miss that turns up nothing in the DB is cached as the **negative sentinel** with a *short* TTL (`NEGATIVE_CACHE_TTL_SECONDS`, 30s). Repeated 404s are then served from Redis, but a code created moments later isn't stuck returning 404 for long. The sentinel is plain ASCII shaped so it can never collide with real JSON (which starts with `{`).

### 7.3 Cache stampede protection (the rebuild lock)

**Problem:** a popular link's cache entry expires. Suddenly 1,000 concurrent requests all miss at once and all stampede Postgres with the same query.

**Solution:** a distributed lock. In `resolveCachedUrl()`, on a miss:

```
1. acquireRebuildLock(code)  → SET lock:<code> <token> PX <ttl> NX
   - NX = "set only if absent" → exactly ONE caller wins the lock.
2. Winner: loads from DB, populates cache, releases the lock.
3. Losers: sleep 50ms and re-check the cache, up to 5 times, hoping the
   winner has populated it. If still empty, fall back to loading from DB.
```

**Safe release:** `releaseRebuildLock()` deletes the lock **only if the token still matches**, using an atomic Lua script (`get`-then-`del`). This prevents a request whose lock already expired from deleting a *different* request's freshly-acquired lock.

### 7.4 Cache invalidation (keeping it fresh)

Any write that could make the cache stale calls `invalidateUrl(code)` (a Redis `DEL`):

- **Create** — invalidate the new code (clears any lingering *negative* entry, so a code that previously 404'd now resolves immediately).
- **Update** — invalidate the old code; if renaming, invalidate the new code too.
- **Delete** — invalidate the code, so a just-deleted link is never served from Redis.

### 7.5 Full redirect-with-cache flow

```
GET /:code
  └─ resolveForRedirect(code)
       └─ resolveCachedUrl(code)
            ├─ lookupCache → HIT      → return value            (fast path)
            ├─ lookupCache → NEGATIVE → return "not_found"      → 404
            └─ lookupCache → MISS
                 ├─ acquire lock?
                 │    ├─ YES → loadFromDbAndCache
                 │    │         ├─ found     → cacheUrl (TTL 1h) → value
                 │    │         └─ not found → cacheNegative (30s) → "not_found"
                 │    └─ NO  → retry cache up to 5×; else load from DB
       ├─ "not_found"        → throw NotFoundError (404)
       ├─ expired            → throw GoneError (410)
       └─ ok → recordClick(code) → return originalUrl → 302 redirect
```

**Note:** the redirect uses **302** (not 301) so browsers don't cache the redirect — every click must reach the server to be counted.

---

## 8. Rate Limiting — Deep Dive

Implemented in `middlewares/rateLimiter.middleware.ts`, backed by Redis so limits are shared across all app instances. It's a **fixed-window** counter with **tiers**.

### 8.1 Tiers

`resolveTier(req)` decides who you are:

| Tier | Identified by | Default cap | Key |
|---|---|---|---|
| `apikey` | `x-api-key` header | 600 / window | `ratelimit:apikey:<key>` |
| `anon` | client IP (`req.ip`) | 60 / window | `ratelimit:anon:<ip>` |

Window length is `RATE_LIMIT_WINDOW_SEC` (default 60s). Presenting an API key gives you a 10× higher ceiling.

### 8.2 The atomic counter (Lua script)

Each request runs this server-side script — **one round-trip, no race**:

```lua
local current = redis.call("INCR", KEYS[1])   -- increment the counter
if current == 1 then                          -- first hit of a new window?
  redis.call("PEXPIRE", KEYS[1], ARGV[1])     -- set the window's expiry
end
return { current, redis.call("PTTL", KEYS[1]) } -- [count, ms-until-reset]
```

Doing `INCR` and `PEXPIRE` together in one script closes the classic bug where a counter gets incremented but never expires (leaking a permanent limit).

### 8.3 Response headers & rejection

On **every** response the limiter sets standard headers:
- `RateLimit-Limit` — the tier's cap.
- `RateLimit-Remaining` — `max(0, cap − count)`.
- `RateLimit-Reset` — seconds until the window resets.

When `count > max`, it **throws** `RateLimitError(resetSec)`. The central error handler then adds the **`Retry-After`** header and returns **429**. (CORS `exposedHeaders` in `app.ts` is what lets the browser frontend actually read these headers.)

### 8.4 Fail-open

If Redis is unreachable, the limiter **logs and calls `next()`** — it lets the request through rather than failing. A limiter outage must never take down the whole API. (Contrast with the app's *readiness* probe, which *does* report Redis down.)

---

## 9. Click Tracking (Write-Behind Buffer)

Writing one Postgres `UPDATE` per click would be a bottleneck on popular links. Instead, `services/clickTracker.service.ts` uses a **write-behind buffer** in Redis.

**Keys:** `clicks:<code>` (a counter) and `clicks:pending` (a set of codes awaiting flush).

### 9.1 Recording a click (`recordClick`)

Runs on every successful redirect — one pipelined round-trip:
```
MULTI
  INCR clicks:<code>          -- bump this code's buffered count
  SADD clicks:pending <code>  -- remember it needs flushing
EXEC
```

### 9.2 Live stats (`getPendingClicks`)

Stats read the Postgres `clickCount` **plus** the un-flushed Redis buffer, so `getUrlStats` reports a **live** total even between flushes:
```
clickCount = url.clickCount (Postgres) + pending (Redis)
```

### 9.3 Flushing (`flushClicks`, every 10s)

A background interval (started in `index.ts` via `startClickFlush`) drains the buffer:
```
for each code in clicks:pending:
   SREM clicks:pending <code>
   count = GETDEL clicks:<code>     -- atomic read + reset
   if count > 0:  addClicks(code, count)   -- Postgres: click_count += count
```

`GETDEL` (atomic read-and-reset) means clicks arriving *mid-flush* start a fresh counter and re-mark the code pending — **nothing is double-counted**. The DB increment uses Prisma `{ increment: count }`, which compiles to `SET click_count = click_count + count` in one statement (no read-modify-write race between concurrent flushes).

**Failure handling during flush:**
- If the URL was deleted/renamed (Prisma `P2025`), the buffered clicks can never be written → **drop them** (logged as a warning) rather than re-buffer forever.
- Any other (likely transient) error → **re-buffer** via `INCRBY` + re-add to the pending set, to retry next cycle. `INCRBY` (not `SET`) because clicks may have kept arriving after the `GETDEL`.

### 9.4 Shutdown safety

`stopClickFlush()` clears the interval **and does one final flush**, so no buffered clicks are lost when the process exits (see §12).

---

## 10. Error Handling

**Philosophy:** controllers and services **throw**; they never format HTTP errors. Express 5 automatically forwards any thrown/rejected error (even from `async` handlers) to the **single** `errorHandler` registered last in `app.ts`.

`errorHandler` resolves an error to a response in this order:

1. **Headers already sent?** → delegate to Express's default (can't change status mid-stream).
2. **`RateLimitError`** → set `Retry-After`, return 429 `{ error, message }`.
3. **`ValidationError`** → 400 `{ error, message, details }`.
4. **Any other `AppError`** (NotFound, Conflict, Gone) → its `statusCode` + `{ error, message }`.
5. **Errors carrying a 4xx `status`/`statusCode`** (e.g. `express.json()` on malformed JSON) → honor that client-error status instead of masking it as 500.
6. **Anything else** = unexpected bug → log the full error, return a generic **500** `{ error: "InternalServerError" }` so internals (stack traces, SQL) never leak to clients.

Every error response shares the same JSON shape: `{ error: <code>, message: <text> }` (plus `details` for validation).

---

## 11. Complete CRUD Workflows

Below is the **end-to-end journey** of every operation — route → validation → controller → service → repository → datastores — including exactly where caching, rate limiting, and click buffering come into play.

> Every one of these requests first passes through the global pipeline: **CORS → requestLogger → rateLimiter → express.json()**. The rate limiter runs on *all* of them and can short-circuit any with a 429. That step is omitted below for brevity but always happens first.

### 11.1 CREATE — `POST /urls`

**Route:** `validate(createUrlSchema)` → `createUrl` controller → `createShortUrl` service.

**Workflow:**
1. **Validate** body: `originalUrl` is a URL; `alias` (optional) passes alias rules & isn't reserved; `expiresAt` (optional) is in the future.
2. Controller calls `createShortUrl({ originalUrl, alias, expiresAt: expiresAt ?? null })`.
3. **Service, two paths:**
   - **With a custom alias:** `insertUrl` with `code = alias`. If Postgres raises a **unique violation (`P2002`)**, throw **`ConflictError` (409)** — the alias is taken, and it's the caller's problem, so *no retry*. On success, `invalidateUrl(alias)` clears any stale **negative** cache entry (so a code that previously 404'd now resolves).
   - **Without an alias:** generate a random 7-char nanoid code (64⁷ ≈ 4.4 trillion possibilities). Try `insertUrl`; on the rare `P2002` collision, **loop and retry** (up to 5 attempts). After 5 failures, throw a generic error. On success, `invalidateUrl(code)`.
4. **Repository:** `prisma.url.create(...)` inserts the row (defaults: `id` uuid, `createdAt` now, `clickCount` 0).
5. **Response 201:** `{ code, originalUrl, shortUrl, expiresAt, createdAt }`, where `shortUrl = <protocol>://<host>/<code>`.

**Cache role:** *invalidate only* — clears any negative entry so the new link is immediately resolvable.

### 11.2 READ (redirect) — `GET /:code`

The **hot path**. This is where caching, stampede protection, and click buffering all fire.

**Route:** `validate(codeParamsSchema)` → `redirectToCode` controller → `resolveForRedirect` service.

**Workflow:**
1. Validate `code` param (1–20 chars).
2. `resolveForRedirect(code)` → `resolveCachedUrl(code)` (the full cache-aside + stampede flow from §7.5):
   - **Cache hit** → return `{ originalUrl, expiresAt }` immediately.
   - **Negative hit** → `"not_found"`.
   - **Miss** → acquire rebuild lock; winner loads from Postgres (`findByCode`) and caches (positive with 1h TTL, or negative with 30s TTL); losers retry the cache, then fall back to DB.
3. **Post-resolution checks:**
   - `"not_found"` → throw **`NotFoundError` (404)**.
   - `expiresAt` in the past → throw **`GoneError` (410)**.
4. **`recordClick(code)`** — buffer the click in Redis (`INCR` + `SADD pending`), *not* a Postgres write.
5. **Respond `302`** redirect to `originalUrl` (302 so the redirect isn't browser-cached).

**Cache role:** *full cache-aside read*, negative caching, stampede lock.
**Click role:** *buffered*, flushed to Postgres later.

### 11.3 READ (stats) — `GET /urls/:code/stats`

**Route:** `validate(codeParamsSchema)` → `getStats` → `getUrlStats`.

**Workflow:**
1. Validate `code`.
2. `getUrlStats(code)`:
   - `findByCode(code)` from **Postgres** (stats read the source of truth directly — *not* the cache, since they need `clickCount`, `lastAccessedAt`, etc.). Missing → **404**.
   - `getPendingClicks(code)` reads the **un-flushed Redis buffer**.
   - Returns `clickCount = Postgres count + pending buffer` for a **live** figure.
3. **Respond 200:** `{ code, originalUrl, clickCount, createdAt, lastAccessedAt, expiresAt }`.

**Cache role:** *none for the URL data* (goes straight to Postgres); **Redis is read for the live click delta.**

### 11.4 UPDATE — `PATCH /urls/:code`

**Route:** `validate(updateUrlSchema)` → `updateUrlHandler` → `updateUrl` service.

**Workflow:**
1. **Validate:** partial body, at least one of `alias` / `expiresAt`. `expiresAt: null` clears expiry; a future date sets it; omitted leaves it as-is.
2. `updateUrl(code, { alias, expiresAt })`:
   - `findByCode(code)` — missing → **`NotFoundError` (404)**.
   - **Renaming?** (`alias` provided and different from current `code`.) If so, pre-check `findByCode(newAlias)`; if taken → **`ConflictError` (409)**.
   - `updateUrlRecord(code, { code: renaming ? alias : undefined, expiresAt })` — Prisma writes **only the provided fields** (that's how PATCH does a partial update). A `P2002` here (race on the alias) is also mapped to **409**.
   - **Invalidate cache:** `invalidateUrl(oldCode)`, and if renaming, `invalidateUrl(newAlias)` too — so redirects never serve stale data.
3. **Respond 200:** the updated `{ code, originalUrl, shortUrl, expiresAt, createdAt }`.

**Cache role:** *invalidate* old (and new) code after the write.

### 11.5 LIST — `GET /urls?page=&pageSize=`

**Route:** `listUrls` controller → `listShortUrls` service. (Validation happens **in the controller**, see §6.)

**Workflow:**
1. Controller `safeParse`s the query: coerces `page`/`pageSize` to numbers, defaults (1 / 20), caps `pageSize` at 100; invalid → **400**.
2. `listShortUrls({ page, pageSize })` computes `skip = (page − 1) × pageSize`.
3. `listUrlRecords({ skip, take })` runs **`findMany` (newest-first) and `count` in one Prisma `$transaction`**, so the total is consistent with the returned page.
4. **Respond 200:** `{ items: [...], total, page, pageSize }`, each item including its `shortUrl`.

**Cache role:** *none* — listing always reads live from Postgres (and needs an accurate total).

### 11.6 DELETE — `DELETE /urls/:code`

**Route:** `validate(codeParamsSchema)` → `deleteUrlHandler` → `deleteShortUrl`.

**Workflow:**
1. Validate `code`.
2. `deleteShortUrl(code)`:
   - `findByCode(code)` — missing → **`NotFoundError` (404)**.
   - `deleteUrlRecord(code)` — Prisma `delete`.
   - `invalidateUrl(code)` — clear the cache so a just-deleted link is never served from Redis.
3. **Respond `204 No Content`.**

**Cache role:** *invalidate* after delete.
**Click note:** any clicks still buffered for a now-deleted code are safely **dropped** at the next flush (the `P2025` branch in §9.3).

### 11.7 CRUD-at-a-glance

| Operation | Method & path | Success | Cache interaction | Errors |
|---|---|---|---|---|
| Create | `POST /urls` | 201 | invalidate (clear negative) | 400, 409 |
| Redirect | `GET /:code` | 302 | **read (cache-aside + stampede)**; buffer click | 404, 410 |
| Stats | `GET /urls/:code/stats` | 200 | none (reads DB + click buffer) | 404 |
| Update | `PATCH /urls/:code` | 200 | invalidate old (+ new) | 400, 404, 409 |
| List | `GET /urls` | 200 | none | 400 |
| Delete | `DELETE /urls/:code` | 204 | invalidate | 404 |

---

## 12. Startup & Graceful Shutdown

**Startup (`index.ts`):**
1. `prisma.$connect()` — verify Postgres (fail fast if down).
2. `redis.ping()` — verify Redis.
3. `startClickFlush()` — begin the 10s flush loop.
4. `createApp()` + `app.listen(PORT)`.
5. `registerShutdown(server)`.

**Graceful shutdown** (on `SIGTERM` / `SIGINT`):
1. Ignore repeated signals; arm a **10s force-exit** timer (unref'd, so it doesn't keep the process alive).
2. `server.close()` — stop accepting new connections; let in-flight requests finish.
3. `stopClickFlush()` — stop the interval **and do one final flush** (no clicks lost).
4. `prisma.$disconnect()` + `redis.quit()`.
5. `process.exit(0)` (or `1` on error, or if the timeout fires).

This ordering guarantees that when the container is told to stop, buffered clicks are persisted and connections are closed cleanly before the process dies.

---

## Appendix — Where to Look for What

| I want to change... | Edit this file |
|---|---|
| A validation rule (alias, expiry, reserved words) | `types/url.schema.ts` |
| Cache TTLs / rate-limit caps / flush interval | `config/env.ts` (or `.env`) |
| Caching behavior (stampede, negative cache) | `services/cache.service.ts` + `services/url.service.ts` |
| Rate-limit tiers / algorithm | `middlewares/rateLimiter.middleware.ts` |
| Click buffering / flushing | `services/clickTracker.service.ts` |
| A business rule (collisions, expiry) | `services/url.service.ts` |
| A raw DB query | `repositories/url.repository.ts` |
| HTTP request/response shape | `controllers/url.controller.ts` |
| Routes / route order | `routes/url.routes.ts` |
| Error → HTTP mapping | `middlewares/errorHandler.middleware.ts` |
| The middleware pipeline order | `app.ts` |
| The data model / table schema | `prisma/schema.prisma` |
