import { redirect } from "next/navigation";

/** Analytics now live on the single /dashboard for every business type. */
export default function SegmentDashboardRedirect() {
  redirect("/dashboard");
}
