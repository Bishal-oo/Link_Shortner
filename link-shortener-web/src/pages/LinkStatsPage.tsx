import { useParams } from "react-router-dom";
import { useLinkStats } from "@/hooks/useLinkStats";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { ErrorBanner } from "@/components/ErrorBanner";
import { describeError } from "@/api/client";
import "@/styles/stats.css";

// Dumb presentational tile — a label + value.
function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat-tile">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export default function LinkStatsPage() {
  const { code } = useParams<{ code: string }>();
  const { data, loading, error } = useLinkStats(code ?? "");

  if (loading)
    return (
      <div className="container">
        <LoadingSpinner />
      </div>
    );

  if (error) {
    // 404 on the stats endpoint means the code doesn't exist.
    const message =
      error.status === 404
        ? "No link found for that code."
        : describeError(error);
    return (
      <div className="container">
        <ErrorBanner message={message} />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="container">
      <h1 className="mono">Stats · {data.code}</h1>

      <div className="stat-tiles">
        <StatTile label="Clicks" value={data.clickCount} />
        <StatTile
          label="Created"
          value={new Date(data.createdAt).toLocaleDateString()}
        />
        <StatTile
          label="Last accessed"
          value={
            data.lastAccessedAt
              ? new Date(data.lastAccessedAt).toLocaleString()
              : "—"
          }
        />
      </div>

      <p>
        Destination:{" "}
        <a href={data.originalUrl} target="_blank" rel="noreferrer">
          {data.originalUrl}
        </a>
      </p>
      <p className="muted">
        Expires:{" "}
        {data.expiresAt ? new Date(data.expiresAt).toLocaleString() : "never"}
      </p>
    </div>
  );
}
