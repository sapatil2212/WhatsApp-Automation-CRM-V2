import { Suspense } from "react";

import { InboxApp } from "@/components/inbox/wa/inbox-app";

/**
 * Team inbox — WhatsApp-Web-style chat list, conversation pane and contact
 * drawer with realtime updates. `?c=<conversationId>` deep-links a chat.
 */
export default function InboxPage() {
  return (
    <Suspense fallback={null}>
      <InboxApp />
    </Suspense>
  );
}
