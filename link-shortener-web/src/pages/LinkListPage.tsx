import { Link as RouterLink } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLinks } from "@/hooks/useLinks";
import { LinkTable } from "@/components/LinkTable";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { ErrorBanner } from "@/components/ErrorBanner";
import { deleteLink, describeError } from "@/api/client";
import type { ApiError } from "@/types/link";
import "@/styles/list.css";

const PAGE_SIZE = 10;

export default function LinkListPage() {
  const { data, loading, error, page, setPage } = useLinks(PAGE_SIZE);
  const queryClient = useQueryClient();

  // Delete as a mutation: on success it invalidates the links list, and every
  // cached page refetches itself — no manual reloadKey/refetch plumbing.
  const deleteMutation = useMutation<void, ApiError, string>({
    mutationFn: deleteLink,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["links"] }),
  });

  async function handleCopy(shortUrl: string) {
    await navigator.clipboard.writeText(shortUrl);
  }

  async function handleDelete(code: string) {
    // Confirmation step (required) — nothing is deleted without a yes.
    const ok = window.confirm(`Delete link "${code}"? This cannot be undone.`);
    if (!ok) return;

    try {
      await deleteMutation.mutateAsync(code);
      // If we just removed the last row on a non-first page, step back a page.
      // (Otherwise the onSuccess invalidation already refetches this page.)
      if (data && data.items.length === 1 && page > 1) {
      
      }
    } catch (err) {
      alert(describeError(err as ApiError));
    }
  }

  if (loading)
    return (
      <div className="container">
        <LoadingSpinner />
      </div>
    );

  if (error)
    return (
      <div className="container">
        <ErrorBanner message={describeError(error)} />
      </div>
    );

  if (!data) return null;

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className="container">
      <h1>
        Your links <span className="muted">({data.total})</span>
      </h1>

      {data.items.length === 0 ? (
        <div className="empty-state">
          No links yet — <RouterLink to="/">create one →</RouterLink>
        </div>
      ) : (
        <>
          <LinkTable
            links={data.items}
            onCopy={handleCopy}
            onDelete={handleDelete}
          />

          <div className="pagination">
            <button
              className="btn btn-sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              ‹ Prev
            </button>
            <span className="muted">
              Page {page} of {totalPages}
            </span>
            <button
              className="btn btn-sm"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              Next ›
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* --- OLD (pre-TanStack Query): plain deleteLink() + manual refetch() from useLinks ---
  const { data, loading, error, page, setPage, refetch } = useLinks(PAGE_SIZE);

  async function handleDelete(code: string) {
    const ok = window.confirm(`Delete link "${code}"? This cannot be undone.`);
    if (!ok) return;

    try {
      await deleteLink(code);
      // If we just removed the last row on a non-first page, step back a page;
      // otherwise refresh the current page.
      if (data && data.items.length === 1 && page > 1) {
        setPage(page - 1);
      } else {
        refetch();
      }
    } catch (err) {
      alert(describeError(err as ApiError));
    }
  }
*/
