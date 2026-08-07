import type { ApiError, Link, LinkStats, Paginated } from "@/types/link";
import type { CreateLinkInput } from "@/schemas/link.schema";

const BASE_URL = import.meta.env.VITE_API_URL;

/**
 * The ONLY place fetch() is called. Adds the base URL + JSON header, parses the
 * body (text-first so an empty 204 body doesn't crash JSON.parse), and turns any
 * non-2xx response into a consistent ApiError { status, message } that it throws.
 */
export async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch {
    // fetch only throws on a NETWORK failure (server down, CORS, offline).
    // Normalize it into our ApiError shape so callers handle it like any other.
    throw {
      status: 0,
      message: "Can't reach the server — is it running?",
    } as ApiError;
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const error: ApiError = {
      status: res.status,
      message: data?.message ?? res.statusText ?? "Request Failed",
    };
    // On a 429 the backend sends how long to wait; expose it for a "slow down" UI.
    const retryAfter = Number(res.headers.get("Retry-After"));
    if (res.status === 429 && !Number.isNaN(retryAfter)) {
      error.retryAfter = retryAfter;
    }
    throw error;
  }
  return data as T;
}

/**
 * Turns an ApiError into a user-facing message. Centralizes the "distinct 429"
 * rule so every page shows the same rate-limit wording — no per-page repetition.
 */
export function describeError(error: ApiError): string {
  if (error.status === 429) {
    return error.retryAfter
      ? `Too many requests — please slow down and try again in ${error.retryAfter}s.`
      : "Too many requests — please slow down and try again shortly.";
  }
  return error.message;
}

/** POST /urls — create a short link. */
export async function createLink(input: CreateLinkInput): Promise<Link> {
  return request<Link>("/urls", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** GET /urls/:code/stats — analytics for one link. */
export async function getStats(code: string): Promise<LinkStats> {
  return request<LinkStats>(`/urls/${code}/stats`);
}

/** GET /urls?page=&pageSize= — a page of links, newest first. */
export async function listLinks(
  page = 1,
  pageSize = 10,
): Promise<Paginated<Link>> {
  return request<Paginated<Link>>(`/urls?page=${page}&pageSize=${pageSize}`);
}

/** DELETE /urls/:code — remove a link. 204 No Content on success. */
export async function deleteLink(code: string): Promise<void> {
  await request<void>(`/urls/${code}`, { method: "DELETE" });
}
