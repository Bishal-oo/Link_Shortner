// ⚠️ OBSOLETE after the TanStack Query migration.
//
// This whole hook was a hand-rolled mini version of TanStack Query's useQuery:
// it owned the loading/error/data lifecycle AND the stale-response guard.
// useQuery now does all of that (plus caching, background refetch, dedupe), so
// nothing imports this file anymore. Kept here — fully commented out — as a
// reference for what useQuery replaced.
//
// `export {}` keeps this a valid ES module now that it has no live exports.
export {};

/*
import { useEffect, useState } from "react";
import type { ApiError } from "@/types/link";

/**
 * Generic data-fetching hook. Owns the loading/error/data lifecycle AND the
 * stale-response guard ONCE, so resource hooks (useLinks, useLinkStats) don't
 * repeat it. `deps` controls when it re-fetches — same role as a useEffect
 * dependency array.
 * /
export function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let ignore = false; // discard a stale response if deps change / unmount

    setLoading(true);
    setError(null);

    fetcher()
      .then((res) => {
        if (!ignore) setData(res);
      })
      .catch((err) => {
        if (!ignore) setError(err as ApiError);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
    // `deps` is the caller-supplied dependency list; `fetcher` is intentionally
    // excluded (it's a fresh closure each render — deps capture what matters).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error };
}
*/
