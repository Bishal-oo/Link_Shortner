export type Link = {
  code: string;
  originalUrl: string;
  shortUrl: string;
  createdAt: string; // ISO string (JSON has no Date)
  expiresAt: string | null; // null = never expires
};

export type LinkStats = {
  code: string;
  originalUrl: string;
  clickCount: number; // BigInt on the server → number on the wire
  createdAt: string; // ISO
  lastAccessedAt: string | null;
  expiresAt: string | null;
};

export type ApiError = {
  status: number; // 400 | 404 | 409 | 429 | 500 …
  message: string; // the REAL backend message, surfaced by ErrorBanner
  retryAfter?: number; // seconds — set on a 429, from the Retry-After header
};

/**
 * A generic "one page of results" wrapper — matches what GET /urls returns.
 * `Paginated<Link>` = a page whose `items` are Link[].
 */
export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};
