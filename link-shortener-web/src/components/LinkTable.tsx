import { Link as RouterLink } from "react-router-dom";
import type { Link } from "@/types/link";
import "@/styles/table.css";

// Dumb table: it renders rows and EMITS events (onCopy/onDelete). It knows
// nothing about the API — the page owns what those actions actually do.
type LinkTableProps = {
  links: Link[];
  onCopy: (shortUrl: string) => void;
  onDelete: (code: string) => void;
};

export function LinkTable({ links, onCopy, onDelete }: LinkTableProps) {
  return (
    <div className="table-wrap">
    <table className="table">
      <thead>
        <tr>
          <th>Code</th>
          <th>Destination</th>
          <th>Created</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {links.map((link) => (
          <tr key={link.code}>
            <td className="mono">{link.code}</td>
            <td className="truncate">
              <a href={link.originalUrl} target="_blank" rel="noreferrer">
                {link.originalUrl}
              </a>
            </td>
            <td className="muted">
              {new Date(link.createdAt).toLocaleDateString()}
            </td>
            <td>
              <div className="table-actions">
                <button
                  className="btn btn-sm"
                  onClick={() => onCopy(link.shortUrl)}
                >
                  Copy
                </button>
                <RouterLink className="btn btn-sm" to={`/links/${link.code}`}>
                  Stats
                </RouterLink>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => onDelete(link.code)}
                >
                  Delete
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}
