import { useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LinkForm } from "@/components/LinkForm";
import { ErrorBanner } from "@/components/ErrorBanner";
import { createLink, describeError } from "@/api/client";
import type { CreateLinkInput } from "@/schemas/link.schema";
import type { ApiError, Link } from "@/types/link";
import "@/styles/card.css";

export default function CreateLinkPage() {
  const [copied, setCopied] = useState(false); // local UI toggle — stays useState
  const queryClient = useQueryClient();

  // useMutation owns the submit lifecycle: isPending (submitting), error, and
  // data (the created link). Each new .mutate() resets those automatically, so
  // the old manual "clear previous run" calls are gone. onSuccess marks the
  // links list stale so it refetches and shows the new link.
  const createMutation = useMutation<Link, ApiError, CreateLinkInput>({
    mutationFn: createLink,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["links"] });
    },
  });

  const result = createMutation.data ?? null;
  const apiError = createMutation.error ?? null;

  async function handleCopy() {
    if (!result) return;
    await navigator.clipboard.writeText(result.shortUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="container">
      <h1>Create a short link</h1>

      <ErrorBanner message={apiError ? describeError(apiError) : undefined} />

      <LinkForm
        onSubmit={(data) => createMutation.mutate(data)}
        submitting={createMutation.isPending}
      />

      {result && (
        <div className="card">
          <p className="card-label">Your short link</p>
          <div className="row">
            <a
              className="short-link"
              href={result.shortUrl}
              target="_blank"
              rel="noreferrer"
            >
              {result.shortUrl}
            </a>
            <button className="btn btn-sm" type="button" onClick={handleCopy}>
              {copied ? "Copied!" : "Copy"}
            </button>
            <RouterLink className="btn btn-sm" to={`/links/${result.code}`}>
              Stats
            </RouterLink>
          </div>
        </div>
      )}
    </div>
  );
}

/* --- OLD (pre-TanStack Query): hand-managed submitting / apiError / result state ---
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<Link | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleCreate(data: CreateLinkInput) {
    setSubmitting(true);
    setApiError(null); // clear the previous run
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

  // ...and in the JSX:
  //   <LinkForm onSubmit={handleCreate} submitting={submitting} />
*/
