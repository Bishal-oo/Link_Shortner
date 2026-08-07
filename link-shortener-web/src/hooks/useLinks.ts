import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { listLinks } from "@/api/client";
import type { ApiError, Paginated, Link } from "@/types/link";

/**
 * The Link List's data hook — now backed by TanStack Query.
 *
 * `page` is genuine CLIENT state, so it stays in useState. It's part of the
 * queryKey, so changing the page automatically fetches (and caches) that page.
 * `keepPreviousData` keeps the current page on screen while the next one loads,
 * instead of flashing a spinner. The return shape is unchanged, so the pages
 * that consume this hook don't need edits.
 */
export function useLinks(pageSize = 10) {
  const [page, setPage] = useState(1);

  const query = useQuery<Paginated<Link>, ApiError>({
    queryKey: ["links", page, pageSize],
    queryFn: () => listLinks(page, pageSize), // chian

    //  While loading new quey keep showing previous data
    placeholderData: keepPreviousData,
  });

  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.error ?? null,
    page,
    setPage,
    refetch: query.refetch, // native refetch (delete now invalidates instead)
  };
}

/* --- OLD (pre-TanStack Query): manual page + a reloadKey counter to force refetch ---
import { useState } from "react";
import { listLinks } from "../api/client";
import { useFetch } from "./useFetch";
import type { Paginated, Link } from "../types/link";

export function useLinks(pageSize = 10) {
  const [page, setPage] = useState(1);

  // Bumping reloadKey re-runs the fetch WITHOUT changing the page.
  const [reloadKey, setReloadKey] = useState(0);
  const refetch = () => setReloadKey((k) => k + 1);

  const { data, loading, error } = useFetch<Paginated<Link>>(
    () => listLinks(page, pageSize),
    [page, pageSize, reloadKey],
  );

  return { data, loading, error, page, setPage, refetch };
}
*/
