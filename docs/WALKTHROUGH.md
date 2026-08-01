# Link Shortener — Full Walkthrough & Decision Log

This document explains **every technology, every decision, and every file** in the
project — written so you can defend any part of it in a code review. Read it
top-to-bottom once; after that it's a reference.

---

## 1. The big picture

A URL shortener does two things at very different rates:

- **Writes** (creating a link): rare.
- **Reads** (redirecting a link): potentially enormous — one popular link can be
  hit thousands of times per second.

So the whole architecture is built around one idea: **make reads cheap.** Postgres
is the durable, correct, but disk-bound *source of truth*; Redis is the in-memory
*fast path* that absorbs read load. Everything else (validation, layering, logging)
is about keeping that fast path **correct** and the service **maintainable**.

### Request flow (the layered architecture)

```
HTTP request
   │
   ▼
routes/          maps METHOD + path  →  a handler chain
   │
   ▼
middlewares/     validate() checks input with Zod; rejects bad requests (400)
   │
   ▼
controllers/     read the request, call a service, shape the HTTP response
   │                (NO business logic, NO database access)
   ▼
services/        business logic: code generation, caching, expiry rules
   │                (knows NOTHING about req/res)
   ▼
repositories/    the ONLY place database queries live
   │
   ▼
Postgres  +  Redis
```

**Why layer at all?** Each file has *one job*, so each is easy to understand, test,
and change in isolation. The proof: when we swapped the database library from `pg`
to Prisma, only the repository changed — services and controllers didn't move,
because they never knew which database library was underneath. That is the entire
point of the repository pattern.

---

## 2. Why each technology (the problem each one solves)

### TypeScript (not JavaScript)
JavaScript has no idea what shape your data is until the code runs, so typos,
wrong function arguments, and `null`/`undefined` bugs only surface at runtime — in
production. TypeScript checks types at **compile time**, moving a whole class of
bugs into your editor. The catch: **types are erased at runtime**, so anything
crossing a runtime boundary (env vars, HTTP bodies, DB rows) still needs a runtime
check — which is why Zod exists.

### Express (the web framework)
A thin, well-understood HTTP layer: routing, middleware, `req`/`res`. We use
**Express 5**, which automatically forwards errors thrown in `async` handlers to the
error handler — one less thing to get wrong.

### PostgreSQL (the source of truth)
A relational database gives us three things a cache can't:
- **Constraints enforced by the DB** — `code` is `UNIQUE`, so two links can *never*
  share a code, even under concurrent inserts. The database guarantees it.
- **ACID transactions** — writes are all-or-nothing.
- **Durability** — data survives restarts (written to disk).

### Redis (the fast path)
An **in-memory** key/value store: microsecond reads vs Postgres's milliseconds.
It plays four roles here: redirect cache, negative cache, stampede lock, and click
counter. You never keep your *only* copy of data in Redis (it's a cache), but it's
perfect for fast, disposable, expiring data.

### Prisma (the ORM)
`schema.prisma` is the single source of truth for the data model. From it Prisma
generates a **type-safe client** (`prisma.url.create(...)` with autocomplete and
compile errors on bad fields) and **SQL migrations**. It also maps snake_case
columns to camelCase fields automatically. Trade-off: less control over exact SQL,
plus a codegen step — worth it for the type safety.

### Zod (runtime validation)
The runtime check TypeScript can't do. One schema gives us **both** runtime
validation **and** a static type (`z.infer`). Used for env vars *and* every request
body/params.

### pino (logging)
Structured **JSON** logs — ugly to read by eye, but trivial for log tooling to
search and filter. `console.log` strings are the opposite.

### Docker + docker-compose (the environment)
Covered in depth in section 3.

---

## 3. Docker & docker-compose in depth

### The problem Docker solves
The app needs specific versions of Postgres and Redis, configured a specific way.
Without Docker, every machine installs those by hand and drifts out of sync — the
"works on my machine" bug. Docker fixes this with two concepts:

- **Image**: a frozen, complete snapshot of a piece of software + everything it
  needs to run. The official `postgres:16-alpine` image *is* Postgres 16, identical
  everywhere.
- **Container**: a running instance of an image, isolated from your machine.

So instead of *installing* Postgres, we *run its image*.

### Why docker-compose
Our app is three processes (app + Postgres + Redis) that must find and talk to each
other. `docker-compose.yml` declares all three in one file, starts them with one
command (`docker compose up`), and puts them on a **private virtual network** where
they reach each other **by service name**.

### Key parts of our `docker-compose.yml`
- **`image:`** — pull a pre-made image (Postgres, Redis). We don't build these.
- **`build: .`** (app service) — build *our* image from the `Dockerfile`, because no
  pre-made image of our code exists.
- **`ports: "5433:5432"`** — `host:container`. Maps the container's port 5432 to
  **host** port 5433. (We used 5433 because a natively-installed Postgres already
  owned host 5432 — a real conflict we hit and fixed.)
- **`environment:`** — config passed into the container. Note the app service's
  `DATABASE_URL` uses host **`postgres`** (the service name), NOT `localhost`,
  because inside a container `localhost` means *the container itself*. This is the
  single most important networking concept in Compose.
- **`volumes: postgres-data`** — a **named volume** that persists the database files
  even if the container is removed. Without it, `docker compose down` would wipe the
  DB. (Gotcha learned: `POSTGRES_PASSWORD` only takes effect the *first* time a
  volume is initialized — changing it later requires recreating the volume.)
- **`healthcheck:`** — a container is "started" long before it's "ready." The
  healthcheck (`pg_isready`, `redis-cli ping`) teaches Compose when a service can
  actually accept connections, so `depends_on: condition: service_healthy` makes the
  app wait. Note: a *healthy* container isn't necessarily reachable from the host —
  the healthcheck runs *inside* the container.

### The multi-stage `Dockerfile`
Two stages, for a lean, secure production image:
- **build stage**: has the full toolchain, runs `npm ci` (all deps) and `tsc`
  (TypeScript → JavaScript in `dist/`).
- **runtime stage**: starts fresh, installs **only production deps** (`npm ci
  --omit=dev`), copies in *just* the compiled `dist/`, and runs as a non-root user.

The final image contains **no TypeScript, no dev dependencies, no source `.ts`** —
smaller and less attack surface. Layer-caching trick: we copy `package*.json` and
install deps *before* copying source, so editing code doesn't re-run the slow
install.

---

## 4. How we use Redis (the four patterns)

All four live behind the `cache.service.ts` and `clickTracker.service.ts` helpers,
so the rest of the app never touches Redis directly.

### 4.1 Cache-aside (redirect read path)
```
lookup Redis  →  HIT: use it (no DB)
              →  MISS: read Postgres, then WRITE result into Redis with a TTL
```
Key: `url:<code>` → JSON `{ originalUrl, expiresAt }` (we cache only the *stable*
fields, never `clickCount`). TTL: `CACHE_TTL_SECONDS` (1 hour) — long enough to
absorb traffic, short enough to self-heal if an invalidation is missed.

### 4.2 Negative caching
A request for a code that *doesn't exist* would miss the cache and hit Postgres
every time — a bot spraying random codes could hammer the DB. So we cache the
**absence** too: `url:<code>` → the sentinel `__NEGATIVE__`, with a **short** TTL
(`NEGATIVE_CACHE_TTL_SECONDS`, 30s). Short so a code created moments later isn't
stuck 404-ing for long.

### 4.3 Stampede protection (the lock)
When a **hot** key expires, hundreds of simultaneous requests all miss at once and
all stampede Postgres for the same value ("thundering herd"). Fix: a Redis lock via
`SET NX PX` (set-if-absent, with an auto-expiry). Only the **one** request that wins
the lock rebuilds the cache; the rest briefly wait and re-read, then fall back to
the DB if the rebuilder is slow. Releasing uses a **Lua script** that compares a
token before deleting — so you never delete a lock that already expired and was
re-acquired by someone else.

### 4.4 Click counting (buffer + flush)
Counting every click as a Postgres write is expensive. Instead:
- On redirect: `INCR clicks:<code>` (in-memory, atomic) + add the code to a
  `clicks:pending` set. One pipelined round-trip, no DB.
- A background job every `CLICK_FLUSH_INTERVAL_MS` (10s) drains each pending code
  with `GETDEL` (atomic read-and-reset) and writes the total to Postgres.
- Stats stay accurate by adding the un-flushed Redis buffer to the Postgres count.

Result: 1000 clicks = 1000 fast Redis ops + **1** Postgres write, instead of 1000
DB writes.

---

## 5. File-by-file

### Config
- **`src/config/env.ts`** — Zod schema for all environment variables. Validates
  `process.env` at startup with `safeParse` and **exits the process** if anything is
  missing/malformed (fail-fast). Exports a fully-typed `env` object. `dotenv/config`
  at the top loads the `.env` file into `process.env` first.
- **`src/config/db.ts`** — the single shared `PrismaClient` (manages its own
  connection pool). Created once; reused everywhere.
- **`src/config/redis.ts`** — the single shared `ioredis` client. Note the
  `import { Redis } from "ioredis"` *named* import (the ESM/CommonJS-correct form for
  this package).

### The layers
- **`src/routes/url.routes.ts`** — maps each METHOD+path to `validate(schema)` then a
  controller. Order matters: the catch-all `GET /:code` is registered **last** so it
  doesn't shadow `/urls/...`.
- **`src/middlewares/validate.middleware.ts`** — generic Zod validator. Runs a schema
  against `{ body, params, query }`; on failure responds 400 with the issues; on
  success replaces `req.body` with the parsed (coerced) value. Only `req.body` is
  reassigned because Express 5 makes `req.query`/`req.params` read-only.
- **`src/controllers/url.controller.ts`** — one function per endpoint. Reads the
  validated request, calls a service, maps the service's result to an HTTP status
  (201/200/302/404/409/410). No logic, no SQL.
- **`src/services/url.service.ts`** — the business logic: `createShortUrl`
  (custom-alias vs random-code-with-retry), `resolveForRedirect` (cache-aside +
  stampede + expiry), `getUrlStats` (live count), `updateUrl` (PATCH + cache
  invalidation). Returns **result unions** (`{ status: "..." }`) so the controller,
  not the service, decides HTTP codes.
- **`src/services/cache.service.ts`** — all Redis *caching* helpers: `lookupCache`,
  `cacheUrl`, `cacheNegative`, `invalidateUrl`, and the lock (`acquireRebuildLock`,
  `releaseRebuildLock`).
- **`src/services/clickTracker.service.ts`** — Redis click buffering (`recordClick`,
  `getPendingClicks`) and the periodic `flushClicks` job with `startClickFlush` /
  `stopClickFlush`.
- **`src/repositories/url.repository.ts`** — the ONLY file with database queries:
  `insertUrl`, `findByCode`, `addClicks`, `updateUrlRecord`. Re-exports Prisma's
  generated `Url` type so nothing else imports Prisma directly.
- **`src/schemas/url.schema.ts`** — Zod schemas: `createUrlSchema`, `updateUrlSchema`
  (`.partial()`), `codeParamsSchema`, plus the reserved-alias blocklist and the
  `expiresAt`-must-be-future `.refine()`.

### App shell
- **`src/utils/logger.ts`** — the shared pino logger.
- **`src/app.ts`** — builds the Express app (a factory, so tests can create an
  instance without opening a network port), registers `express.json()` and the
  routes.
- **`src/index.ts`** — the entrypoint. Connects to Postgres and Redis (fail-fast),
  starts the click-flush job, then starts the HTTP server.

### Data & infra
- **`prisma/schema.prisma`** — the data model (the `Url` model + `@map` to snake_case
  columns). Source for the generated client and migrations.
- **`prisma/migrations/`** — Prisma-managed SQL migration history (commit this).
- **`docker-compose.yml`**, **`Dockerfile`**, **`.dockerignore`** — see section 3.
- **`.env.example`** (committed) documents every variable; **`.env`** (git-ignored)
  holds real values.

---

## 6. Phase-by-phase changes

- **Phase 1 — Setup:** TS project + strict `tsconfig`, folder structure, Zod-validated
  env, Docker Compose stack with healthchecks, multi-stage Dockerfile.
- **Phase 2 — Core CRUD:** Prisma data layer + migration; `POST /urls` (random code +
  DB-unique collision retry), `GET /:code` (302 redirect + click tracking),
  `GET /urls/:code/stats`. All through controller→service→repository.
- **Phase 3 — Caching:** cache-aside on redirects, negative caching, stampede lock,
  click counts buffered in Redis and flushed to Postgres on an interval.
- **Phase 4 — Validation depth:** custom aliases with a reserved-word blocklist, PATCH
  with a `.partial()` schema, `expiresAt` must be in the future via `.refine()`, and
  cache invalidation on update (3F).

---

## 7. Endpoint lifecycles (trace these in review)

**`POST /urls`** → validate body (URL, optional alias, optional future expiry) →
service generates/uses a code, inserts, clears negative cache → 201 with `shortUrl`.
Custom alias already taken → 409.

**`GET /:code`** → validate code → cache lookup (hit / negative / miss) → on miss,
lock + read Postgres + populate cache → expiry check → `recordClick` (Redis) → 302
redirect. Missing → 404, expired → 410.

**`GET /urls/:code/stats`** → find in Postgres → add un-flushed Redis clicks → JSON
(clickCount converted from BigInt to Number). Missing → 404.

**`PATCH /urls/:code`** → validate partial body → service updates alias/expiry →
invalidate cache for old (and new) code → 200 with updated resource. Missing → 404,
new alias taken → 409.
