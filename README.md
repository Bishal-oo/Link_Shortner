# Link Shortener API

A backend service that shortens URLs and tracks click analytics. Built to practice
production-grade architecture: layered design, caching, validation, rate limiting,
observability, and resilience.

## Tech Stack

| Concern | Choice | Why |
| --- | --- | --- |
| Language | TypeScript (ESM) | Compile-time type safety; catch bugs before runtime |
| Framework | Express 5 | Minimal HTTP layer; auto-forwards async errors |
| Database | PostgreSQL via **Prisma** | Durable source of truth; DB-enforced constraints + type-safe client |
| Cache | Redis (`ioredis`) | In-memory speed for reads, counters, locks, rate limits |
| Validation | Zod | Runtime validation of data crossing trust boundaries |
| Logging | pino | Structured JSON logs with per-request correlation IDs |
| Tests | Jest + supertest | Integration testing |
| Container | Docker + docker-compose | Reproducible, one-command stack |

## Prerequisites

- Node.js 20+
- Docker Desktop (running)

## Getting Started

```bash
# 1. Create your local env file from the template
cp .env.example .env

# 2. Bring up the full stack (app + postgres + redis)
docker compose up -d --build

# The API is now on http://localhost:3000
```

> Note: the compose file publishes Postgres on host port **5433** (to avoid clashing
> with a natively-installed Postgres on 5432). The in-container app still uses 5432.

### Local development (hot reload)

Run the datastores in Docker but the app on your host so it reloads on save:

```bash
docker compose up -d postgres redis   # datastores only
npm install
npx prisma migrate dev                 # apply migrations (first time)
npm run dev                            # tsx watch, restarts on change
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Run with hot reload (tsx) |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm start` | Run the compiled app (`node dist/index.js`) |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Run the Jest + supertest integration tests |

## Environment Variables

All variables are validated with Zod at startup (`src/config/env.ts`) — the app
refuses to boot if any required var is missing or malformed. See `.env.example`
for the full list (DB/Redis URLs, cache TTLs, lock/flush timings, rate limits).

---

## Execution Flow

### 1. Startup (`src/index.ts`)

```
node dist/index.js
  → import "dotenv/config"        # load .env into process.env
  → env.ts validates process.env  # FAIL FAST: exit(1) if invalid
  → prisma.$connect()             # FAIL FAST: exit if Postgres unreachable
  → redis.ping()                  # FAIL FAST: exit if Redis unreachable
  → startClickFlush()             # begin the 10s click-buffer flush timer
  → createApp()                   # build the Express middleware chain
  → server.listen(PORT)           # start accepting requests
  → registerShutdown(server)      # wire SIGTERM/SIGINT handlers
```

The service will not start unless its config is valid **and** both datastores are
reachable — a half-connected server never accepts traffic.

### 2. Per-request middleware chain (`src/app.ts`)

Every request flows through these in order:

```
request
  → healthRouter        # /health, /ready short-circuit here (not logged/limited)
  → requestLogger       # assign correlation id, run rest inside AsyncLocalStorage
  → rateLimiter         # Redis fixed-window; 429 if over limit
  → express.json()      # parse JSON body
  → urlRouter           # match POST /urls, GET /:code, etc.
      → validate(schema)   # Zod; throws ValidationError (→400) on bad input
      → controller         # read request, call service, send success response
          → service        # business logic (cache-aside, code gen, expiry)
              → repository (Postgres)  and/or  cache/click services (Redis)
  → 404 handler         # unmatched routes → NotFoundError
  → errorHandler        # turns any thrown error into a consistent JSON response
```

Example — **`GET /:code` (redirect):** `validate` → `redirectToCode` →
`resolveForRedirect` → check Redis (`cache-aside`), on miss take a rebuild lock and
read Postgres then back-fill Redis → check expiry → buffer a click in Redis → return
`302` with the original URL. A cache **hit** touches Postgres zero times.

### 3. Background job

`startClickFlush()` runs every `CLICK_FLUSH_INTERVAL_MS` (10s): it drains the
buffered click counters from Redis and writes the totals to Postgres in one update
per link — turning thousands of click-writes into a handful.

### 4. Graceful shutdown

On `SIGTERM`/`SIGINT`:

```
stop accepting new connections (server.close)
  → final flush of the click buffer (no clicks lost)
  → prisma.$disconnect() + redis.quit()
  → exit(0)          # or exit(1) via a 10s force-exit safety net
```

---

## API Endpoints

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/urls` | Create a short link (optional `alias`, `expiresAt`) |
| GET | `/:code` | Redirect to the original URL (302) + count a click |
| GET | `/urls/:code/stats` | Click count, created/last-accessed, expiry |
| PATCH | `/urls/:code` | Update alias and/or expiry (partial) |
| GET | `/health` | Liveness |
| GET | `/ready` | Readiness (Postgres + Redis reachable) |

Import `docs/postman_collection.json` into Postman for ready-made requests.

## Caching Strategy

The redirect path is read-heavy and the `code → originalUrl` mapping rarely
changes, so Redis fronts Postgres:

- **Cache-aside** on `GET /:code`: check Redis first; on a miss, read Postgres and
  back-fill Redis with a **1-hour TTL** (`CACHE_TTL_SECONDS`). We cache only the
  stable fields (`originalUrl`, `expiresAt`) — never the ever-changing click count.
- **Negative caching**: a missing code is cached as a sentinel with a **short 30s
  TTL** so bots probing random codes can't hammer Postgres, while a code created
  moments later isn't stuck 404-ing for long.
- **Stampede protection**: when a hot key expires, a Redis `SET NX` lock ensures
  only **one** request rebuilds the cache; the rest briefly wait and re-read. The
  lock is released with a Lua compare-and-delete so it's never released by the
  wrong owner.
- **Click buffering**: clicks are `INCR`'d in Redis and flushed to Postgres every
  10s. Stats add the un-flushed Redis buffer to the Postgres count so they stay
  live. Chosen TTLs/timings are all env-configurable.
- **Invalidation**: updating a link `DEL`s its cache entry (old and new code), so
  the next read rebuilds from the source of truth.

## Testing

```bash
docker compose up -d postgres redis   # datastores must be running
npm test
```

The integration test (`tests/url.test.ts`) does the full loop: **create a link →
redirect → confirm the cache was populated → check stats reflect the click**, then
cleans up its data.

## Further Docs

- `docs/WALKTHROUGH.md` — architecture, tech decisions, file-by-file roles.
- `docs/CODE_GUIDE.md` — TypeScript syntax primer + line-by-line walkthrough.
- `docs/postman_collection.json` — importable API requests.

## Status

- [x] **Phase 1** — Project setup, Zod-validated env, Docker stack with healthchecks
- [x] **Phase 2** — Core CRUD (create, redirect, stats) on Prisma
- [x] **Phase 3** — Caching (cache-aside, negative cache, stampede lock, click buffering)
- [x] **Phase 4** — Validation depth (PATCH, reserved aliases, expiry rules)
- [x] **Phase 5** — Rate limiting (tiered anon vs API-key, Redis-backed)
- [x] **Phase 6** — Logging & observability (correlation IDs, /health, /ready)
- [x] **Phase 7** — Resilience (typed errors, graceful shutdown)
- [x] **Phase 8** — Integration test
- [x] Bonus — Multi-stage Dockerfile

## What I'd Improve With More Time

- **Sliding-window rate limiting** (current fixed window allows a boundary burst).
- **API-key validation** against a real store (today any key grants the higher tier).
- **Pagination + filtering** on a `GET /urls` list endpoint.
- **Metrics** (Prometheus) for cache hit rate, flush lag, and rate-limit rejections.
- **`prisma generate` in a postinstall hook** so a fresh clone is ready after `npm install`.
