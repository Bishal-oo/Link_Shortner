# Link Shortener — Frontend

A React + TypeScript client for the link-shortener API. Create short links, browse
them in a paginated list, view per-link stats, and delete them — with first-class
handling of the real world of an API: loading states, validation feedback, and errors
(not-found, rate limits, network failures).

> A deeper walkthrough of every design decision and concept lives in
> [`FRONTEND_GUIDE.md`](./FRONTEND_GUIDE.md).

## Tech stack

- **React 19 + TypeScript**, built with **Vite**
- **React Router** for routing
- **Zod** for client-side validation (mirrors the backend's schemas)
- Plain **CSS** (token-based, one file per component in `src/styles/`)

## Pages

| Route | Page | Purpose |
|---|---|---|
| `/` | Create Link | form → short link + copy-to-clipboard |
| `/links` | Link List | paginated table with copy / stats / delete |
| `/links/:code` | Link Stats | click count, created date, last accessed |

## Prerequisites

- **Node 18+**
- The **backend running** (from the repo root, via `docker-compose`) on
  `http://localhost:3000`. The frontend talks to it — start it first.

## Setup

```bash
cd link-shortener-web
npm install
```

Create a `.env` file (copy `.env.example`) with the backend URL:

```bash
# .env
VITE_API_URL=http://localhost:3000
```

> Only variables prefixed with `VITE_` are exposed to the browser by Vite.

## Run

```bash
npm run dev        # start the dev server → http://localhost:5173
npm run build      # production build → dist/
npm run preview    # preview the production build
```

## Project structure

```
src/
├─ api/client.ts     # the ONLY place fetch() is called
├─ pages/            # compose components + hooks (no fetch, no validation)
├─ components/       # dumb UI: render + emit events
├─ hooks/            # data fetching + loading/error state (useFetch, useLinks, useLinkStats)
├─ schemas/          # Zod — same rules as the backend
├─ types/            # shared TS types
└─ styles/           # one CSS file per component
```

**The architecture rule:** `fetch` lives only in `api/client.ts` → hooks own
loading/error state → pages compose → components are dumb. Data flows down as props;
events flow up as callbacks.

## How the app handles API failures

Robust failure handling is the point of this project. Everything funnels through one
place — `api/client.ts` — which turns **every** outcome into a single, consistent
error shape so the whole app handles failures the same way:

```ts
type ApiError = { status: number; message: string; retryAfter?: number };
```

**One choke point.** `request()` is the only function that calls `fetch`. On any non-2xx
response it throws an `ApiError` carrying the HTTP status and the **real backend message**
(never a generic "something went wrong"). Pages `catch` this one shape and render it.

**Validation errors (400) — caught before they're even sent.** The Create form validates
with **Zod on the client, mirroring the backend's rules** (valid URL, alias charset/length
and reserved words, future expiry). Invalid input shows **inline messages under each
field** and never leaves the browser — so the API only sees clean requests, and the user
gets instant feedback. The backend still validates too (defense in depth); if it rejects
something, its message surfaces in the error banner.

**Not-found (404).** Requesting stats for a non-existent code shows a clear
*"No link found for that code."* message rather than a blank screen. Deleting a missing
link surfaces the backend's message.

**Rate limits (429) — handled distinctly.** When the backend rate-limits a request, it
sends a `Retry-After` header (exposed to the browser via CORS). `client.ts` reads it into
`ApiError.retryAfter`, and a shared `describeError()` helper produces a distinct
*"Too many requests — please slow down and try again in Ns."* message — different from
ordinary errors, and shown consistently on every page.

**Network failures.** If the backend is unreachable (down / CORS / offline), `fetch`
throws a raw `TypeError`. `client.ts` normalizes that into
`{ status: 0, message: "Can't reach the server — is it running?" }`, so even
infrastructure failures use the same clean error path — no unhandled crashes.

**Loading & stale responses.** Every data-fetching page shows a loading state via the
shared `useFetch` hook, which also guards against stale responses: if you navigate or
change pages mid-request, an old/late response is discarded instead of overwriting the
current view.

**Consistent presentation.** All API errors render through a single `ErrorBanner`
component, and the 429 wording is defined once in `describeError()` — so error messaging
can't drift from page to page.
