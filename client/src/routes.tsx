import type { RouteObject } from "react-router";
import { RequireAuth } from "./auth/RequireAuth";
import { RootLayout } from "./components/RootLayout";
import { AssignmentsPage } from "./pages/AssignmentsPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { RouteError } from "./pages/RouteError";
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
          { element: <RequireAuth />, children: [{ index: true, element: <AssignmentsPage /> }] },
          ...(styleguide ? [{ path: "styleguide", element: <StyleguidePage /> }] : []),
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
