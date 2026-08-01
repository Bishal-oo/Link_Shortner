# TypeScript in this project — theory, syntax, and worked examples

A complete tour of every TypeScript concept used in the Link Shortener, taught
from the ground up. Each section gives you the **theory** (what it is and *why*
it exists), the **syntax** (how to write it), and a **real example from this
codebase** plus extra illustrations.

---

## Part 0 — How TypeScript is set up here

Before the language, the machinery. TypeScript is not a runtime — Node cannot
run a `.ts` file directly (well, newer Node can strip types, but this project
doesn't rely on that). TypeScript is a **compile-time type checker** plus a
**transpiler** that emits plain JavaScript. Types are *erased*; they exist only
while you develop.

### The three tools

| Tool | Where | Job |
|------|-------|-----|
| `typescript` (`tsc`) | `npm run build`, `npm run typecheck` | The real compiler. Type-checks and emits `.js` into `dist/`. |
| `tsx` | `npm run dev` | A fast dev runner. Runs `.ts` directly by transpiling on the fly (no type-checking — speed). |
| `@types/*` | `@types/express`, `@types/node`, … | Type *declarations* for JS libraries that ship no types of their own. |

From [package.json](../package.json):

```json
"scripts": {
  "dev": "tsx watch src/index.ts",   // fast, no type-check, hot reload
  "build": "tsc",                     // real compile to dist/
  "start": "node dist/index.js",      // run the compiled JS
  "typecheck": "tsc --noEmit"         // type-check only, emit nothing
}
```

The important split: **`tsx` does NOT type-check**. It only strips types so the
code runs fast during development. That is why `npm run typecheck` (which is
`tsc --noEmit`) exists as a separate gate — it's what actually enforces the types
before you commit or build. If you only ever run `npm run dev`, a type error can
sit undetected.

### The `tsconfig.json`, line by line

This is the single most important config file. It tells `tsc` how strict to be
and what kind of JavaScript to emit. From [tsconfig.json](../tsconfig.json):

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",          // emit modern JS (Node 20+ runs it natively)
    "lib": ["ES2022"],           // which built-in APIs TS knows about

    "module": "NodeNext",        // emit ES modules the way Node resolves them
    "moduleResolution": "NodeNext",

    "rootDir": "src",            // source input root
    "outDir": "dist",            // compiled output root

    "strict": true,              // the big one — turns on all strict checks
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,

    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "declaration": false
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

**`target` / `lib`** — `target` sets the JS syntax level tsc emits. `lib`
controls which global type definitions are available (e.g. `ES2022` gives you
`Array.prototype.at`, `Object.hasOwn`). Since you run on Node 20+, targeting
ES2022 means almost nothing is down-compiled — the emitted JS looks like your
source minus the types.

**`module: "NodeNext"` + `"type": "module"` in package.json** — this is the ESM
setup, and it's the reason for a quirk you'll see everywhere in this codebase:

```ts
import { logger } from "../utils/logger.js";   // .js, even though the file is logger.ts
```

You import `.js` even though the file on disk is `.ts`. Under NodeNext, TypeScript
deliberately makes you write the path **as it will exist at runtime**. After
compilation `logger.ts` becomes `logger.js`, and native Node ESM requires the
file extension in import specifiers. So you write the *output* name. It feels
odd but it's correct — it means the emitted JS needs zero path rewriting.

**The strictness block — this is where TS earns its keep:**

- `strict: true` is an umbrella that enables ~8 flags at once. The two you'll
  feel most:
  - `strictNullChecks` — `null` and `undefined` are not assignable to other
    types. A `string` cannot secretly be `null`. This is why you see `| null`
    and `?` all over the code — nullability is made explicit.
  - `noImplicitAny` — every value must have a knowable type; TS won't silently
    fall back to `any`.
- `noUncheckedIndexedAccess` — indexing an array or record gives you `T |
  undefined`, not `T`. `arr[0]` might not exist, and TS forces you to consider
  it. Stricter and safer than default.
- `noImplicitOverride` — if you override a base-class method you must write the
  `override` keyword, so a rename in the base class can't silently orphan a
  subclass method.
- `noFallthroughCasesInSwitch` — a `case` that falls through to the next without
  `break`/`return` is an error (a classic bug source).

**Interop / ergonomics:**

- `esModuleInterop` — lets `import express from "express"` work smoothly with
  CommonJS-style default exports.
- `resolveJsonModule` — you can `import data from "./x.json"` and get types.
- `skipLibCheck` — don't type-check inside `node_modules/**/*.d.ts`. Purely a
  speed/sanity tradeoff; your code is still checked, third-party declarations are
  trusted.
- `sourceMap` — emit `.js.map` files so stack traces and debuggers point back to
  the original `.ts` lines.
- `declaration: false` — don't emit `.d.ts` files. You would set this `true` if
  publishing a library; this is an app, so no.

### Two "hidden" type sources: Prisma and Zod

Not all types in this project are hand-written. Two libraries *generate* types:

- **Prisma** reads your database schema and generates a typed client. `import
  type { Url } from "@prisma/client"` gives you a `Url` type whose shape exactly
  matches your `url` table — you never wrote that interface by hand.
- **Zod** lets you *infer* a static type from a runtime validator (covered in
  detail in Part 2). One schema produces both runtime validation and a compile
  time type.

Both are examples of **types as a byproduct**, keeping runtime and compile-time
truth in sync automatically.

---

## Part 1 — Core type system

### 1.1 Type annotations vs. type inference

**Theory.** TypeScript can figure out (infer) most types on its own. You only
annotate where inference can't reach — function parameters, public boundaries,
and places where you want to *constrain* rather than *observe*.

**Syntax.** An annotation is `: Type` after a name.

```ts
const CODE_LENGTH = 7;          // inferred as the literal type 7 (const) / number
let count: number;              // annotated because there's no initializer yet
function findByCode(code: string): Promise<Url | null> { … }
//                       ^param    ^explicit return type
```

**From the code** — [url.repository.ts](../src/repositories/url.repository.ts):

```ts
export async function findByCode(code: string): Promise<Url | null> {
  return prisma.url.findUnique({ where: { code } });
}
```

`code: string` is a required annotation (parameters are never inferred).
`: Promise<Url | null>` is an *optional but deliberate* annotation — Prisma
already returns that type, but stating it makes the function's contract explicit
and catches mistakes if the implementation drifts.

**Rule of thumb used throughout this project:** annotate function parameters and
return types (the public contract); let inference handle local variables.

### 1.2 Primitives, `null`, `undefined`

The primitive types are `string`, `number`, `boolean`, `bigint`, `symbol`,
`null`, `undefined`. Because `strictNullChecks` is on, `null` and `undefined` are
*distinct* types you must opt into.

```ts
let timer: NodeJS.Timeout | null = null;   // clickTracker.service.ts
```

`timer` can hold a timer handle *or* `null`. You cannot assign `null` to a plain
`NodeJS.Timeout` — the union is required to make `null` legal.

### 1.3 Union types

**Theory.** A union `A | B` is a value that is *either* `A` or `B`. It models
"one of several possibilities" — the backbone of honest modeling in TS.

**Syntax.** The `|` separator.

```ts
Promise<Url | null>              // a Url, or null
expiresAt: Date | null           // a date, or explicitly no date
CachedUrl | "not_found"          // a value, or a specific sentinel string
```

**From the code** — [url.service.ts](../src/services/url.service.ts):

```ts
async function loadFromDbAndCache(code: string): Promise<CachedUrl | "not_found"> {
  const url = await findByCode(code);
  if (!url) {
    await cacheNegative(code);
    return "not_found";          // the literal-string member of the union
  }
  …
  return value;                  // the CachedUrl member
}
```

The return type says "either the cached object, or the exact string
`"not_found"`". Callers must handle both, and TS enforces it.

### 1.4 Literal types

**Theory.** A literal type is a *single exact value* used as a type: `"hit"`,
`404`, `true`. Combined with unions they express closed sets ("one of these
exact strings").

```ts
LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"])
```

The inferred type of `LOG_LEVEL` is the union of six string literals
`"fatal" | "error" | … | "trace"` — not just `string`. Assigning `"verbose"`
would be a compile error. That's far stronger than a plain `string`.

### 1.5 `interface` vs. `type` alias

**Theory.** Both name a shape. Rough guidance this project follows:

- `interface` for **object shapes** that describe an entity or contract.
- `type` for **unions, aliases, and computed types** (things an interface can't
  express).

**`interface`** — [cache.service.ts](../src/services/cache.service.ts):

```ts
export interface CachedUrl {
  originalUrl: string;
  expiresAt: string | null;
}
```

**`type`** for a union (an interface literally cannot do this):

```ts
export type CacheLookup =
  | { state: "hit"; value: CachedUrl }
  | { state: "negative" }
  | { state: "miss" };
```

And `type` as a simple alias / inference target:

```ts
export type Env = z.infer<typeof envSchema>;   // env.ts
export type CreateUrlBody = z.infer<typeof createUrlSchema>["body"];
```

Interfaces can also be *extended* and *merged* across declarations; type aliases
can't merge but can express anything (unions, intersections, conditional types,
mapped types). When in doubt in this codebase: object entity → `interface`,
anything else → `type`.

### 1.6 Optional properties and nullability

Three different "might not be here" concepts, and the code uses all three
deliberately:

```ts
interface UrlStats {
  lastAccessedAt: Date | null;   // present, but the value can be null
  expiresAt: Date | null;
}

export async function createShortUrl(input: {
  originalUrl: string;
  alias?: string;                // the property may be ABSENT entirely
  expiresAt: Date | null;        // present, value may be null
}): Promise<Url> { … }
```

- `alias?: string` — the key **may not exist**. Its type is `string | undefined`.
- `expiresAt: Date | null` — the key **must exist**, but its value may be `null`.

The distinction matters. `alias?` means "you can omit this". `expiresAt: … |
null` means "you must decide, and 'no expiry' is spelled `null`". This is why the
controller does:

```ts
expiresAt: body.expiresAt ?? null,   // turn an absent/undefined into explicit null
```

### 1.7 `??` (nullish coalescing) and `?.` (optional chaining)

**Theory.** Two operators for handling `null`/`undefined` safely.

- `a ?? b` → `a`, unless `a` is `null` or `undefined`, then `b`. (Unlike `||`,
  it does *not* trigger on `0`, `""`, or `false`.)
- `a?.b` → `a.b`, unless `a` is nullish, then `undefined` (no crash).

**From the code:**

```ts
id: req.ip ?? "unknown",                     // rateLimiter — fall back if ip missing
const reqId = req.header("x-request-id") ?? randomUUID();   // requestLogger
return requestContext.getStore()?.reqId;     // requestContext — store may be undefined
```

`getStore()` returns `RequestContext | undefined`; `?.reqId` reads `reqId` only
if a store exists, otherwise yields `undefined`. Then the function's return type
is `string | undefined` — honest about both outcomes.

The `??` choice over `||` is meaningful: `req.ip ?? "unknown"` correctly keeps a
valid-but-falsy value, whereas `||` would wrongly replace it.

---

## Part 2 — Generics and type-level programming

### 2.1 Generics — theory

**Theory.** A generic is a *type parameter* — a placeholder type filled in at the
use site. It lets one definition work over many types **without losing type
information** (the way `any` would). Think "a function/type with a type-shaped
argument".

**Syntax.** Angle brackets: `Array<string>`, `Promise<Url>`,
`AsyncLocalStorage<RequestContext>`.

**From the code** — [requestContext.ts](../src/utils/requestContext.ts):

```ts
export interface RequestContext {
  reqId: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();
```

`AsyncLocalStorage<T>` is a generic class from Node. By instantiating it with
`<RequestContext>`, every `getStore()` call returns `RequestContext | undefined`
— fully typed, no casting. If you'd written `new AsyncLocalStorage()` the store
would be `unknown`.

`Promise<T>` is the generic you use most. `Promise<Url>`, `Promise<void>`,
`Promise<CachedUrl | "not_found">` — the `T` is *what the promise resolves to*.

**A generic function** (illustration, same shape as helpers you'd write here):

```ts
function first<T>(arr: T[]): T | undefined {
  return arr[0];   // with noUncheckedIndexedAccess, arr[0] is already T | undefined
}
first([1, 2, 3]);        // T = number  → number | undefined
first(["a", "b"]);       // T = string  → string | undefined
```

One definition, correct return type for every element type. That's the whole
point of generics: reuse without erasing types.

### 2.2 `z.infer` and `typeof` in type position — deriving types from values

This is the most advanced pattern in the project, and worth slowing down on.

**Theory.** Normally types flow *into* runtime code. Zod inverts it: you write a
runtime **validator**, and TypeScript **infers a static type** from it. One
source of truth produces both the runtime check and the compile-time type — they
can never drift apart.

Two operators combine:

- `typeof someValue` in **type position** → "the type of this value". (Different
  from the runtime `typeof` operator that returns `"string"` etc.)
- `z.infer<...>` → a Zod helper that extracts the validated TypeScript type from
  a schema.

**From the code** — [env.ts](../src/config/env.ts):

```ts
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  …
});

export type Env = z.infer<typeof envSchema>;
//                        └── typeof envSchema = the schema's TYPE
//                z.infer<…> = the validated shape that schema produces
```

`Env` becomes exactly:

```ts
type Env = {
  NODE_ENV: "development" | "test" | "production";
  PORT: number;
  DATABASE_URL: string;
  …
};
```

You wrote the validator once; the type fell out for free. Change the schema and
the type updates automatically.

**Indexed access on top of it** — [url.schema.ts](../src/schemas/url.schema.ts):

```ts
export const createUrlSchema = z.object({
  body: z.object({
    originalUrl: z.string().url(),
    alias: aliasSchema.optional(),
    expiresAt: futureDate.optional(),
  }),
});
export type CreateUrlBody = z.infer<typeof createUrlSchema>["body"];
//                                                          └── indexed access:
//                                          "give me just the `body` property's type"
```

`z.infer<...>` gives the whole `{ body: {...} }` shape; `["body"]` is an **indexed
access type** — it reaches into that type and pulls out just the `body` sub-type.
So `CreateUrlBody` is exactly `{ originalUrl: string; alias?: string; expiresAt?:
Date }`. The controller then trusts it:

```ts
const body = req.body as CreateUrlBody;   // controller
```

### 2.3 Runtime validation → compile-time trust

The pattern across the app: **validate at the edge, trust in the core.** The Zod
schema checks untrusted input at the HTTP boundary (middleware), and once past
that boundary the derived type (`CreateUrlBody`, `Env`) lets the rest of the code
assume validity with zero re-checking. Runtime safety and static safety, from one
declaration.

---

## Part 3 — Narrowing, guards, and the `unknown` type

### 3.1 `unknown` vs. `any`

**Theory.** Both can hold "any value", but they're opposites in safety:

- `any` — turns type checking **off** for that value. You can do anything; TS
  won't stop you. A hole in the type system.
- `unknown` — the **type-safe** top type. It holds anything, but you can't *use*
  it until you **narrow** it (prove what it is). TS forces a check first.

This project uses `unknown` deliberately for error handling, because a caught
error truly could be anything.

**From the code** — [url.service.ts](../src/services/url.service.ts):

```ts
function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}
```

`err: unknown` — you can't access `err.code` directly (TS error: object is of
type unknown). You must first *narrow* with `instanceof`. After the check, inside
that branch, TS knows `err` is a `PrismaClientKnownRequestError` and lets you read
`.code`. Safe by construction.

Contrast with `ValidationError`, which stores `details: unknown`:

```ts
export class ValidationError extends AppError {
  readonly details: unknown;   // shape varies; caller must narrow before using
}
```

### 3.2 Type narrowing — the four techniques used here

**Theory.** *Narrowing* is TypeScript following your runtime checks to refine a
broad type into a specific one within a branch. This is control-flow analysis.

**(a) `instanceof`** — narrows to a class:

```ts
if (err instanceof RateLimitError) {
  res.setHeader("Retry-After", err.retryAfter);   // .retryAfter now visible
  …
}
```

In [errorHandler.middleware.ts](../src/middlewares/errorHandler.middleware.ts)
the handler chains `instanceof` checks from most specific to least
(`RateLimitError` → `ValidationError` → `AppError`), each branch unlocking that
class's fields.

**(b) `typeof`** — narrows primitives:

```ts
if (typeof status === "number" && status >= 400 && status < 500) { … }
```

After the `typeof status === "number"` guard, `status` is a `number` in that
branch, so the comparisons are legal.

**(c) truthiness / null checks** — narrows out `null`/`undefined`:

```ts
const url = await findByCode(code);
if (!url) { … return; }   // url is Url | null here
// past the guard, url is narrowed to just `Url`
return { code: url.code, originalUrl: url.originalUrl, … };
```

**(d) the `in` operator** — narrows by property presence:

```ts
const data = result.data as { body?: unknown };
if (data && typeof data === "object" && "body" in data) {
  req.body = data.body;    // safe: we proved `body` exists
}
```

### 3.3 Custom type guards vs. boolean helpers

`isUniqueViolation(err): boolean` returns a plain boolean. TypeScript also
supports a stronger form — a **type predicate** `err is SomeType` — that narrows
the *caller's* variable. This project uses the boolean form because it only needs
the yes/no, but here's the upgrade for reference:

```ts
// current (boolean): narrows only INSIDE the function
function isUniqueViolation(err: unknown): boolean { … }

// type-predicate version: narrows at the CALL SITE too
function isPrismaKnownError(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError;
}
// if (isPrismaKnownError(err)) { err.code }  // err is narrowed for the caller
```

### 3.4 Discriminated unions — the crown jewel

**Theory.** A *discriminated (tagged) union* is a union of object types that all
share one literal-typed property (the *discriminant*). Checking that one property
tells TypeScript *exactly* which member you have, unlocking that member's fields.
It's the type-safe way to model "a result that is one of several shapes".

**From the code** — [cache.service.ts](../src/services/cache.service.ts):

```ts
export type CacheLookup =
  | { state: "hit"; value: CachedUrl }   // has `value`
  | { state: "negative" }                // no extra fields
  | { state: "miss" };                   // no extra fields
```

`state` is the discriminant. Now the consumer in
[url.service.ts](../src/services/url.service.ts):

```ts
const found = await lookupCache(code);
if (found.state === "hit") {
  return found.value;      // ✅ TS KNOWS `value` exists here — only "hit" has it
}
if (found.state === "negative") {
  return "not_found";
}
// here TS has narrowed `found` down to { state: "miss" }
```

If you tried `found.value` in the `"miss"` branch, TS would reject it — that
member has no `value`. The discriminant makes the impossible states
*unrepresentable and uncompilable*. This is the pattern that replaces fragile
`if (result && result.value)` checks with something the compiler verifies.

The same pattern appears with the string sentinel `CachedUrl | "not_found"` — a
lightweight two-member discriminated union where the "tag" is the whole string.

---

## Part 4 — Functions and their types

### 4.1 Function type aliases / call signatures

**Theory.** A function has a *type* too — its parameter and return types. You can
name that type and reuse it. Express ships several such types, and this codebase
uses them to type middleware and handlers.

**From the code** — [rateLimiter.middleware.ts](../src/middlewares/rateLimiter.middleware.ts):

```ts
export const rateLimiter: RequestHandler = async (req, res, next) => { … };
//                        └── the function TYPE
```

`RequestHandler` is Express's type for `(req, res, next) => void`. By annotating
the *variable* with it, the parameters `req`, `res`, `next` get their types
**inferred from the annotation** — you don't re-type them. This is
"contextual typing": the expected type flows *into* the arrow function.

Same idea, error-handler variant — [errorHandler.middleware.ts](../src/middlewares/errorHandler.middleware.ts):

```ts
export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => { … };
```

`ErrorRequestHandler` has a *different* signature (four params, `err` first) —
that's how Express distinguishes error middleware from normal middleware.

### 4.2 Middleware factory — a function that returns a typed function

[validate.middleware.ts](../src/middlewares/validate.middleware.ts) is a
**higher-order function**: it takes a schema and returns a `RequestHandler`.

```ts
export function validate(schema: ZodType): RequestHandler {
  return (req, _res, next) => {   // returned fn typed by the RequestHandler return annotation
    const result = schema.safeParse({ body: req.body, params: req.params, query: req.query });
    if (!result.success) {
      throw new ValidationError("Request validation failed", result.error.flatten());
    }
    …
    next();
  };
}
```

The return type `: RequestHandler` on the outer function contextually types the
inner arrow function's parameters. `schema: ZodType` accepts *any* Zod schema, so
one `validate` works for every route's schema — generics-free reuse via a broad
parameter type.

### 4.3 `async`, `Promise<T>`, and `void`

Every `async` function returns a `Promise`. The annotation names what it resolves
to:

```ts
async function createUrl(req: Request, res: Response): Promise<void> { … }
//                                                     └── resolves to nothing
async function resolveForRedirect(code: string): Promise<string> { … }
//                                               └── resolves to a string
```

`Promise<void>` means "async, but produces no meaningful value" — typical for
controllers that write to `res` instead of returning. A leading underscore
(`_res`, `_req`) is a convention for "required by the signature but intentionally
unused" — it silences unused-parameter warnings while keeping positional args
correct.

### 4.4 Casting a Redis/Lua result — `as` on an opaque return

Some library calls return `unknown` or an over-broad type. `redis.eval` returns
`unknown`, so the rate limiter asserts the tuple it knows the Lua script
produces:

```ts
const result = (await redis.eval(RATE_LIMIT_SCRIPT, 1, key, tier.windowMs)) as [number, number];
count = Number(result[0]);
ttlMs = Number(result[1]);
```

`[number, number]` is a **tuple type** — a fixed-length array with a type per
position. This is discussed as an assertion in the next part.

---

## Part 5 — Type assertions and structural typing

### 5.1 `as` — type assertions (and their danger)

**Theory.** `value as Type` tells the compiler "trust me, this is a `Type`". It
does **no runtime check** — it only silences the type checker. It's an escape
hatch for when *you* know more than TS does. Overuse defeats the point of TS.

**Where the code uses it, and why it's justified:**

```ts
const body = req.body as CreateUrlBody;   // controller
```

Justified because the `validate` middleware already ran Zod against the body
*before* this handler executes. The runtime check happened; the `as` just informs
TS of the fact. Express types `req.body` as `any`, so without the assertion you'd
lose all type help.

```ts
const taken = await findByCode(changes.alias as string);   // url.service.ts
```

Here `changes.alias` is `string | undefined`, but the surrounding logic
(`renaming = changes.alias !== undefined && …`) already proved it's a string.
The `as string` reflects a fact the compiler can't track across the boolean
variable. (A local narrowing could avoid it, but the assertion is safe given the
guard.)

**The risky kind — asserting a shape onto `unknown`:**

```ts
const status =
  (err as { status?: number }).status ??
  (err as { statusCode?: number }).statusCode;
```

This is a *calculated* assertion: some libraries throw errors carrying a numeric
`.status`. TS has no way to know, so the code asserts a minimal shape
`{ status?: number }` and reads it defensively — note the `?` (optional) and the
`??` fallback, and the follow-up `typeof status === "number"` guard. That's the
responsible way to assert: assert the *narrowest* shape and re-validate at
runtime.

**Assertion vs. narrowing — prefer narrowing.** `instanceof`/`typeof`/`in` are
*checked* (safe). `as` is *unchecked* (a promise you make). The codebase leans on
narrowing for control flow and reserves `as` for post-validation boundaries.

### 5.2 Structural typing ("duck typing")

**Theory.** TypeScript types are **structural**, not nominal. Two types are
compatible if their *shapes* match — the names don't matter. "If it has the
shape, it is the type."

That's exactly what `err as { status?: number }` relies on: it doesn't ask
"*is* this the ErrorWithStatus class?"; it asks "does it *have* a numeric
`status`?". Any object with that shape qualifies.

Illustration:

```ts
interface HasCode { code: string; }
function log(x: HasCode) { console.log(x.code); }

const url = { code: "abc123", originalUrl: "…", clickCount: 0 };
log(url);   // ✅ url isn't declared as HasCode, but it HAS a string `code` → compatible
```

This is why the repository's `Url` (a Prisma type) slots into functions expecting
`{ code: string }`-ish shapes without any explicit relationship.

---

## Part 6 — Classes and inheritance

The error hierarchy in `src/errors/` is a compact tour of OO TypeScript.

### 6.1 The base class — [AppError.ts](../src/errors/AppError.ts)

```ts
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly isOperational: boolean;

  constructor(message: string, statusCode: number, code: string, isOperational = true) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, new.target);
  }
}
```

Concepts packed in here:

- **`extends Error`** — inheritance. `AppError` *is an* `Error` (so `instanceof
  Error` is true), and adds fields.
- **`readonly` fields** — `statusCode`, `code`, `isOperational` can be set in the
  constructor but never reassigned afterward. Compile-time immutability (erased at
  runtime; it's a checker rule, not a runtime lock).
- **Field declarations** — `readonly statusCode: number;` declares the property
  and its type; the constructor assigns it.
- **`super(message)`** — calls the parent (`Error`) constructor. Mandatory before
  using `this` in a subclass constructor.
- **Default parameter** — `isOperational = true` makes the 4th argument optional
  with a fallback.
- **`new.target`** — a meta-property that, inside a constructor, refers to the
  class that was actually `new`-ed. `new NotFoundError()` sets `new.target` to
  `NotFoundError` even though this code lives in `AppError`. So `this.name`
  becomes `"NotFoundError"` automatically — every subclass gets the right name
  with zero boilerplate.

### 6.2 Subclasses — specializing the base

[NotFoundError.ts](../src/errors/NotFoundError.ts):

```ts
export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(message, 404, "NotFound");   // fills in status + code for this error kind
  }
}
```

The subclass only supplies what's specific to it (status `404`, code
`"NotFound"`, a default message) and delegates the rest to `super`. This is the
Open/Closed principle in miniature — add a new error type by extending, without
touching the base or the handler.

### 6.3 Adding fields in a subclass

[RateLimitError.ts](../src/errors/RateLimitError.ts) and
[ValidationError.ts](../src/errors/ValidationError.ts) add *extra* typed state:

```ts
export class RateLimitError extends AppError {
  readonly retryAfter: number;               // new field the base doesn't have
  constructor(retryAfter: number, message = "Too many requests") {
    super(message, 429, "TooManyRequests");
    this.retryAfter = retryAfter;
  }
}
```

And the error handler's `instanceof` chain (Part 3.2) is what safely reads
`err.retryAfter` / `err.details` — the narrowing proves the subclass, which
proves the extra field exists.

### 6.4 Access modifiers (reference)

This project mainly uses `readonly` and public (default) members. TypeScript also
has `private`, `protected`, and constructor **parameter properties** (a shorthand
that declares and assigns a field from a constructor parameter in one go). The
error classes assign explicitly rather than using the shorthand — a stylistic
choice for clarity. Parameter-property form would look like:

```ts
class AppError extends Error {
  constructor(message: string, public readonly statusCode: number) { super(message); }
  // `public readonly statusCode` auto-declares + assigns this.statusCode
}
```

---

## Part 7 — Modules and the type/value split

### 7.1 `import type` and `export type`

**Theory.** TypeScript distinguishes *values* (exist at runtime) from *types*
(erased at compile time). `import type` / `export type` import/export **only the
type**, guaranteeing the statement disappears from the emitted JS. Under ESM +
`isolatedModules`-style compilation this avoids accidental runtime imports and
makes erasure explicit.

**From the code:**

```ts
import type { RequestHandler } from "express";              // validate.middleware.ts
import type { ZodType } from "zod";
import type { Url } from "@prisma/client";                  // url.repository.ts
import type { Request, Response } from "express";           // controller
```

All of these are *types only* — they vanish at runtime. Compare with a
**mixed** import in [url.service.ts](../src/services/url.service.ts):

```ts
import {
  insertUrl,          // a value (function) — runtime import
  findByCode,
  updateUrlRecord,
  type Url,           // inline `type` — this one specifier is type-only
} from "../repositories/url.repository.js";
```

The inline `type` modifier marks `Url` as type-only *within* an otherwise
value import. Precise and efficient.

### 7.2 `export type { Url }` — a type-only re-export

[url.repository.ts](../src/repositories/url.repository.ts):

```ts
import type { Url } from "@prisma/client";
export type { Url };   // re-export Prisma's type under this module's name
```

**Theory + why it's here.** This deliberately makes the repository the *single
place* the rest of the app imports `Url` from — so if you ever swap Prisma out,
only this file changes. It's an architectural boundary expressed purely in the
type system (the ORM stays "contained"). The comment in the file says exactly
that.

### 7.3 Runtime `typeof` vs. type-position `typeof`

Same keyword, two universes — worth cementing:

```ts
// RUNTIME typeof — returns a string, used in a value expression:
if (typeof status === "number") { … }

// TYPE-POSITION typeof — refers to the type of a value, used where a type goes:
export type Env = z.infer<typeof envSchema>;
```

The first is JavaScript. The second is TypeScript reaching into the value world
to grab a type. Recognizing which context you're in is key to reading advanced TS.

---

## Part 8 — A few smaller but real details

- **`NodeJS.Timeout`** (clickTracker) — a type from `@types/node`, the handle
  returned by `setInterval`. Typed as `NodeJS.Timeout | null` so it can be
  cleared and reset.
- **`Set<T>`** — `new Set([...])` in the schema is a generic collection; TS infers
  `Set<string>` from the array of strings, giving typed `.has()` checks.
- **Tuple type `[number, number]`** (rate limiter) — a fixed-shape array asserted
  onto the Lua result.
- **`Number(...)` conversions** — Redis returns strings; `Number(url.clickCount)
  + pending` is runtime coercion, not a type cast. Types describe; `Number()`
  actually converts.
- **`noUncheckedIndexedAccess` in action** — `result[0]` is `number | undefined`
  under this flag, which is why values get wrapped in `Number(...)` and defaults
  (`n ? Number(n) : 0`) rather than trusted blindly.

---

## Cheat-sheet: concept → where to see it

| Concept | File |
|--------|------|
| Type inference vs. annotation | every function signature |
| Union types | `url.service.ts` (`CachedUrl \| "not_found"`) |
| Literal types | `env.ts` (`z.enum([...])`) |
| `interface` (object shape) | `cache.service.ts` (`CachedUrl`) |
| `type` alias for unions | `cache.service.ts` (`CacheLookup`) |
| Discriminated union | `cache.service.ts` + `url.service.ts` (`state`) |
| Optional `?` vs. `\| null` | `url.service.ts` (`createShortUrl` input) |
| `??` / `?.` | `rateLimiter`, `requestContext` |
| Generics | `requestContext.ts` (`AsyncLocalStorage<T>`), every `Promise<T>` |
| `z.infer` + `typeof` | `env.ts`, `url.schema.ts` |
| Indexed access type | `url.schema.ts` (`[...]["body"]`) |
| `unknown` + narrowing | `url.service.ts` (`isUniqueViolation`) |
| `instanceof` / `typeof` / `in` narrowing | `errorHandler.middleware.ts` |
| Function type aliases | middlewares (`RequestHandler`, `ErrorRequestHandler`) |
| Higher-order function | `validate.middleware.ts` |
| Type assertion `as` | controller, `errorHandler`, `rateLimiter` |
| Structural typing | `errorHandler` (`err as { status?: number }`) |
| Class inheritance / `readonly` / `super` / `new.target` | `src/errors/*` |
| `import type` / `export type` | `url.repository.ts`, all middlewares |
| Tuple type | `rateLimiter.middleware.ts` |
