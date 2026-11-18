import { Link } from "react-router";
import { EmptyState } from "../components/States";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { buttonClass } from "../components/Button";

export function NotFoundPage() {
  useDocumentTitle("Page not found");
  return (
    <div className="page">
      <h1>Page not found</h1>
      <EmptyState
        title="We couldn't find that page"
        action={
          <Link className={buttonClass("primary")} to="/">
            Go to start
          </Link>
        }
      >
        The link may be old or mistyped.
      </EmptyState>
    </div>
  );
}
