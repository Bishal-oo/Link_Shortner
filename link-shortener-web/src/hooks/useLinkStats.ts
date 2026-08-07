import { useQuery } from "@tanstack/react-query";
import { getStats } from "@/api/client";
import type { ApiError, LinkStats } from "@/types/link";

/**
 * Fetches stats for one code — now backed by TanStack Query. The code is part
 * of the queryKey, so navigating between links caches each one separately.
 * `enabled` skips the fetch entirely for an empty code. Return shape unchanged.
 */
export function useLinkStats(code: string) {
  const query = useQuery<LinkStats, ApiError>({
    queryKey: ["stats", code],
    queryFn: () => getStats(code),
    enabled: code !== "",
  });

  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.error ?? null,
  };
}


/* --- OLD (pre-TanStack Query): thin wrapper over useFetch ---
import { getStats } from "../api/client";
import { useFetch } from "./useFetch";
import type { LinkStats } from "../types/link";

export function useLinkStats(code: string) {
  return useFetch<LinkStats>(() => getStats(code), [code]);
}
*/
