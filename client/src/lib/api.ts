import createClient from "openapi-fetch";
import { getSession } from "../auth/session";
import { ApiError, toProblem } from "./problem";
import type { paths } from "./api-types";

/** Typed client generated from the server's OpenAPI schema (`npm run gen:api`).
 *  Same-origin by default: Vite proxies /api in development. */
export const api = createClient<paths>({
  baseUrl: import.meta.env.VITE_API_URL ?? "",
  // Looked up per request (not captured at import) so tests can stub fetch.
  fetch: (request) => globalThis.fetch(request),
});

/** Returns the typed body of a successful call, or throws ApiError built from the problem+json
 *  body. Error bodies are not in the schema, so `error` is read loosely. */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.data === undefined || !result.response.ok) {
    throw new ApiError(toProblem(result.error, result.response.status));
  }
  return result.data;
}

api.use({
  onRequest({ request }) {
    const access = getSession()?.access;
    if (access) request.headers.set("Authorization", `Bearer ${access}`);
    return request;
  },
});
