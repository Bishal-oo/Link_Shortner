import { useState } from "react";
import type { SyntheticEvent } from "react";
import { createLinkSchema } from "@/schemas/link.schema";
import type { CreateLinkInput } from "@/schemas/link.schema";
import "@/styles/form.css";

type LinkFormProps = {
  onSubmit: (data: CreateLinkInput) => void;
  submitting?: boolean; // page sets this true while the request is in flight
};

export function LinkForm({ onSubmit, submitting }: LinkFormProps) {
  // One piece of state per input. All start "" — a blank text box IS "".
  const [originalUrl, setOriginalUrl] = useState("");
  const [alias, setAlias] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  // Sparse map of fieldName -> error message. A field is "errored" iff its key
  // is present. Empty {} = no errors.
  const [errors, setErrors] = useState<Record<string, string>>({});

  function handleSubmit(e: SyntheticEvent) {
    e.preventDefault();

    const result = createLinkSchema.safeParse({ originalUrl, alias, expiresAt });

    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0];
        // Keep only the first message per field.
        if (typeof field === "string" && !fieldErrors[field]) {
          fieldErrors[field] = issue.message;
        }
      }
      setErrors(fieldErrors);
      return;
    }

    setErrors({}); // clear stale errors on a valid submit
    onSubmit(result.data);
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <label className="field">
        <span>Long URL</span>
        <input
          className="input"
          type="url"
          value={originalUrl}
          onChange={(e) => setOriginalUrl(e.target.value)}
          placeholder="https://example.com/very/long/link"
        />
        {errors.originalUrl && (
          <small className="field-error">{errors.originalUrl}</small>
        )}
      </label>

      <label className="field">
        <span>Alias (optional)</span>
        <input
          className="input"
          type="text"
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          placeholder="my-code"
        />
        {errors.alias && <small className="field-error">{errors.alias}</small>}
      </label>

      <label className="field">
        <span>Expires at (optional)</span>
        <input
          className="input"
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
        />
        {errors.expiresAt && (
          <small className="field-error">{errors.expiresAt}</small>
        )}
      </label>

      <button className="btn btn-primary" type="submit" disabled={submitting}>
        {submitting ? "Shortening…" : "Shorten"}
      </button>
    </form>
  );
}
