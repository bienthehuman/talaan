import { useRouteError } from "react-router";
import { ErrorState } from "../components/States";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export function RouteError() {
  useDocumentTitle("Something went wrong");
  const error = useRouteError();
  if (import.meta.env.DEV) console.error(error);
  return (
    <div className="page">
      <ErrorState onRetry={() => window.location.reload()} />
    </div>
  );
}
