# Frontend Documentation — Link Shortener Web

A complete, code-first guide to the React frontend (`link-shortener-web/`): **what** each file does, **how** it works line-by-line, **where** it sits in the data flow, and **why** it was built that way. This companion to `BACKEND_DOCUMENTATION.md` leans heavily on the **actual code** — most sections quote and walk through the real source.

---

## Table of Contents

1. [The Big Picture](#1-the-big-picture)
2. [Technology Stack](#2-technology-stack)
3. [Project Structure](#3-project-structure)
4. [Architecture — Layers & Data Flow](#4-architecture--layers--data-flow)
5. [Bootstrapping: `index.html` → `main.tsx` → `App.tsx`](#5-bootstrapping-indexhtml--maintsx--apptsx)
6. [The Types Layer (`types/link.ts`)](#6-the-types-layer-typeslinkts)
7. [The API Client (`api/client.ts`)](#7-the-api-client-apiclientts)
8. [Validation (`schemas/link.schema.ts`)](#8-validation-schemaslinkschemats)
9. [Custom Hooks — the Data Layer](#9-custom-hooks--the-data-layer)
10. [Components — Dumb & Reusable](#10-components--dumb--reusable)
11. [Pages — Smart Containers](#11-pages--smart-containers)
12. [Styling System](#12-styling-system)
13. [Complete Feature Workflows (with code)](#13-complete-feature-workflows-with-code)
14. [Cross-Cutting Patterns Explained](#14-cross-cutting-patterns-explained)
15. [Where to Look for What](#15-where-to-look-for-what)

---

## 1. The Big Picture

This is the **user interface** for the backend API documented in `BACKEND_DOCUMENTATION.md`. It's a **single-page application (SPA)** with three screens:

- **Create** (`/`) — a form to shorten a URL, with a copyable result card.
- **Links** (`/links`) — a paginated table of all links, with copy/stats/delete actions.
- **Stats** (`/links/:code`) — click analytics for one link.

The frontend **never talks to Postgres or Redis** — it only makes HTTP calls to the backend (`POST /urls`, `GET /urls`, `GET /urls/:code/stats`, `DELETE /urls/:code`). All caching, rate limiting, and click counting happen server-side; the frontend just renders whatever the API returns and surfaces the API's real error messages.

```
┌──────────────────────────────────────────────────────────┐
│  Browser (React SPA served by Vite)                       │
│                                                            │
│  Pages (smart)      Hooks (data)      api/client.ts        │
│  ─────────────      ────────────      ────────────         │
│  CreateLinkPage ──▶ (inline)     ──▶  createLink() ──┐     │
│  LinkListPage   ──▶ useLinks()   ──▶  listLinks()  ──┤     │
│  LinkStatsPage  ──▶ useLinkStats ──▶  getStats()   ──┤     │
│                                       deleteLink() ──┤     │
│  Components (dumb): LinkForm, LinkTable,             │     │
│                     ErrorBanner, LoadingSpinner     │     │
└─────────────────────────────────────────────────────┼─────┘
                                                       │ fetch()
                                                       ▼
                                    Backend API (http://localhost:3000)
```

---

## 2. Technology Stack

| Concern | Choice | Why |
|---|---|---|
| UI library | **React 19** | Component model, hooks |
| Build tool / dev server | **Vite 8** | Instant HMR, `import.meta.env` for config |
| Language | **TypeScript** | Types shared in spirit with the backend |
| Routing | **react-router-dom 7** | Client-side routes without page reloads |
| Validation | **Zod 4** | Same schema-first approach as the backend |
| HTTP | **native `fetch`** | No axios needed; one thin wrapper |
| Styling | **plain CSS** (design tokens) | No framework; CSS variables for theming |

No state-management library (Redux/Zustand) — state is local to pages and custom hooks, which is all this app size needs.

---

## 3. Project Structure

```
link-shortener-web/
├── index.html              # HTML shell; mounts #root, loads main.tsx
├── vite.config.ts          # Vite + React plugin
├── .env / .env.example     # VITE_API_URL — the backend base URL
├── package.json            # deps + scripts (dev/build/lint/preview)
└── src/
    ├── main.tsx            # entry: mounts React, wraps in <BrowserRouter>
    ├── App.tsx             # routes + nav (no page logic)
    │
    ├── types/
    │   └── link.ts         # Link, LinkStats, ApiError, Paginated<T>
    ├── schemas/
    │   └── link.schema.ts  # Zod createLinkSchema (client-side validation)
    ├── api/
    │   └── client.ts       # the ONLY place fetch() is called
    │
    ├── hooks/
    │   ├── useLinks.ts      # list data + pagination + refetch
    │   └── useLinkStats.ts  # one link's stats
    │
    ├── components/          # "dumb" reusable UI
    │   ├── LinkForm.tsx     # the create form + client validation
    │   ├── LinkTable.tsx    # the links table (emits events)
    │   ├── ErrorBanner.tsx  # red error strip
    │   └── LoadingSpinner.tsx
    │
    ├── pages/               # "smart" route containers
    │   ├── CreateLinkPage.tsx
    │   ├── LinkListPage.tsx
    │   └── LinkStatsPage.tsx
    │
    └── styles/              # one CSS file per concern
        ├── base.css  buttons.css  card.css  error.css
        ├── form.css  list.css     stats.css table.css
```

---

## 4. Architecture — Layers & Data Flow

The frontend mirrors the backend's separation of concerns. Data flows **downward** through clear layers, and each layer only knows about the one below it:

| Layer | Files | Job | Knows about |
|---|---|---|---|
| **Pages** (smart) | `pages/*` | Own state, call hooks/API, wire callbacks | Hooks, components, API |
| **Hooks** (data) | `hooks/*` | Fetch + own loading/error/data state | The API client |
| **Components** (dumb) | `components/*` | Render props, emit events. No fetching. | Only their props |
| **API client** | `api/client.ts` | The single `fetch()` boundary | HTTP + types |
| **Types & Schemas** | `types/*`, `schemas/*` | Shape of data + validation rules | Nothing |

**Two core principles:**

1. **Smart vs. dumb components.** *Pages* are "smart": they hold state and know how to talk to the API. *Components* are "dumb": they receive data via props and emit events via callbacks (`onSubmit`, `onCopy`, `onDelete`) — they never fetch. This is why `LinkTable` "knows nothing about the API — the page owns what those actions actually do" (its own comment).

2. **One fetch boundary.** *Every* network call goes through `api/client.ts`. No component or page calls `fetch()` directly. Change the base URL, headers, or error handling in exactly one place.

---

## 5. Bootstrapping: `index.html` → `main.tsx` → `App.tsx`

### `index.html` — the shell

```html
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
```

A near-empty page with one mount point (`#root`) and a module script. Vite injects the bundled React app here. Everything visible is rendered by React.

### `main.tsx` — the entry point

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import './styles/base.css'
import './styles/buttons.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
```

Line by line:
- **`createRoot(...).render(...)`** — React 19's mounting API; attaches the app to `#root`.
- **`<StrictMode>`** — a dev-only wrapper that intentionally double-invokes effects/renders to surface bugs (like missing cleanup). This is *why* the hooks use an `ignore` flag (§9) — StrictMode makes the "stale response" scenario visible in development.
- **`<BrowserRouter>`** — enables client-side routing using the HTML5 History API (real URLs, no `#`). It must wrap `<App>` so the `<Routes>` inside can work.
- **Global CSS** (`base.css`, `buttons.css`) is imported once here so it applies app-wide; page/component-specific CSS is imported by those files themselves.

### `App.tsx` — routes + nav only

```tsx
export default function App() {
  return (
    <>
      <nav className="nav">
        <Link to="/">Create</Link>
        <Link to="/links">Links</Link>
      </nav>
      <Routes>
        <Route path="/" element={<CreateLinkPage />} />
        <Route path="/links" element={<LinkListPage />} />
        <Route path="/links/:code" element={<LinkStatsPage />} />
      </Routes>
    </>
  );
}
```

- The top comment says it all: **"Routes only — no page logic here."** `App` is a pure router.
- `<Link>` (from react-router) navigates **without a full page reload** — that's the SPA behavior.
- `<Routes>`/`<Route>` map a URL path to a page component. `path="/links/:code"` declares a **URL parameter** `code`, which `LinkStatsPage` reads via `useParams()` (§11.3).

---

## 6. The Types Layer (`types/link.ts`)

TypeScript types describing exactly what the API returns. These are the contract between the frontend and backend responses.

```ts
export type Link = {
  code: string;
  originalUrl: string;
  shortUrl: string;
  createdAt: string;        // ISO string (JSON has no Date)
  expiresAt: string | null; // null = never expires
};

export type LinkStats = {
  code: string;
  originalUrl: string;
  clickCount: number;       // BigInt on the server → number on the wire
  createdAt: string;        // ISO
  lastAccessedAt: string | null;
  expiresAt: string | null;
};

export type ApiError = {
  status: number;  // 400 | 404 | 409 | 429 | 500 …
  message: string; // the REAL backend message, surfaced by ErrorBanner
};

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};
```

Notes worth calling out:
- **Dates are `string`, not `Date`** — JSON has no Date type, so the wire format is ISO strings. Pages convert them at render time with `new Date(...).toLocaleString()`.
- **`clickCount` is `number`** — the backend stores it as `BigInt` (Postgres `BIGINT`) but serializes it to a JS number over HTTP.
- **`ApiError`** carries both a numeric `status` (used for logic, e.g. "404 → No link found") *and* the backend's real `message` (shown to the user).
- **`Paginated<T>` is generic** — `Paginated<Link>` describes the `GET /urls` response. Its shape mirrors the backend's list response exactly.

---

## 7. The API Client (`api/client.ts`)

This is the **single boundary** between the app and the network — the only file that calls `fetch()`.

### The base URL

```ts
const BASE_URL = import.meta.env.VITE_API_URL;
```

`import.meta.env` is Vite's build-time env access. `VITE_API_URL` comes from `.env` (`http://localhost:3000`). Only variables prefixed `VITE_` are exposed to client code (a Vite security rule), so secrets can't leak into the bundle.

### The generic `request<T>()` — the workhorse

```ts
export async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const error: ApiError = {
      status: res.status,
      message: data?.message ?? res.statusText ?? "Request Failed",
    };
    throw error;
  }
  return data as T;
}
```

Every line earns its place:
- **`fetch(\`${BASE_URL}${path}\`, ...)`** — prepends the base URL so callers pass only the path.
- **`headers: { "Content-Type": "application/json" }, ...options`** — sets the JSON header by default, but `...options` lets a caller override method/body. (Spread order means caller options win.)
- **`const text = await res.text(); const data = text ? JSON.parse(text) : null;`** — the key robustness trick. It reads the body as **text first**, then only parses if non-empty. This is *why* a `204 No Content` (from DELETE) doesn't crash `JSON.parse("")`. Calling `res.json()` directly on an empty body would throw.
- **`if (!res.ok)`** — `fetch` does **not** throw on HTTP errors (4xx/5xx); you must check `res.ok` yourself. On failure it builds a consistent `ApiError` and **throws it**, so every caller can `try/catch` uniformly.
- **`message: data?.message ?? res.statusText ?? "Request Failed"`** — prefers the backend's real message (e.g. "alias 'foo' is already taken"), then the HTTP status text, then a generic fallback. This is how the backend's actual validation/conflict messages reach the UI.
- **`return data as T`** — the generic `<T>` lets each wrapper declare its return type.

### The four typed wrappers

```ts
export async function createLink(input: CreateLinkInput): Promise<Link> {
  return request<Link>("/urls", { method: "POST", body: JSON.stringify(input) });
}

export async function getStats(code: string): Promise<LinkStats> {
  return request<LinkStats>(`/urls/${code}/stats`);
}

export async function listLinks(page = 1, pageSize = 10): Promise<Paginated<Link>> {
  return request<Paginated<Link>>(`/urls?page=${page}&pageSize=${pageSize}`);
}

export async function deleteLink(code: string): Promise<void> {
  await request<void>(`/urls/${code}`, { method: "DELETE" });
}
```

Each is a one-liner over `request<T>()`, differing only in path, method, and return type. They map **1:1 to backend endpoints**. Note `listLinks` has default arguments (`page = 1, pageSize = 10`) so callers can omit them.

> **Note:** there is no `updateLink` here — the UI currently exposes create, list, stats, and delete. The backend's `PATCH /urls/:code` exists but isn't wired into this frontend yet.

---

## 8. Validation (`schemas/link.schema.ts`)

The frontend validates the create form **before** sending it, using Zod — the same library and rules as the backend. This gives instant feedback without a round-trip (and the backend still re-validates as the real gatekeeper).

```ts
const aliasSchema = z
  .string()
  .min(1)
  .max(20)
  .regex(/^[A-Za-z0-9_-]+$/, 'alias may only contain letters, numbbers, - and _')
  .refine((alias) => !RESERVED_ALIASES.has(alias.toLowerCase()), {
    message: "This alias is reserved and Cannot be used"
  })

const futureDate = z.coerce.date().refine((d) => d.getTime() > Date.now(), {
  message: "ExpiresAt must be in the future"
})

const emptyToUndefined = (v: unknown) => (v === "") ? undefined : v

// preprocess runs before validation
export const createLinkSchema = z.object({
  originalUrl: z.url(),
  alias: preprocess(emptyToUndefined, aliasSchema.optional()),
  expiresAt: preprocess(emptyToUndefined, futureDate.optional())
})

export type CreateLinkInput = z.infer<typeof createLinkSchema>
```

The important mechanics:
- **`emptyToUndefined` + `preprocess`** — this is the crucial bit. The form's inputs are always **strings**, and an empty optional field is `""`. Without this, `""` would fail the alias regex / date parsing. `preprocess` runs *first* and converts `""` → `undefined`, so an empty optional field is treated as "not provided" and passes `.optional()`. This is why you can submit with a blank alias and blank expiry.
- **`aliasSchema`** — mirrors the backend: 1–20 chars, URL-safe pattern, not a reserved word. Reserved words (`urls`, `api`, `admin`, …) would collide with real routes.
- **`futureDate`** — `z.coerce.date()` turns the `<input type="date">` string into a `Date`, then `.refine()` requires it to be in the future.
- **`z.infer<typeof createLinkSchema>`** — derives the `CreateLinkInput` TS type straight from the schema, so the schema is the single source of truth for both validation *and* the type passed to `createLink()`.

> The reserved list and alias rules are intentionally duplicated from the backend so the client can validate offline; the backend remains the authority.

---

## 9. Custom Hooks — the Data Layer

Hooks encapsulate "fetch + loading/error/data state" so pages stay focused on rendering. Both hooks share an identical, deliberate structure.

### `useLinkStats.ts` — fetching one link's stats

```ts
export function useLinkStats(code: string) {
  const [data, setData] = useState<LinkStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let ignore = false;               // stale-response guard

    setLoading(true);
    setError(null);
    setData(null);

    getStats(code)
      .then((stats) => { if (!ignore) setData(stats); })
      .catch((err)  => { if (!ignore) setError(err as ApiError); })
      .finally(()   => { if (!ignore) setLoading(false); });

    return () => { ignore = true; };  // cleanup: ignore this run's result
  }, [code]);

  return { data, loading, error };
}
```

The **three-state pattern** (`data` / `loading` / `error`) is the heart of both hooks — a page can render exactly one of "spinner", "error banner", or "content" from it.

The **`ignore` flag** is the subtle, important part. When `code` changes rapidly (or the component unmounts, or StrictMode double-runs the effect), an *older* fetch might resolve *after* a newer one. Without the guard, the stale response would overwrite fresh data (a race condition). The cleanup function sets `ignore = true`, so a superseded run's `.then/.catch/.finally` become no-ops. The `[code]` dependency array re-runs the fetch whenever `code` changes.

### `useLinks.ts` — list data + pagination + refetch

```ts
export function useLinks(pageSize = 10) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<Link> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  // Bumping this forces the effect to re-run without changing `page`.
  const [reloadKey, setReloadKey] = useState(0);
  const refetch = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError(null);

    listLinks(page, pageSize)
      .then((res) => { if (!ignore) setData(res); })
      .catch((err) => { if (!ignore) setError(err as ApiError); })
      .finally(() => { if (!ignore) setLoading(false); });

    return () => { ignore = true; };
  }, [page, pageSize, reloadKey]);

  return { data, loading, error, page, setPage, refetch };
}
```

Everything from `useLinkStats` plus two extras:
- **`page` / `setPage`** — the hook owns the current page number, and it's in the effect's dependency array, so changing the page automatically refetches.
- **`reloadKey` + `refetch()`** — a clever trick to **force a re-fetch of the *same* page** (e.g. after a delete). You can't just "call the effect again," but bumping a state value that's in the dependency array re-triggers it. `refetch` increments `reloadKey`, which re-runs the effect without changing `page`.

---

## 10. Components — Dumb & Reusable

All four components are **presentational**: they take props, render UI, and emit events. None of them fetch or hold business logic.

### `LoadingSpinner.tsx` — trivially dumb

```tsx
export function LoadingSpinner() {
  return <p className="loading" role="status">Loading…</p>;
}
```
`role="status"` announces loading to screen readers.

### `ErrorBanner.tsx` — conditional red strip

```tsx
export function ErrorBanner({ message }: { message?: string | null }) {
  if (!message) return null;
  return <div className="error-banner" role="alert">{message}</div>;
}
```
- **`if (!message) return null`** — renders *nothing* when there's no error, so pages can unconditionally place `<ErrorBanner message={...} />` and it just disappears when there's no message.
- **`role="alert"`** — makes assistive tech announce the error immediately.

### `LinkForm.tsx` — the create form (client validation lives here)

This is the most logic-heavy component. It's an **uncontrolled-to-controlled form** with local validation.

```tsx
export function LinkForm({ onSubmit, submitting }: LinkFormProps) {
  const [originalUrl, setOriginalUrl] = useState("");
  const [alias, setAlias] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function handleSubmit(e: SyntheticEvent) {
    e.preventDefault();

    const result = createLinkSchema.safeParse({ originalUrl, alias, expiresAt });

    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0];
        if (typeof field === "string" && !fieldErrors[field]) {
          fieldErrors[field] = issue.message;   // keep first error per field
        }
      }
      setErrors(fieldErrors);
      return;
    }

    setErrors({});
    onSubmit(result.data);                        // hand parsed data to the page
  }
  // ...JSX: three <input>s, each showing errors[field] below it...
}
```

How it works:
- **One state variable per input** (`originalUrl`, `alias`, `expiresAt`), all starting `""`. Each `<input>` is **controlled** (`value={...}` + `onChange={...}`).
- **`errors` is a sparse map** `fieldName → message`. A field shows an error *iff* its key is present.
- **`e.preventDefault()`** — stops the browser's native full-page form submission (we handle it in JS).
- **`createLinkSchema.safeParse(...)`** — runs the Zod validation from §8. `safeParse` returns `{ success, data | error }` instead of throwing.
- **On failure** — it walks `result.error.issues`, keeping only the **first** message per field (`!fieldErrors[field]`), and calls `setErrors(...)` to render them inline. It returns early — `onSubmit` is **never** called with invalid data.
- **On success** — clears stale errors and calls `onSubmit(result.data)`, handing the **parsed, typed** `CreateLinkInput` up to the page.
- **`noValidate`** on the `<form>` disables the browser's built-in validation bubbles so Zod is the single source of truth.
- **`disabled={submitting}`** on the button, with the label switching to "Shortening…" — prevents double-submits while a request is in flight (the page owns the `submitting` flag).

**Key design point:** the form validates and emits; it does **not** call the API. The page decides what "submit" does.

### `LinkTable.tsx` — the links table (emits events)

```tsx
type LinkTableProps = {
  links: Link[];
  onCopy: (shortUrl: string) => void;
  onDelete: (code: string) => void;
};

export function LinkTable({ links, onCopy, onDelete }: LinkTableProps) {
  return (
    <table className="table">
      {/* thead… */}
      <tbody>
        {links.map((link) => (
          <tr key={link.code}>
            <td className="mono">{link.code}</td>
            <td className="truncate">
              <a href={link.originalUrl} target="_blank" rel="noreferrer">
                {link.originalUrl}
              </a>
            </td>
            <td className="muted">{new Date(link.createdAt).toLocaleDateString()}</td>
            <td>
              <div className="table-actions">
                <button className="btn btn-sm" onClick={() => onCopy(link.shortUrl)}>Copy</button>
                <RouterLink className="btn btn-sm" to={`/links/${link.code}`}>Stats</RouterLink>
                <button className="btn btn-sm btn-danger" onClick={() => onDelete(link.code)}>Delete</button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- Its own comment: **"Dumb table: it renders rows and EMITS events (onCopy/onDelete). It knows nothing about the API."** The parent page supplies the handlers.
- **`key={link.code}`** — React needs a stable unique key per list item for efficient reconciliation; `code` is unique.
- **`target="_blank" rel="noreferrer"`** — opens destinations in a new tab; `rel="noreferrer"` is a security/privacy best practice (no referrer leakage, no `window.opener` access).
- **`new Date(link.createdAt).toLocaleDateString()`** — converts the ISO string to the user's locale date at render time.
- **`<RouterLink to={\`/links/${link.code}\`}>`** — client-side navigation to that link's stats page.

---

## 11. Pages — Smart Containers

Pages are the "smart" layer: they own state, call hooks/API, and wire dumb components together.

### 11.1 `CreateLinkPage.tsx`

```tsx
export default function CreateLinkPage() {
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<Link | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleCreate(data: CreateLinkInput) {
    setSubmitting(true);
    setApiError(null);
    setResult(null);
    try {
      const link = await createLink(data);
      setResult(link);
    } catch (err) {
      setApiError(err as ApiError);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy() {
    if (!result) return;
    await navigator.clipboard.writeText(result.shortUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  // ...JSX...
}
```

- Owns four pieces of state: `submitting` (in-flight flag passed to the form), `apiError`, `result` (the created link), and `copied` (a transient UI flag).
- **`handleCreate`** is the callback given to `<LinkForm onSubmit={handleCreate} submitting={submitting} />`. The form validates; this handler calls the API. The `try/catch/finally` is the canonical async-request shape: set submitting → call API → on success store result, on error store the `ApiError` (whose message the `ErrorBanner` shows) → always clear submitting.
- **`handleCopy`** uses the **Clipboard API** (`navigator.clipboard.writeText`) and flips `copied` to show "Copied!" for 1.5s via `setTimeout`.
- The result card conditionally renders (`{result && ...}`) with a copy button and a `<RouterLink>` to stats.

### 11.2 `LinkListPage.tsx`

```tsx
export default function LinkListPage() {
  const { data, loading, error, page, setPage, refetch } = useLinks(PAGE_SIZE);

  async function handleDelete(code: string) {
    const ok = window.confirm(`Delete link "${code}"? This cannot be undone.`);
    if (!ok) return;
    try {
      await deleteLink(code);
      // If we removed the last row on a non-first page, step back; else refresh.
      if (data && data.items.length === 1 && page > 1) {
        setPage(page - 1);
      } else {
        refetch();
      }
    } catch (err) {
      alert((err as ApiError).message);
    }
  }

  if (loading) return (<div className="container"><LoadingSpinner /></div>);
  if (error)   return (<div className="container"><ErrorBanner message={error.message} /></div>);
  if (!data)   return null;

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  // ...JSX: table + prev/next pagination...
}
```

- **Delegates all data concerns to `useLinks`**, then renders one of three states via **guard clauses**: `loading` → spinner, `error` → banner, else the table. This is the three-state pattern from the hook, made visible.
- **`handleDelete`** requires a `window.confirm` (nothing deletes without a yes), calls `deleteLink`, then does smart pagination: if you just deleted the *last remaining row* on a page beyond the first, it steps back a page (`setPage(page - 1)`); otherwise it `refetch()`es the current page. Both trigger a re-fetch (page change or `reloadKey` bump).
- **`totalPages = Math.max(1, Math.ceil(total / pageSize))`** — derives page count for the "Page X of Y" label and to disable Prev/Next at the ends.
- Empty state: if `items.length === 0`, it shows a friendly "No links yet — create one →" instead of an empty table.

### 11.3 `LinkStatsPage.tsx`

```tsx
export default function LinkStatsPage() {
  const { code } = useParams<{ code: string }>();
  const { data, loading, error } = useLinkStats(code ?? "");

  if (loading) return (<div className="container"><LoadingSpinner /></div>);

  if (error) {
    const message = error.status === 404
      ? "No link found for that code."
      : error.message;
    return (<div className="container"><ErrorBanner message={message} /></div>);
  }

  if (!data) return null;
  // ...JSX: three StatTiles (Clicks / Created / Last accessed) + destination…
}
```

- **`useParams<{ code: string }>()`** reads the `:code` segment from the URL (defined in `App.tsx`'s route). `code ?? ""` guards the `string | undefined` type.
- Passes `code` to `useLinkStats`, then renders the same three-state pattern.
- **Status-aware error message:** a **404** is translated to the friendly "No link found for that code." while any other error shows the backend's raw message. This is exactly why `ApiError` carries both `status` and `message`.
- The nested **`StatTile`** helper (a tiny label+value component defined in the same file) renders Clicks / Created / Last accessed. Dates are formatted with `toLocaleDateString()` / `toLocaleString()`; `lastAccessedAt` falls back to `"—"` when null; expiry shows `"never"` when null.

> The **live click count** you see here is meaningful because of the backend: `clickCount` = Postgres count + un-flushed Redis buffer (see the backend doc's click-tracking section). The frontend just displays the number the API returns.

---

## 12. Styling System

Plain CSS, no framework — organized as **one file per concern** and built on **design tokens**.

- **`base.css`** defines the design tokens as CSS custom properties on `:root` (colors, radius, mono font) and the global reset/layout:

  ```css
  :root {
    --bg: #f8fafc;  --surface: #ffffff;  --border: #e2e8f0;
    --text: #0f172a; --muted: #64748b;
    --primary: #4f46e5; --primary-hover: #4338ca;
    --danger: #e11d48; --radius: 12px;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  ```

  Every other stylesheet references these variables (`var(--primary)`, etc.), so the whole palette changes from one place. It also has a mobile `@media (max-width: 640px)` tweak.
- **`base.css` + `buttons.css`** are imported globally in `main.tsx`; the rest (`card`, `form`, `error`, `stats`, `table`, `list`) are imported by the specific page/component that uses them (e.g. `LinkForm` imports `form.css`). This keeps styles colocated with their usage.
- Utility classes like `.mono`, `.muted`, `.truncate`, `.container` are shared across components.

---

## 13. Complete Feature Workflows (with code)

End-to-end traces tying every layer together. Each shows the full path: **UI event → page → API client → backend → back up to render.**

### 13.1 Create a link

```
User fills form ─▶ LinkForm.handleSubmit
   └─ createLinkSchema.safeParse()          [client validation, §8]
        ├─ invalid ─▶ setErrors() → inline field errors, STOP
        └─ valid   ─▶ onSubmit(parsedData)
                        └─ CreateLinkPage.handleCreate(data)
                             ├─ setSubmitting(true)
                             └─ createLink(data)  ── POST /urls ──▶ backend
                                                                     (validates, inserts,
                                                                      invalidates cache)
                             ◀── 201 { code, shortUrl, … }
                             ├─ success ─▶ setResult(link) → result card (Copy / Stats)
                             └─ error   ─▶ setApiError(err) → <ErrorBanner> shows
                                            the backend message (e.g. 409 "alias taken")
```
Two validation layers: Zod on the client for instant feedback, and the backend as the real authority (its 400/409 messages surface via `ErrorBanner`).

### 13.2 List links (with pagination)

```
Navigate to /links ─▶ LinkListPage renders ─▶ useLinks(10)
   └─ useEffect runs ─▶ listLinks(page, 10) ── GET /urls?page=&pageSize= ──▶ backend
                                                (reads live from Postgres)
   ◀── { items, total, page, pageSize }
   ├─ loading ─▶ <LoadingSpinner>
   ├─ error   ─▶ <ErrorBanner>
   └─ data    ─▶ <LinkTable> + pagination
                  └─ Prev/Next ─▶ setPage(±1) ─▶ effect re-runs ─▶ refetch
```

### 13.3 View stats

```
Click "Stats" (RouterLink) ─▶ /links/:code ─▶ LinkStatsPage
   └─ useParams() → code ─▶ useLinkStats(code)
        └─ getStats(code) ── GET /urls/:code/stats ──▶ backend
                              (Postgres count + Redis un-flushed buffer = live total)
        ◀── { clickCount, createdAt, lastAccessedAt, … }
        ├─ 404   ─▶ "No link found for that code."
        ├─ error ─▶ backend message
        └─ data  ─▶ StatTiles (Clicks / Created / Last accessed) + destination
```

### 13.4 Delete a link

```
Click "Delete" in a row ─▶ LinkTable emits onDelete(code)
   └─ LinkListPage.handleDelete(code)
        ├─ window.confirm()  ── user says no ─▶ STOP
        └─ deleteLink(code) ── DELETE /urls/:code ──▶ backend
                                (deletes row, invalidates cache; 204 No Content)
           │  (request() handles the empty 204 body safely — text-first parse)
           ├─ last row on page > 1 ─▶ setPage(page-1)   ┐ both trigger a
           └─ otherwise             ─▶ refetch()         ┘ fresh list fetch
```

---

## 14. Cross-Cutting Patterns Explained

These patterns recur across the codebase — understanding them once explains the whole app.

1. **The three-state async pattern (`data` / `loading` / `error`).**
   Every data fetch tracks these three. Pages render exactly one branch. It's in both hooks and both list/stats pages. Simple, predictable, and covers every UI state.

2. **The `ignore` stale-response guard.**
   In every `useEffect` that fetches, a local `let ignore = false` plus a cleanup `() => { ignore = true }` prevents an outdated request from overwriting current state. Essential under React StrictMode and rapid navigation.

3. **Smart pages, dumb components.**
   Pages own state and API calls; components take props and emit callbacks. This makes components trivially reusable and testable, and keeps "what happens on click" in one obvious place (the page).

4. **One fetch boundary + thrown `ApiError`.**
   All network access funnels through `api/client.ts`, which normalizes every failure into `ApiError { status, message }` and throws it. Callers use uniform `try/catch`; the UI always has a real message to show.

5. **Validate on the client, trust the server.**
   Zod validates the form for instant UX, but the backend re-validates as the authority. The client duplicates the alias/expiry rules on purpose; the server is never bypassed.

6. **`preprocess(emptyToUndefined, …)`.**
   The bridge between "HTML inputs are always strings" and "optional fields should be absent when blank." Turns `""` into `undefined` before validation so empty optional fields pass.

7. **`refetch` via a `reloadKey`.**
   Re-running an effect on demand (without changing its "real" inputs) by bumping a counter that's in its dependency array — the idiomatic way to force a reload after a mutation.

---

## 15. Where to Look for What

| I want to change... | Edit this file |
|---|---|
| The backend base URL | `.env` (`VITE_API_URL`) |
| How requests are made / errors normalized | `api/client.ts` |
| A response's TypeScript shape | `types/link.ts` |
| Client-side validation rules (alias, expiry) | `schemas/link.schema.ts` |
| The create form UI / field errors | `components/LinkForm.tsx` |
| The links table columns / row actions | `components/LinkTable.tsx` |
| List fetching / pagination / refetch logic | `hooks/useLinks.ts` |
| Stats fetching logic | `hooks/useLinkStats.ts` |
| The create screen (result card, copy) | `pages/CreateLinkPage.tsx` |
| The list screen (delete, pagination UI) | `pages/LinkListPage.tsx` |
| The stats screen (tiles, 404 message) | `pages/LinkStatsPage.tsx` |
| Routes / nav | `App.tsx` |
| App mounting / global providers | `main.tsx` |
| Colors, spacing, tokens | `styles/base.css` |
| Component-specific styles | `styles/<name>.css` |
```

