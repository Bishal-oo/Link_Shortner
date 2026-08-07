# Link Shortener — Frontend Guide

A complete walkthrough of the React frontend: what was built in each phase, **why**
each decision was made, every concept covered while building it, and what remains.

> Read this top-to-bottom once and you'll be able to explain the whole app in your
> walkthrough. The **Concepts Q&A** (section 9) is the deep-dive on the tricky bits.

---

## 1. Overview

A React + TypeScript client for the day-1 link-shortener API. The goal isn't just the
happy path — it's **handling the real world of an API**: loading states, errors,
validation feedback, rate limits.

**Stack**
| Piece | Choice | Why |
|---|---|---|
| Build | **Vite** | fastest React+TS scaffold |
| Language | **TypeScript** | types catch mistakes at compile time |
| Routing | **React Router 7** | 3 pages |
| Validation | **Zod 4** | mirrors the backend's own schemas |
| Styling | **plain CSS** (`src/index.css`) | one token-based stylesheet, no build fuss |

**Three pages**
| Route | Page | Purpose |
|---|---|---|
| `/` | Create Link | form → short link + copy |
| `/links` | Link List | paginated table + delete |
| `/links/:code` | Link Stats | click count, dates for one link |

---

## 2. Folder structure & the golden rule

```
src/
├─ main.tsx            # entry — wraps <App/> in <BrowserRouter>
├─ App.tsx             # ROUTES ONLY — no page logic
├─ api/
│  └─ client.ts        # the ONLY place fetch() is called
├─ pages/              # compose components + hooks; no fetch, no validation
│  ├─ CreateLinkPage.tsx
│  ├─ LinkListPage.tsx
│  └─ LinkStatsPage.tsx
├─ components/         # dumb: render + emit events; know nothing about the API
│  ├─ LinkForm.tsx
│  ├─ LinkTable.tsx
│  ├─ ErrorBanner.tsx
│  └─ LoadingSpinner.tsx
├─ hooks/              # own data fetching + loading/error state
│  ├─ useLinks.ts      # the list
│  └─ useLinkStats.ts  # one link's stats
├─ schemas/
│  └─ link.schema.ts   # Zod — SAME rules as the backend
├─ types/
│  └─ link.ts          # shared TS types
└─ styles/             # one CSS file per component
   ├─ base.css         # tokens + reset + nav + container (global, in main.tsx)
   ├─ buttons.css      # shared .btn* (global, in main.tsx)
   ├─ error.css        # ErrorBanner        form.css   # LinkForm
   ├─ card.css         # CreateLinkPage      stats.css  # LinkStatsPage
   └─ table.css        # LinkTable           list.css   # LinkListPage
```

**The one rule that keeps it clean:**
> `fetch` lives **only** in `api/client.ts` → **hooks** own loading/error state →
> **pages** compose → **components** are dumb. Data flows **down** as props; events
> flow **up** as callbacks.

Because pages never call `fetch`, they're insulated from the API's details — which is
exactly what let us swap in the missing backend endpoints without touching them.

---

## 3. Phase 1 — Project setup

**Goal:** scaffold + routing + the `api/client.ts` fetch wrapper.

### `api/client.ts` — the request engine
```ts
export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const text = await res.text();               // text-first: 204 (empty body) won't crash JSON.parse
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw { status: res.status, message: data?.message ?? res.statusText } as ApiError;
  }
  return data as T;
}
```
Key ideas:
- **`<T>` generic** — one engine, correctly typed per endpoint (`request<Link>`, `request<LinkStats>`…). It's a compile-time promise (`data as T`), not a runtime check.
- **`BASE_URL` from env** — `import.meta.env.VITE_API_URL` (only `VITE_`-prefixed vars are exposed by Vite). Set in `.env` to `http://localhost:3000`.
- **One error shape** — every failure throws `{ status, message }`, so every caller handles errors identically. `status` lets pages special-case 404/429.
- **`fetch` only throws on *network* failure** (server down, CORS) — NOT on 4xx/5xx. That's why we check `res.ok` ourselves.

### Routing
`main.tsx` wraps `<App/>` in `<BrowserRouter>`; `App.tsx` is a pure route table (`/`, `/links`, `/links/:code`).

---

## 4. Phase 2 — Create Link page

**Goal:** form + client validation + create + copy + real error messages.

### `schemas/link.schema.ts` — Zod mirror of the backend
```ts
const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

export const createLinkSchema = z.object({
  originalUrl: z.url(),                                             // required, valid URL
  alias: z.preprocess(emptyToUndefined, aliasSchema.optional()),   // 1–20 chars, safe chars, not reserved
  expiresAt: z.preprocess(emptyToUndefined, futureDate.optional()),// must be in the future
});
export type CreateLinkInput = z.infer<typeof createLinkSchema>;
```
- Mirrors the backend's **rules** (not its `{ body, params }` wrapper — see Q&A 6).
- **`z.preprocess(emptyToUndefined, …)`** on the *optional* fields is the crucial fix: a blank input is `""`, but `.optional()` only accepts `undefined`, so we convert `"" → undefined` first (see Q&A 7–9).
- **`z.infer`** derives `CreateLinkInput` so the type and the rules can never drift.

### `client.ts` — `createLink`
```ts
export async function createLink(input: CreateLinkInput): Promise<Link> {
  return request<Link>("/urls", { method: "POST", body: JSON.stringify(input) });
}
```
A thin wrapper: POST, JSON body, returns a typed `Link`. No error handling here — a 409/429 is thrown by `request` and caught by the page.

### `LinkForm.tsx` — validation + emit
- Three controlled inputs (`value` + `onChange`), one `errors` state (`Record<string, string>`).
- On submit: `createLinkSchema.safeParse(...)`. On failure → build a `{ field: message }` map from `result.error.issues` and `setErrors`. On success → `setErrors({})` and call `onSubmit(result.data)`.
- **`noValidate`** on the `<form>` disables the browser's native validation so **Zod is the only validator**.
- The form does **not** call the API — it emits validated data upward via `onSubmit`.

### `CreateLinkPage.tsx` — compose + outcomes
- State: `submitting`, `apiError`, `result`, `copied`.
- `handleCreate` uses `try/catch/finally`: success → `setResult`; error → `setApiError`; `finally` → `setSubmitting(false)`.
- Success shows a **result card** with the short link + **Copy** (`navigator.clipboard.writeText`, label flips to "Copied!" for 1.5s) + a Stats link.
- **Two error channels:** client validation → inline under fields; API errors → `ErrorBanner`.

---

## 5. Phase 3 — Link Stats page

**Goal:** fetch one link's stats, render tiles, handle 404.

### `useLinkStats.ts` — the fetch hook (loading/error/data)
```ts
export function useLinkStats(code: string) {
  const [data, setData]       = useState<LinkStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<ApiError | null>(null);

  useEffect(() => {
    let ignore = false;                 // stale-response guard (see Q&A 20–22)
    setLoading(true); setError(null); setData(null);
    getStats(code)
      .then((s)  => { if (!ignore) setData(s); })
      .catch((e) => { if (!ignore) setError(e as ApiError); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };    // cleanup on code-change / unmount
  }, [code]);

  return { data, loading, error };
}
```
The hook turns an async fetch into three values the page renders from. Re-runs when `code` changes; the `ignore` flag discards a superseded/late response.

### `LinkStatsPage.tsx` — the three-state ladder
```
if (loading) return <LoadingSpinner/>;
if (error)   return <ErrorBanner message={ status===404 ? "No link found…" : error.message }/>;
if (!data)   return null;              // type-narrowing safety
return <stat tiles/>;
```
- Reads `:code` via `useParams`.
- **404 handled clearly** (not a blank screen). On the stats endpoint, 404 means "no such code" (expiry is only checked on the redirect route — see Q&A 25).
- Dates are converted **at display** (`new Date(iso).toLocaleString()`), with `null` guards (`—` / `never`).

---

## 6. Backend additions made for the frontend

Two things were added to the backend this session so the frontend works end-to-end:

**a) CORS** (`src/app.ts`) — the browser blocks cross-origin calls until the server allows them:
```ts
app.use(cors({
  origin: "http://localhost:5173",
  exposedHeaders: ["Retry-After", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset"],
}));
```
`exposedHeaders` lets the frontend JS *read* the rate-limit headers (needed for Phase 5's 429 handling).

**b) The two missing endpoints** the Link List page needs (added via the existing route→controller→service→repository layers):
| Method | Path | Returns |
|---|---|---|
| `GET` | `/urls?page=&pageSize=` | `{ items: Link[], total, page, pageSize }` (newest first) |
| `DELETE` | `/urls/:code` | `204 No Content` (or `404`) |

- **Controller** parses the query itself (Express 5 `req.query` is read-only, so the validate middleware can't persist coerced numbers), builds `shortUrl` per item, shapes the response.
- **Service** does page math: `skip = (page-1)*pageSize`, `take = pageSize`; delete throws `NotFoundError` if missing and invalidates the Redis cache.
- **Repository** runs `findMany` + `count` in one `$transaction` (so `rows` and `total` agree).

Because these exist, the frontend uses **real endpoints** — no localStorage stub was needed.

---

## 7. Phase 4 — Link List page

**Goal:** paginated table + loading/empty states + delete-with-confirm.

### `types/link.ts` — `Paginated<T>`
```ts
export type Paginated<T> = { items: T[]; total: number; page: number; pageSize: number };
```
Generic so it wraps any item type; the list uses `Paginated<Link>`.

### `client.ts` — `listLinks` + `deleteLink`
```ts
export async function listLinks(page = 1, pageSize = 10): Promise<Paginated<Link>> {
  return request<Paginated<Link>>(`/urls?page=${page}&pageSize=${pageSize}`);
}
export async function deleteLink(code: string): Promise<void> {
  await request<void>(`/urls/${code}`, { method: "DELETE" });  // 204 → empty body handled by request
}
```

### `useLinks.ts` — list hook with pagination + refetch
- Owns `page`, `data`, `loading`, `error`, plus `setPage` and `refetch`.
- The effect re-runs on `[page, pageSize, reloadKey]`. `refetch()` bumps `reloadKey` to force a reload **without** changing the page (used after a delete).
- Same `ignore` stale-guard as `useLinkStats`.

### `LinkTable.tsx` — dumb table
- Props: `links`, `onCopy`, `onDelete`. Renders rows (code, destination, created, actions) and **emits events** — it knows nothing about the API.
- Uses React Router's `Link` (aliased `RouterLink`) for the per-row "Stats" link.

### `LinkListPage.tsx` — compose
- Renders the four states: **loading** (spinner), **error** (banner), **empty** ("No links yet — create one →"), **data** (table + pagination).
- **Delete-with-confirm:** `window.confirm(...)` before `deleteLink`, then `refetch()`. If you deleted the last row on a non-first page, it steps back a page.
- **Pagination:** `totalPages = Math.ceil(total / pageSize)`; Prev/Next disabled at the ends. This is where the `totalPages` math actually lives (see Q&A 27).

### Styling
All inline styles were moved into a **`src/styles/` folder with one CSS file per component** (`error.css`, `form.css`, `card.css`, `stats.css`, `table.css`, `list.css`), each imported by its component. Shared styles live in `base.css` (design tokens like `--primary`/`--border`, plus reset/nav/container) and `buttons.css`, both imported once in `main.tsx`. Components use `className`, not `style={{…}}`. Vite bundles all the CSS into one file at build time, so splitting has no runtime cost — it's purely for organization.

---

## 8. How to run

```bash
# backend (from repo root) — must be up first
docker compose up --build        # or: npm run dev

# frontend
cd link-shortener-web
npm install
npm run dev                       # http://localhost:5173
```
`.env` must contain `VITE_API_URL=http://localhost:3000`.

**Smoke test:** create a link on `/`, copy it, open `/links` (see it listed, paginate,
delete with confirm), open `/links/<code>` (stats + 404 on a bad code).

---

## 9. Concepts Q&A — everything covered today

The heart of the learning. Grouped by theme.

### A. Types & the serialization boundary

**Q1. Why do we even need types on the frontend for POST — isn't the app just Postman?**
Postman shows the response to a *human* who reads it with their eyes. A React app feeds
the response to *code* — it reads `result.shortUrl`, `result.code` by name to build UI.
Types guarantee those fields exist (typos caught in the editor, not the demo). Request
side → `CreateLinkInput`; response side → `Link`.

**Q2. Why is `createdAt` in the type — the DB already has it?**
A field belongs in a frontend type because **the UI shows it**, not because the DB has
it. Stats & List display the created date → the type needs it. (`id` is in the DB but
never crosses to the frontend, because no screen uses it.)

**Q3. So the frontend type is "all DB columns except id"?**
No. Two exceptions: (a) `shortUrl` is **computed** by the server, not a column — but the
frontend needs it; (b) `clickCount` and `lastAccessedAt` only appear on the **stats**
response, not on create/list. Rule: **match what each endpoint returns**, not the DB.

**Q4. Why `clickCount: number` and dates `string`? (the serialization boundary)**
Data crosses the network as **JSON text**, and JSON has no `BigInt` or `Date`:
- `clickCount` is `BigInt` in Postgres, but `JSON.stringify` throws on BigInt → the
  backend does `Number(...)` → arrives as `number`.
- `Date` → `JSON.stringify` turns it into an ISO **string**; `res.json()` parses it back
  as a **string**, never a `Date`. So the backend uses `Date | null`, the frontend uses
  `string | null` — both correct, on opposite sides of the wire.

### B. Zod validation & the empty-string problem

**Q5. Why validate with Zod on the frontend if the backend already does?**
Different jobs. **Frontend = UX** (instant inline feedback, no wasted request, protects
the rate-limit quota). **Backend = security** (the real trust boundary — a user can
bypass the form with curl). Same rules, mirrored: "defense in depth." The frontend is
*not* security; it's polish.

**Q6. What object does the frontend validate — the backend used `{ body, params }`?**
Flat. The backend wrapped things because its middleware validated the whole *request*
(body + params + query). The frontend only has the form fields, so the schema is a flat
`z.object({ originalUrl, alias, expiresAt })`. You mirror the **rules**, not the wrapper.

**Q7. Why does a blank optional field fail even with `.optional()` — I set `.min(1)`?**
`.optional()` only permits **`undefined`**, not `""`. A blank text input is `""` (a real
string), so it skips the "optional" escape hatch and gets validated → `.min(1)`/regex
fail. Fix: `z.preprocess(v => v === "" ? undefined : v, …)` converts `"" → undefined`
first.

**Q8. But shouldn't `""` fail? We *want* invalid input rejected.**
Depends on required vs optional. `originalUrl` is **required** → `""` *should* fail (no
preprocess). `alias`/`expiresAt` are **optional** → blank means "I'm not using this
feature," which is a valid submission (backend auto-generates a code / no expiry). So
`"" → undefined → skipped`.

**Q9. How would alias even be `""` — and if someone sends `""` on purpose, shouldn't it error?**
A controlled input's state starts `""` and an empty box *is* `""` — the form **always**
produces `""`, never `undefined`. There's no user gesture that yields `undefined`. So
`""` is the innocent "didn't fill it in" case, not a deliberate attack. (The "malicious
empty string" concern only exists at the raw-API level, which the backend guards.)

**Q10. Why is `emptyToUndefined`'s parameter typed `unknown`?**
`preprocess` runs **before** validation, so the value's type genuinely isn't known yet.
`unknown` is the honest type — and unlike `any`, it stays safe (you can do the `=== ""`
check but can't misuse it). It also matches Zod's own callback signature.

**Q11. So junk (a number) gets filtered too?**
Yes, but not by `emptyToUndefined` (that only handles `""`). The **Zod schema** (`z.string()`
etc.) rejects wrong-typed values — and it does so **on the client, before sending**, so
the backend never sees bad input from the form.

### C. React fundamentals

**Q12. Is `fetch` used for POST too?**
Yes — `fetch` does every HTTP method. `GET` is the default; pass `method: 'POST'` /
`'PATCH'` / `'DELETE'` in the options. That's why one `request` wrapper covers every
endpoint.

**Q13. `FormEvent` shows deprecated?**
Correct — in React 19's types, `FormEvent` (and `FormEventHandler`) are deprecated
("doesn't actually exist"). For a form submit where we only call `preventDefault()`, use
the base **`SyntheticEvent`** (React's cross-browser wrapper around the native event).

**Q14. Explain `LinkFormProps` — what is it suggesting?**
```ts
type LinkFormProps = { onSubmit: (data: CreateLinkInput) => void; submitting?: boolean };
```
It's the component's **contract**. `onSubmit` is a **required** callback the form calls
with *validated* data — the form talks *upward*, it doesn't call the API (inversion of
control). `=> void` = "I won't use your return value." `submitting?` is **optional** —
an enhancement (disable the button) with a sensible default when omitted.

**Q15. Why is `submitting` optional? What's `SyntheticEvent`? What's `useState<Record<string,string>>({})`?**
- **Optional** because the form works without it (required = can't function without;
  optional = nice-to-have).
- **`SyntheticEvent`** = React's normalized event object carrying `preventDefault()`.
- **`useState<Record<string,string>>({})`** = an errors object starting empty, typed as
  "field name → message string." The generic is needed so you can add/read string keys
  later (plain `{}` would infer the empty-object type).

**Q16. How does the `errors` object say which field errored?**
Presence of a key = error; absence = fine. `{}` = all valid; `{ alias: "reserved" }` =
only alias errored. Reading a missing key gives `undefined` (falsy), so
`{errors.alias && <small>…</small>}` renders a message only when the key exists.

**Q17. Why `setErrors({})` on a valid submit?**
State persists between submits. The *failure* branch is the only thing that writes error
messages, so on a successful submit nothing would clear the old ones — they'd linger.
`setErrors({})` wipes them. (Note: errors update at **submit time**, not while typing.)

**Q18. `for...in` vs `for...of`?**
`for...in` on an array gives the **indices** (`"0"`, `"1"`). `for...of` gives the actual
**elements**. To iterate `result.error.issues`, use `for...of`.

**Q19. What does `result.error.issues` look like, and what are we doing with it?**
It's a flat array, one entry per problem: `[{ path: ["alias"], message: "…" }, …]`. We
loop it and **rekey by field name** into `{ alias: "…", originalUrl: "…" }` so each input
can look up its own message with `errors.<field>` (search-the-list → lookup-the-key).

### D. Data fetching (useEffect & the stale-response guard)

**Q20. What is the `ignore` flag for?**
It stops an **old, slow response from updating the screen after the user moved on**
(navigated away / switched code). Analogy: you order food, leave the restaurant — the
`ignore` flag says "don't serve it." For a normal fetch you wait for, `ignore` stays
`false` and does nothing.

**Q21. If the cleanup runs `ignore = true` first, wouldn't it block the current fetch?**
No — because **each effect run has its own `ignore`** (a fresh closure). The cleanup of
run #1 sets *run #1's* `ignore`; run #2 has a *separate* `ignore`. A late response checks
**its own** flag. Only a *superseded* fetch gets skipped.

**Q22. But `return () => { ignore = true }` — doesn't that set it immediately?**
No — that **defines** a function and hands it to React; the `ignore = true` inside runs
only when React **calls** the cleanup, which happens at **teardown** (code change /
unmount). During a normal fetch the cleanup is never called, so `ignore` stays `false`.

**Q23. `code` isn't `useState` — will changing it trigger `useEffect`? And why does the effect run on the first visit?**
- `useEffect` runs **always on mount** (that's the first-visit fetch); the dependency
  array only controls *re-runs*.
- Dependencies don't have to be state — **any** value that differs between renders works.
  `code` comes from `useParams`; when the URL changes, React Router **re-renders** the
  page with a new `code`, and the changed `[code]` re-triggers the effect.

### E. Routing & render conditions

**Q24. Explain the render conditions in the stats/list pages.**
An **early-return ladder**, checked in priority order — each `return` exits so exactly one
branch renders:
1. `if (loading)` → spinner (nothing to show yet).
2. `if (error)` → banner, with a nested `status === 404` special-case.
3. `if (!data)` → `null` (impossible-but-safe; also **narrows** `data` from `T | null` to
   `T` so the success block compiles).
4. otherwise → the success view. Inside it, `? :` guards each nullable field
   (`lastAccessedAt`, `expiresAt`) and `new Date(...)` converts strings at display.

### F. Backend, network & pagination

**Q25. Is `resolveForRedirect` the function that produces my stats 404?**
No. That handles the **redirect** route (`GET /:code`). Your stats page calls
`GET /urls/:code/stats` → **`getUrlStats`**, whose `if (!url) throw new NotFoundError`
produces the 404. Also: the stats endpoint does **not** check expiry, so a 404 there means
"code doesn't exist" — expired links still return `200`. (The "410 Gone / expired" logic
lives only in `resolveForRedirect`.) That's why the accurate stats message is just
"No link found for that code."

**Q26. Why branch on `error.status === 404` if it's always a 404?**
It isn't always 404. The stats call can also throw `429` (rate limited), `500` (server
error), or a network error. The branch gives the *common, expected* 404 a friendly
message and lets other failures show their real message. In Phase 5 you'll add a
`status === 429` branch too — this is the hook that makes that possible.

**Q27. Where does `totalPages = Math.ceil(total / pageSize)` live?**
On the **frontend**, in `LinkListPage` (Phase 4). The backend returns only the raw
`total`; the client derives `totalPages` and the Prev/Next disabled state. Returning
primitives and letting the client compute is the common REST convention.

**Q28. What is `pageSize` / how does pagination work?**
`pageSize` = how many items per page. `page` = which page. The backend converts them to
`skip = (page-1)*pageSize` and `take = pageSize` for the DB query, and returns `total` so
the UI can compute page count. `GET /urls` with no params defaults to page 1, size 20 —
it's always paginated (no "return everything" mode; `pageSize` is capped at 100).

**Q29. Why did CORS block my first request?**
Browsers forbid cross-origin calls (`localhost:5173` → `localhost:3000`) unless the server
sends `Access-Control-Allow-*` headers. The backend had no CORS, so `fetch` threw a
`TypeError` ("Failed to fetch"). Adding the `cors` middleware fixed it. (A raw network
error like this bypasses the nice `ApiError` shape — Phase 5 can normalize it.)

**Q30. Trace how "alias 'promo' is already taken" reaches the banner.**
Postgres unique violation → Prisma `P2002` → the **service** catches it and throws
`ConflictError("alias 'promo' is already taken")` (409) → Express forwards it → the
**error handler** sends `{ error, message }` with status 409 → the frontend `request`
reads `data.message` and throws `{ status: 409, message }` → the page's `catch` →
`setApiError` → `<ErrorBanner>` renders it. Each layer translates the error into its own
vocabulary (DB → business rule → HTTP → UI).

---

## 10. Where we stand & what's next

### ✅ Done (Phases 1–4)
| Phase | Status |
|---|---|
| 1 — Setup (client, routing, env) | ✅ |
| 2 — Create Link (form, Zod, copy, error banner) | ✅ |
| 3 — Link Stats (hook, tiles, 404) | ✅ |
| 4 — Link List (pagination, delete-with-confirm, states) | ✅ |
| Backend: CORS + `GET /urls` + `DELETE /urls/:code` | ✅ |
| Styling moved to `index.css` | ✅ |

### ✅ Phase 5 — Cross-cutting concerns (DONE)
1. **Distinct 429 handling** — `client.ts` reads the `Retry-After` header into
   `ApiError.retryAfter`; a shared `describeError()` helper renders
   *"Too many requests — try again in Ns."* on every page.
2. **Centralized loading/error** — extracted a generic **`useFetch<T>`** hook; both
   `useLinks` and `useLinkStats` now delegate the loading/error/stale-guard pattern to it.
3. **Responsive** — CSS `@media` block + the table is wrapped in `.table-wrap`
   (`overflow-x: auto`) so it scrolls on narrow screens instead of overflowing.
4. **Normalized network errors** — `fetch` is wrapped so "Failed to fetch" becomes
   `{ status: 0, message: "Can't reach the server — is it running?" }`.
5. **README** — written, including the required "how it handles API failures" writeup.

### 🎁 Bonus (only if time allows)
Dark mode toggle · QR code for the short link · form-validation tests (React Testing
Library) · debounced alias-availability check.

### 📦 Submission checklist (from the assignment)
- [x] All three pages implemented + routed
- [x] Client-side Zod validation mirrors backend rules
- [x] Loading + error states on every data-fetching page
- [x] **429 handled distinctly** (Retry-After)
- [x] Copy-to-clipboard on the created short link
- [x] Delete has a confirmation step
- [x] Reasonably responsive layout
- [x] **README** with setup + "how it handles API failures" writeup
- [ ] **Push to GitHub** ← the only thing left

### One-line status
> **Phases 1–5 are complete** and the app works end-to-end against the real backend
> (create, list+paginate+delete, stats, distinct 429/Retry-After, network-error handling,
> responsive, README). **The only thing left is pushing to GitHub.**

---

## 11. Quick cheat-sheet for your walkthrough

- **Architecture:** fetch in `client.ts` → hooks own state → pages compose → dumb components.
- **Why Zod twice:** frontend = UX, backend = security (defense in depth).
- **Empty-string fix:** inputs give `""`; `.optional()` wants `undefined`; `preprocess` bridges it.
- **Serialization boundary:** `Date → string`, `BigInt → number` over JSON.
- **`ignore` flag:** discards stale responses when the user navigates mid-fetch (per-run closure).
- **Error handling:** one `ApiError { status, message }`; pages branch on `status` (404 now, 429 next).
- **Pagination:** `skip=(page-1)*pageSize`, `take=pageSize`; client computes `totalPages` from `total`.
