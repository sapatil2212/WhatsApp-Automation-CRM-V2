import { redirect } from "next/navigation";

/** Services are managed inside Business Setup. */
export default function ServicesRedirect() {
  redirect("/healthcare/setup");
}
