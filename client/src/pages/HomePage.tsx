import { Navigate } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { AssignmentsPage } from "./AssignmentsPage";

/** Workers start on their assignments; admins start on the review queue. */
export function HomePage() {
  const { user } = useAuth();
  if (user?.role === "admin") return <Navigate to="/manage/review" replace />;
  return <AssignmentsPage />;
}
