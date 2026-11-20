import { redirect } from "next/navigation";

/** Doctors and staff are managed inside Business Setup. */
export default function DoctorsRedirect() {
  redirect("/healthcare/setup");
}
