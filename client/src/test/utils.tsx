import { render } from "@testing-library/react";
import axe from "axe-core";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { AuthProvider } from "../auth/AuthContext";
import { saveSession, type SessionUser } from "../auth/session";
import { ToastProvider } from "../components/Toast";
import { routes } from "../routes";

export function renderApp(path = "/") {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <AuthProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthProvider>,
  );
  return { ...view, router };
}

export const WORKER: SessionUser = {
  id: 2,
  username: "worker1",
  role: "worker",
  permissions: ["submission.create", "submission.edit"],
};

export function signIn(user: SessionUser = WORKER) {
  saveSession({ access: "access-token", refresh: "refresh-token", user });
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": status >= 400 ? "application/problem+json" : "application/json",
      ...headers,
    },
  });
}

/** Stub global fetch. The handler receives the Request that openapi-fetch built. */
export function mockFetch(handler: (request: Request) => Response | Promise<Response>) {
  const fn = vi.fn((request: Request) => Promise.resolve(handler(request)));
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** Structural accessibility check (names, labels, roles, landmarks). Colour contrast needs a real
 *  browser, so it is covered by the Playwright axe gate instead. */
export async function expectNoA11yViolations(container: Element) {
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  const summary = results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`);
  expect(summary).toEqual([]);
}
