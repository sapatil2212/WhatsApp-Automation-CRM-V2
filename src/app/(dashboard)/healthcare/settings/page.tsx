import { redirect } from "next/navigation";

/** AI behaviour is configured inside Business Setup. */
export default function AiSettingsRedirect() {
  redirect("/healthcare/setup");
}
