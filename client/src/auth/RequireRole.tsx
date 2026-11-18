import { Outlet } from "react-router";
import { ForbiddenState } from "../components/States";
import { useAuth } from "./AuthContext";

/** Keeps a part of the app to one role. The server enforces the same rule on every endpoint; this
 *  only stops a worker from seeing screens that cannot work for them. */
export function RequireRole({ role }: { role: string }) {
  const { user } = useAuth();
  if (user?.role !== role) {
    return (
      <div className="page">
        <ForbiddenState />
      </div>
    );
  }
  return <Outlet />;
}
