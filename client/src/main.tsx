import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { AuthProvider } from "./auth/AuthContext";
import { ToastProvider } from "./components/Toast";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { routes } from "./routes";
import { SyncProvider } from "./sync/SyncProvider";
import "./theme/styles.css";
import { applyTheme, getStoredTheme } from "./theme/theme";

applyTheme(getStoredTheme());

const router = createBrowserRouter(routes);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <SyncProvider>
        <ToastProvider>
          <UpdatePrompt />
          <RouterProvider router={router} />
        </ToastProvider>
      </SyncProvider>
    </AuthProvider>
  </StrictMode>,
);
