# Link Shortener — Postman Cheat Sheet

Base URL: `http://localhost:3000`  (PORT default is 3000)
All request/response bodies are JSON. Set header `Content-Type: application/json` on POST/PATCH.

Rate-limit headers appear on **every** response: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`.
- Anonymous: 60 requests / 60s (by IP).
- With header `x-api-key: <anything>`: 600 requests / 60s (by key).

---

## 1. Create a short link — `POST /urls`

**Request** `POST http://localhost:3000/urls`
```json
{
  "originalUrl": "https://example.com/some/very/long/path",
  "alias": "mylink",
  "expiresAt": "2027-01-01T00:00:00.000Z"
}
```
- `originalUrl` — **required**, must be a valid URL.
- `alias` — *optional* custom code. 1–20 chars, only `A-Z a-z 0-9 _ -`. Not a reserved word
  (`urls, api, admin, health, ready, login, logout, signup, static, assets, public, favicon.ico, robots.txt`).
  Omit it and the server generates a random 7-char code.
- `expiresAt` — *optional*, must be a **future** date (ISO string).

**201 Created**
```json
{
  "code": "mylink",
  "originalUrl": "https://example.com/some/very/long/path",
  "shortUrl": "http://localhost:3000/mylink",
  "expiresAt": "2027-01-01T00:00:00.000Z",
  "createdAt": "2026-08-02T10:00:00.000Z"
}
```

**Errors**
- `409 Conflict` — alias already taken: `{ "error": "Conflict", "message": "alias 'mylink' is already taken" }`
- `400 BadRequest` — invalid body (bad URL, reserved alias, past date). Includes a `details` object.

---

## 2. Redirect (the hot path) — `GET /:code`

**Request** `GET http://localhost:3000/mylink`

In Postman, turn **Settings → Automatically follow redirects → OFF** to *see* the 302.
Leave it ON and Postman lands on the target page.

**302 Found** — header `Location: https://example.com/some/very/long/path`
(302, not 301, so browsers don't cache it — every click is counted.)

**Errors**
- `404 NotFound` — no such code: `{ "error": "NotFound", "message": "No link for code 'xyz'" }`
- `410 Gone` — expired: `{ "error": "Gone", "message": "This link has expired" }`

> Cache behavior to demo: first hit = cache **miss** (reads Postgres, fills Redis).
> Repeat hits = cache **hit** (served from Redis). A wrong code caches a short **negative** entry (30s).

---

## 3. Stats — `GET /urls/:code/stats`

**Request** `GET http://localhost:3000/urls/mylink/stats`

**200 OK**
```json
{
  "code": "mylink",
  "originalUrl": "https://example.com/some/very/long/path",
  "clickCount": 5,
  "createdAt": "2026-08-02T10:00:00.000Z",
  "lastAccessedAt": "2026-08-02T10:05:00.000Z",
  "expiresAt": "2027-01-01T00:00:00.000Z"
}
```
> `clickCount` is **live** = Postgres count + un-flushed Redis buffer. Hit the redirect a few
> times, then immediately GET stats — the count updates even before the 10s flush lands.

**Error** — `404 NotFound` if the code doesn't exist.

---

## 4. Update a link — `PATCH /urls/:code`

**Request** `PATCH http://localhost:3000/urls/mylink`
Send **at least one** field (empty body = 400).
```json
{
  "alias": "renamed",
  "expiresAt": "2028-06-01T00:00:00.000Z"
}
```
- `alias` — new custom code (same rules as create).
- `expiresAt` — future date to set it, or `null` to **clear** the expiry, or omit to leave as-is.

**200 OK** — returns the updated record (same shape as create's 201).

**Errors**
- `409 Conflict` — new alias already taken.
- `404 NotFound` — code doesn't exist.
- `400 BadRequest` — empty body or invalid field.

> After a rename, the old `shortUrl` returns 404 and the new one works — the cache is invalidated for both codes.

---

## Health (not rate-limited, not logged)

- `GET /health`  → liveness
- `GET /ready`   → readiness (checks Postgres + Redis)

---

## Suggested demo order in Postman

1. `POST /urls` (with alias `demo`) → note the `shortUrl`.
2. `GET /demo` → 302 (redirects to original).
3. `GET /demo` again a few times → still 302 (now served from cache).
4. `GET /urls/demo/stats` → watch `clickCount` climb (live buffer).
5. `PATCH /urls/demo` `{ "alias": "demo2" }` → 200.
6. `GET /demo` → 404 (old code gone); `GET /demo2` → 302 (new code works).
7. `GET /nope` → 404 (negative-cached for 30s).
8. Fire `GET /demo2` ~60+ times fast with no `x-api-key` → 429 with `Retry-After`.

---

## Error response shapes (quick reference)

| Status | `error` value          | When                                   |
|--------|------------------------|----------------------------------------|
| 400    | `Validation` / `BadRequest` | bad body/params (`details` included) |
| 404    | `NotFound`             | unknown code / route                   |
| 409    | `Conflict`             | alias already taken                    |
| 410    | `Gone`                 | link expired                           |
| 429    | `RateLimit`            | over the window cap (`Retry-After`)    |
| 500    | `InternalServerError`  | unexpected bug (details never leaked)  |
