import "@/styles/error.css";

// Dumb component: shows a message in a red banner, or nothing if there's none.
export function ErrorBanner({ message }: { message?: string | null }) {
  if (!message) return null;

  return (
    <div className="error-banner" role="alert">
      {message}
    </div>
  );
}
