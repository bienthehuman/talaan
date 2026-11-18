import type { ComponentType } from "react";
import { Navigate, type RouteObject } from "react-router";
import { RequireAuth } from "./auth/RequireAuth";
import { RequireRole } from "./auth/RequireRole";
import { RootLayout } from "./components/RootLayout";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { SyncStatusPage } from "./pages/SyncStatusPage";
import { RouteError } from "./pages/RouteError";
import { SubmissionPage } from "./pages/SubmissionPage";

/** The style guide exists in development and in e2e builds (VITE_STYLEGUIDE=1), never in production. */
const styleguide = import.meta.env.DEV || import.meta.env.VITE_STYLEGUIDE === "1";

/** Admin pages and the style guide load on first visit, so a worker's device never parses them. */
function page<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M & string) {
  return async () => ({ Component: (await load())[name] as ComponentType });
}

export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      {
        // Errors render inside the layout so the header stays usable.
        errorElement: <RouteError />,
        children: [
          { path: "login", element: <LoginPage /> },
          {
            element: <RequireAuth />,
            children: [
              { index: true, element: <HomePage /> },
              { path: "sync", element: <SyncStatusPage /> },
              {
                path: "manage",
                element: <RequireRole role="admin" />,
                children: [
                  { index: true, element: <Navigate to="/manage/review" replace /> },
                  {
                    path: "review",
                    lazy: page(() => import("./pages/admin/ReviewQueuePage"), "ReviewQueuePage"),
                  },
                  {
                    path: "review/:id",
                    lazy: page(() => import("./pages/admin/ReviewDetailPage"), "ReviewDetailPage"),
                  },
                  {
                    path: "forms",
                    lazy: page(() => import("./pages/admin/FormsPage"), "FormsPage"),
                  },
                  {
                    path: "forms/:id/edit",
                    lazy: page(() => import("./pages/admin/FormEditorPage"), "FormEditorPage"),
                  },
                  {
                    path: "assignments",
                    lazy: page(
                      () => import("./pages/admin/AssignmentsAdminPage"),
                      "AssignmentsAdminPage",
                    ),
                  },
                  {
                    path: "conflicts",
                    lazy: page(() => import("./pages/admin/ConflictLogPage"), "ConflictLogPage"),
                  },
                ],
              },
              { path: "submissions/:id", element: <SubmissionPage /> },
            ],
          },
          ...(styleguide
            ? [
                {
                  path: "styleguide",
                  lazy: page(() => import("./pages/StyleguidePage"), "StyleguidePage"),
                },
              ]
            : []),
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
