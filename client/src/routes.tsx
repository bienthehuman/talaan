import { Navigate, type RouteObject } from "react-router";
import { RequireAuth } from "./auth/RequireAuth";
import { RequireRole } from "./auth/RequireRole";
import { RootLayout } from "./components/RootLayout";
import { HomePage } from "./pages/HomePage";
import { AssignmentsAdminPage } from "./pages/admin/AssignmentsAdminPage";
import { ConflictLogPage } from "./pages/admin/ConflictLogPage";
import { FormEditorPage } from "./pages/admin/FormEditorPage";
import { FormsPage } from "./pages/admin/FormsPage";
import { ReviewDetailPage } from "./pages/admin/ReviewDetailPage";
import { ReviewQueuePage } from "./pages/admin/ReviewQueuePage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { SyncStatusPage } from "./pages/SyncStatusPage";
import { RouteError } from "./pages/RouteError";
import { SubmissionPage } from "./pages/SubmissionPage";
import { StyleguidePage } from "./pages/StyleguidePage";

/** The style guide exists in development and in e2e builds (VITE_STYLEGUIDE=1), never in production. */
const styleguide = import.meta.env.DEV || import.meta.env.VITE_STYLEGUIDE === "1";

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
                  { path: "review", element: <ReviewQueuePage /> },
                  { path: "review/:id", element: <ReviewDetailPage /> },
                  { path: "forms", element: <FormsPage /> },
                  { path: "forms/:id/edit", element: <FormEditorPage /> },
                  { path: "assignments", element: <AssignmentsAdminPage /> },
                  { path: "conflicts", element: <ConflictLogPage /> },
                ],
              },
              { path: "submissions/:id", element: <SubmissionPage /> },
            ],
          },
          ...(styleguide ? [{ path: "styleguide", element: <StyleguidePage /> }] : []),
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
