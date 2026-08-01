# Code Guide — line by line, syntax, and "why"

This is the deep reference. It has four parts:

1. **TypeScript syntax primer** — every syntax pattern our code uses, explained once.
2. **File-by-file walkthrough** — each file, its lines, and how it connects to others.
3. **Why each technology/concept exists** — the "why use it at all" the PDF asks for.
4. **Postman testing guide.**

Read Part 1 first; then the file walkthroughs will read easily because the syntax is already explained.

---

# Part 1 — TypeScript syntax primer

### Imports / exports (ES Modules)
```ts
import { z } from "zod";              // named import: grab the `z` export
import express from "express";        // default import: the module's default export
import type { Request } from "express"; // TYPE-only import: erased at compile time
export const env = ...;               // named export
export function createApp() { ... }   // named export of a function
export default something;             // default export (we rarely use this)
```
- **`import type { X }`** imports something used *only as a type*. It's deleted when compiled to JS (types don't exist at runtime). Seen all over our repositories/services.
- **The `.js` in `import { x } from "./foo.js"`** — even though the file is `foo.ts`. In ES Modules you import the path that exists *after compilation*, and `foo.ts` compiles to `foo.js`. This is everywhere in our code.

### Types vs interfaces
```ts
interface CachedUrl { originalUrl: string; expiresAt: string | null; }
type RedirectResult = { status: "ok" } | { status: "expired" };
```
- **`interface`** describes the shape of an object. **`type`** is more general (can be unions, primitives, etc.). For object shapes they're interchangeable; we use `interface` for records and `type` for unions.
- **`string | null`** is a **union type**: "a string OR null." **`Date | null`**, `number | undefined`, etc. appear everywhere.
- **`{ status: "ok" } | { status: "expired" }`** is a **discriminated union** — several object shapes distinguished by a common literal field (`status`). We used these before Phase 7.

### Optional and nullish
```ts
alias?: string          // optional property — may be absent (string | undefined)
expiresAt ?? null       // nullish coalescing: use left unless it's null/undefined
req.ip ?? "unknown"     // if req.ip is null/undefined, use "unknown"
store?.reqId            // optional chaining: if store is null/undefined, result is undefined
```
- **`?`** after a property name = optional. After a value with `?.` = optional chaining.
- **`??`** = "if the thing on the left is `null`/`undefined`, use the right." (Different from `||`, which also triggers on `0`/`""`.)

### Generics (type parameters)
```ts
function query<T>(text: string): Promise<QueryResult<T>> { ... }
new AsyncLocalStorage<RequestContext>()
z.infer<typeof createUrlSchema>
```
- **`<T>`** is a placeholder type filled in by the caller — like a function argument, but for types. `Promise<string>` means "a promise that resolves to a string."
- **`typeof createUrlSchema`** takes the *runtime value* and gets its *type*. **`z.infer<...>`** then extracts the TS type a Zod schema validates — one definition, both a runtime check and a static type.

### async / await and Promises
```ts
export async function findByCode(code: string): Promise<Url | null> {
  return prisma.url.findUnique({ where: { code } });
}
const url = await findByCode("abc");
```
- **`async`** marks a function that returns a **`Promise`** (an eventual value). **`await`** pauses until a promise resolves and gives you the value. Anything doing I/O (DB, Redis, network) is async in our code.
- **`.catch(err => ...)`** handles a rejected promise; **`try { await ... } catch (err) { ... }`** does the same with syntax.

### Arrow functions and destructuring
```ts
const urlKey = (code: string) => `url:${code}`;     // arrow function, implicit return
const { code } = req.params;                          // destructuring: pull `code` out
const { tier, id } = resolveTier(req);                // pull multiple fields
`url:${code}`                                          // template literal (backticks) with ${}
```
- **`(x) => y`** is a compact function. With `{ }` it needs an explicit `return`.
- **`const { a } = obj`** creates a variable `a` from `obj.a`. Used constantly for `req.params`, results, etc.
- **Backtick strings** allow `${expression}` interpolation.

### Type assertions and guards
```ts
const body = req.body as CreateUrlBody;                 // "trust me, it's this type"
err instanceof Prisma.PrismaClientKnownRequestError     // runtime type check (type guard)
```
- **`as X`** tells the compiler "treat this as type X" (no runtime effect). We use it where a value's static type is `any`/`unknown` but we know its real shape (validated `req.body`).
- **`instanceof`** is a *real* runtime check that also narrows the type in the `if` branch.

### Classes
```ts
export class AppError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);            // call the parent (Error) constructor
    this.statusCode = statusCode;
  }
}
```
- **`class ... extends`** — inheritance. **`super(...)`** calls the parent constructor. **`readonly`** = set once, never reassigned. **`this`** = the instance.

---

# Part 2 — File-by-file walkthrough

Order follows dependencies: config → utils → schema → repository → cache/clicks → service → middleware/errors → controller → routes → app → entrypoint.

## `src/config/env.ts`
```ts
import "dotenv/config";
```
Runs `dotenv` for its side effect: read the `.env` file and load it into `process.env`. **Must be first**, before we read any env var. (`import "x"` with no bindings = "run this module for its side effects.")
```ts
import { z } from "zod";
```
The validation library.
```ts
const envSchema = z.object({
  NODE_ENV: z.enum(["development","test","production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  ...
  DATABASE_URL: z.string().url(),
  ...
});
```
Builds a schema object. **`z.enum([...])`** = must be one of these strings. **`z.coerce.number()`** = take the string env var and convert to a number (env vars are always strings). **`.int().positive()`** = extra rules. **`.default(x)`** = optional, fall back to `x`. **No `.default()`** (like `DATABASE_URL`) = **required**. **Connection to:** every file that imports `env` relies on these names/types.
```ts
const parsed = envSchema.safeParse(process.env);
```
Validates the real environment. **`safeParse`** returns `{ success, data }` or `{ success, error }` (doesn't throw).
```ts
if (!parsed.success) { console.error(...); process.exit(1); }
```
Fail-fast: on bad config, print the problems and **kill the process** — a misconfigured service should never start.
```ts
export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
```
After the `if`, TypeScript knows `parsed.success` is `true`, so `parsed.data` is the validated, fully-typed config. `Env` is the inferred type. **Connection:** `logger.ts`, `db.ts`, `redis.ts`, `cache.service.ts`, `clickTracker.service.ts`, `rateLimiter.middleware.ts`, `index.ts` all `import { env }`.

## `src/config/db.ts`
```ts
import { PrismaClient } from "@prisma/client";
import { env } from "./env.js";
export const prisma = new PrismaClient({
  log: env.NODE_ENV === "development" ? ["warn","error"] : ["error"],
});
```
Creates the single Prisma client. **`cond ? a : b`** is the ternary operator. Prisma reads `DATABASE_URL` itself (from `schema.prisma`). **Connection:** the repository (`url.repository.ts`), the readiness check (`health.routes.ts`), the click flush (`clickTracker.service.ts` via the repository), and shutdown (`index.ts`) all use `prisma`.

## `src/config/redis.ts`
```ts
import { Redis } from "ioredis";
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
redis.on("error", (err) => { logger.error({ err }, "Redis client error"); });
```
One shared Redis connection. Named import `{ Redis }` is the ESM-correct form for ioredis. `.on("error", ...)` attaches an event listener so a Redis error is logged, not fatal. **Connection:** both cache services, the rate limiter, the readiness check, and shutdown use `redis`.

## `src/utils/requestContext.ts`
```ts
import { AsyncLocalStorage } from "node:async_hooks";
export interface RequestContext { reqId: string; }
export const requestContext = new AsyncLocalStorage<RequestContext>();
export function getReqId(): string | undefined {
  return requestContext.getStore()?.reqId;
}
```
**`AsyncLocalStorage`** is a Node built-in that holds a value "for the duration of an async operation chain" — like a variable scoped to one request, readable anywhere downstream without passing it around. `getStore()` returns the current request's context (or `undefined` outside a request); `?.reqId` safely reads the id. **Connection:** `logger.ts` reads it (to stamp every log); `requestLogger.middleware.ts` writes it (per request).

## `src/utils/logger.ts`
```ts
export const logger = pino({
  level: env.LOG_LEVEL,
  mixin() { const reqId = getReqId(); return reqId ? { reqId } : {}; },
});
```
Creates the shared logger. **`mixin`** is a pino hook called on every log line; we merge in `{ reqId }` when inside a request — so *every* log automatically carries the correlation id. **Connection:** imported by nearly every file that logs; reads `requestContext`.

## `src/schemas/url.schema.ts`
```ts
const RESERVED_ALIASES = new Set([...]);
```
A `Set` (fast membership checks) of forbidden aliases.
```ts
const aliasSchema = z.string().min(1).max(20)
  .regex(/^[A-Za-z0-9_-]+$/, "...")
  .refine((a) => !RESERVED_ALIASES.has(a.toLowerCase()), { message: "..." });
```
A reusable alias rule. **`.regex(...)`** enforces allowed characters. **`.refine(fn, msg)`** adds a custom rule: the function must return `true` for valid input. Here it rejects reserved words.
```ts
const futureDate = z.coerce.date().refine((d) => d.getTime() > Date.now(), {...});
```
Coerces a string to a `Date`, then refines it must be in the future. **This is the assignment's "expiresAt after createdAt" rule** (createdAt ≈ now).
```ts
export const createUrlSchema = z.object({ body: z.object({ originalUrl: z.string().url(), alias: aliasSchema.optional(), expiresAt: futureDate.optional() }) });
export type CreateUrlBody = z.infer<typeof createUrlSchema>["body"];
```
The POST schema, plus the inferred TS type of its body. **`["body"]`** indexes into the inferred type to get just the body shape.
```ts
export const updateUrlSchema = z.object({ params: ..., body: z.object({...}).partial().refine((b)=>Object.keys(b).length>0, {...}) });
```
The PATCH schema. **`.partial()`** makes every field optional (partial update); the `.refine` ensures at least one field is present. **Connection:** `url.routes.ts` passes these schemas to `validate(...)`; `url.controller.ts` imports the inferred types.

## `src/middlewares/validate.middleware.ts`
```ts
export function validate(schema: ZodType): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse({ body: req.body, params: req.params, query: req.query });
    if (!result.success) throw new ValidationError("Request validation failed", result.error.flatten());
    const data = result.data as { body?: unknown };
    if (data && typeof data === "object" && "body" in data) req.body = data.body;
    next();
  };
}
```
A **higher-order function**: `validate(schema)` returns a middleware. Inside, it validates the request; on failure it **throws** `ValidationError` (caught centrally); on success it replaces `req.body` with the parsed value and calls `next()` to continue. `_res` (underscore) signals "unused." **Connection:** used by every route in `url.routes.ts`; throws to `errorHandler`.

## `src/repositories/url.repository.ts`
```ts
export type { Url };                        // re-export Prisma's generated type
export async function insertUrl(input: {...}): Promise<Url> {
  return prisma.url.create({ data: {...} });
}
export async function findByCode(code: string): Promise<Url | null> {
  return prisma.url.findUnique({ where: { code } });
}
export async function addClicks(code: string, count: number): Promise<void> {
  await prisma.url.update({ where: { code }, data: { clickCount: { increment: count }, lastAccessedAt: new Date() } });
}
export async function updateUrlRecord(code: string, data: {...}): Promise<Url> {
  return prisma.url.update({ where: { code }, data: { ...(data.code !== undefined ? { code: data.code } : {}), ...(data.expiresAt !== undefined ? { expiresAt: data.expiresAt } : {}) } });
}
```
The ONLY file with database calls. **`{ increment: count }`** is Prisma's atomic `+=`. The **`...(cond ? {x} : {})`** spread conditionally includes a field — that's how a partial update writes only provided columns. **Connection:** called by `url.service.ts` and `clickTracker.service.ts`. Uses `prisma` from `db.ts`.

## `src/services/cache.service.ts`
```ts
const urlKey = (code: string) => `url:${code}`;
const NEGATIVE = "__NEGATIVE__";
export async function lookupCache(code: string): Promise<CacheLookup> {
  const raw = await redis.get(urlKey(code));
  if (raw === null) return { state: "miss" };
  if (raw === NEGATIVE) return { state: "negative" };
  try { return { state: "hit", value: JSON.parse(raw) as CachedUrl }; } catch { return { state: "miss" }; }
}
export async function cacheUrl(code, value) { await redis.set(urlKey(code), JSON.stringify(value), "EX", env.CACHE_TTL_SECONDS); }
export async function cacheNegative(code) { await redis.set(urlKey(code), NEGATIVE, "EX", env.NEGATIVE_CACHE_TTL_SECONDS); }
export async function invalidateUrl(code) { await redis.del(urlKey(code)); }
export async function acquireRebuildLock(code) { const token = randomUUID(); const ok = await redis.set(lockKey(code), token, "PX", env.LOCK_TTL_MS, "NX"); return ok === "OK" ? token : null; }
export async function releaseRebuildLock(code, token) { const lua = '...'; await redis.eval(lua, 1, lockKey(code), token); }
```
The caching + lock helpers. `redis.set(key, val, "EX", secs)` sets with expiry; `"PX", ms, "NX"` sets in milliseconds only if absent (the lock). `redis.eval(lua, 1, key, arg)` runs a Lua script atomically (compare-token-then-delete). `JSON.parse/stringify` convert between object and stored string. **Connection:** used by `url.service.ts` (redirect + invalidation on create/update). Uses `redis`, `env`.

## `src/services/clickTracker.service.ts`
```ts
export async function recordClick(code) { await redis.multi().incr(clickKey(code)).sadd(PENDING_SET, code).exec(); }
export async function getPendingClicks(code) { const n = await redis.get(clickKey(code)); return n ? Number(n) : 0; }
export async function flushClicks() {
  const codes = await redis.smembers(PENDING_SET);
  for (const code of codes) {
    await redis.srem(PENDING_SET, code);
    const countStr = await redis.getdel(clickKey(code));
    const count = countStr ? Number(countStr) : 0;
    if (count <= 0) continue;
    try { await addClicks(code, count); } catch (err) { /* P2025 drop, else re-buffer */ }
  }
}
export function startClickFlush() { timer = setInterval(() => { flushClicks().catch(...); }, env.CLICK_FLUSH_INTERVAL_MS); }
export async function stopClickFlush() { if (timer) clearInterval(timer); await flushClicks(); }
```
Buffers clicks and flushes them. `redis.multi()...exec()` pipelines commands atomically. `getdel` reads and clears a key in one atomic step. `setInterval` runs the flush on a timer; `clearInterval` stops it. **Connection:** `recordClick`/`getPendingClicks` called by `url.service.ts`; `start/stopClickFlush` called by `index.ts`; `addClicks` from the repository.

## `src/services/url.service.ts` (the orchestrator)
This is the only file that touches BOTH the repository (Postgres) and the cache services (Redis). Key functions:
- **`createShortUrl`** — custom alias → insert once, throw `ConflictError` on clash; else `nanoid` loop with collision retry. Clears negative cache after insert.
- **`resolveForRedirect`** — calls `resolveCachedUrl` (cache-aside + stampede), throws `NotFoundError`/`GoneError`, records a click, returns the URL.
- **`resolveCachedUrl`** — the hit/negative/miss logic + the rebuild lock (only one caller reads the DB on a miss).
- **`getUrlStats`** — Postgres count + un-flushed Redis buffer.
- **`updateUrl`** — update the row, then **invalidate** the cache (old + new code).
Throwing typed errors (not returning status codes) is what lets the controllers stay pure. **Connection:** called by `url.controller.ts`; uses repository + both cache services + the `errors/`.

## `src/middlewares/rateLimiter.middleware.ts`
Runs a Lua `INCR`+`PEXPIRE` per caller, sets `RateLimit-*` headers, and throws `RateLimitError` (with `Retry-After` seconds) when over the limit. Picks the tier by the `x-api-key` header. Fails open (calls `next()`) if Redis errors. **Connection:** registered in `app.ts`; throws to `errorHandler`.

## `src/middlewares/requestLogger.middleware.ts`
Mints/echoes an `X-Request-Id`, then runs the rest of the request inside `requestContext.run({ reqId }, () => next())` so the id propagates to every downstream log. Logs `request received` / `request completed` (with duration via `process.hrtime.bigint()`). **Connection:** feeds `requestContext`, which `logger`'s mixin reads.

## `src/errors/*` and `errorHandler.middleware.ts`
`AppError` is the base (carries `statusCode`, `code`); subclasses set specific codes. The handler (registered last) checks `instanceof` each type and formats a consistent JSON response, honoring `Retry-After`/`details`, and turns anything unknown into a safe 500. **Connection:** thrown by services and middleware; caught here.

## `src/controllers/url.controller.ts`
Four thin functions. Each reads the (validated) request, calls one service function, and sends the success response. No error branches — thrown errors go to `errorHandler`. **Connection:** referenced by `url.routes.ts`; calls `url.service.ts`.

## `src/routes/url.routes.ts` and `health.routes.ts`
Map method+path → `validate(schema)` → controller. The catch-all `GET /:code` is last. Health routes are separate and mounted first (unthrottled). **Connection:** mounted in `app.ts`.

## `src/app.ts`
Assembles the middleware chain in order: health → requestLogger → rateLimiter → json → urlRouter → 404 handler → errorHandler. Order IS the behavior. **Connection:** imported by `index.ts` (and future tests).

## `src/index.ts`
`main()` connects to Postgres + Redis (fail-fast), starts the flush job, listens, and registers graceful shutdown. `registerShutdown` handles `SIGTERM`/`SIGINT` → `server.close` → `stopClickFlush` (final flush) → disconnect → exit, with a 10s force-exit safety net. **Connection:** the top of the tree — imports app, config, services.

---

# Part 3 — Why each technology/concept exists (the "why use it at all")

- **TypeScript** — JS finds type bugs at runtime (in production); TS finds them at compile time (in your editor). Worth a build step for any app you'll maintain. Caveat: types vanish at runtime → need Zod at boundaries.
- **Express** — a minimal, ubiquitous HTTP layer; Express 5 auto-forwards async errors, which our central handler relies on.
- **PostgreSQL** — durable source of truth with DB-enforced constraints (unique codes), transactions, and disk durability. A cache can't provide correctness guarantees.
- **Prisma** — one schema → type-safe client + migrations + snake_case↔camelCase mapping. Trades SQL control for type safety and speed.
- **Redis** — in-memory (microseconds) for the read-heavy path: cache, negative cache, stampede lock, click buffer, rate-limit counters. Never the only copy of data.
- **Zod** — the runtime validation TS can't do; one schema = validation + type. Used for env and every request.
- **pino** — structured JSON logs machines can search; with correlation IDs you can trace one request across the whole system.
- **Docker/Compose** — reproducible environments and one-command multi-service startup; kills "works on my machine."
- **Rate limiting** — protects the service and datastores from abuse/overload; tiered so trusted callers get more headroom.
- **Correlation IDs** — make logs from one request traceable end-to-end in a sea of concurrent requests.
- **Typed errors + central handler** — consistent responses, no leaked internals, and controllers that only handle success.
- **Graceful shutdown** — a deploy/restart shouldn't drop in-flight requests or buffered clicks.
- **Layered architecture** — one job per file → testable, swappable (we changed `pg`→Prisma touching only the repository).

---

# Part 4 — Postman testing guide

Base URL: `http://localhost:3000`. Import `docs/postman_collection.json` to get all of these pre-built.

| # | Method | URL | Body (JSON) | Expect |
|---|---|---|---|---|
| 1 | POST | `/urls` | `{"originalUrl":"https://example.com"}` | 201, random `code`, `shortUrl` |
| 2 | POST | `/urls` | `{"originalUrl":"https://example.com","alias":"mylink"}` | 201, `code":"mylink"` |
| 3 | POST | `/urls` | `{"originalUrl":"https://example.com","alias":"admin"}` | 400, reserved alias |
| 4 | POST | `/urls` | `{"originalUrl":"not-a-url"}` | 400, ValidationError |
| 5 | POST | `/urls` | `{"originalUrl":"https://example.com","expiresAt":"2020-01-01"}` | 400, must be future |
| 6 | GET | `/{code}` | — | 302 redirect (turn OFF auto-follow to see it) |
| 7 | GET | `/urls/{code}/stats` | — | 200, `clickCount` etc. |
| 8 | PATCH | `/urls/{code}` | `{"alias":"renamed"}` | 200, new code |
| 9 | PATCH | `/urls/{code}` | `{"expiresAt":"2030-01-01T00:00:00Z"}` | 200 |
| 10 | PATCH | `/urls/{code}` | `{}` | 400, at least one field |
| 11 | GET | `/health` | — | 200 `{"status":"ok"}` |
| 12 | GET | `/ready` | — | 200 ready / 503 not_ready |
| 13 | GET | `/urls/nope/stats` | — | 404 NotFound |

**Rate limiting:** add header `X-API-Key: demo` for the high tier; without it you're the anon tier (send many requests fast to see `429` + `Retry-After`). Every response carries `RateLimit-Limit/Remaining/Reset`.

**Redirect tip:** in Postman, Settings → turn off "Automatically follow redirects" so `GET /{code}` shows the raw `302` + `Location` header instead of following it to the target site.
