# Link Shortener API

A backend service that shortens URLs and tracks click analytics. Built to practice
production-grade architecture: layered design, caching, validation, rate limiting,
and observability.

## Tech Stack

| Concern | Choice | Why |
| --- | --- | --- |
| Language | TypeScript (ESM) | Compile-time type safety; catch bugs before runtime |
| Framework | Express 5 | Minimal, well-understood HTTP layer |
| Database | PostgreSQL (`pg`) | Durable source of truth; constraints + ACID |
| Cache | Redis (`ioredis`) | In-memory speed for reads, counters, rate limits |
| Validation | Zod | Runtime validation of data crossing trust boundaries |
| Logging | pino | Structured JSON logs |
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

### Local development (with hot reload)

For day-to-day development, run the databases in Docker but the app on your host
so it reloads instantly on save:

```bash
docker compose up -d postgres redis   # datastores only
npm install
npm run dev                            # tsx watch, restarts on change
```

## Environment Variables

All variables are validated with Zod at startup (`src/config/env.ts`) — the app
refuses to boot if any required var is missing or malformed. See `.env.example`
for the full list.

## Project Structure

```
src/
  index.ts            # entrypoint: starts the server
  app.ts              # express app + middleware wiring
  config/             # env + (later) db/redis clients
  routes/             # route definitions
  controllers/        # request/response handling only
  services/           # business logic
  repositories/       # all SQL lives here
  middlewares/        # validation, rate limiting, logging, errors
  schemas/            # zod schemas
  errors/             # typed error classes
  utils/              # logger, helpers
migrations/           # versioned SQL schema changes
tests/                # integration tests
```

## Status / Roadmap

- [x] **Phase 1** — Project setup, Zod-validated env, Docker stack with healthchecks
- [ ] **Phase 2** — Core CRUD (create, redirect, stats) against Postgres
- [ ] **Phase 3** — Caching (cache-aside, negative cache, stampede lock, click buffering)
- [ ] **Phase 4** — Validation depth (PATCH, reserved aliases, expiry rules)
- [ ] **Phase 5** — Rate limiting (tiered, Redis-backed)
- [ ] **Phase 6** — Logging & observability (correlation IDs, health/ready)
- [ ] **Phase 7** — Resilience (typed errors, graceful shutdown)
- [ ] **Phase 8** — Tests

## Caching Strategy

_To be documented in Phase 3._

## What I'd Improve With More Time

_To be documented before submission._
