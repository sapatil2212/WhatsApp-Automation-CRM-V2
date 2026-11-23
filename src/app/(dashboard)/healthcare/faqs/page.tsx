import { redirect } from "next/navigation";

/**
 * The healthcare AI is trained inside Business Setup now (document / typed
 * import, FAQs step and AI Training step). Old links land there.
 */
export default function HealthcareKnowledgeBaseRedirect() {
  redirect("/healthcare/setup?step=ai-training");
}
