/**
 * Inbound message routing modes.
 *
 * Controls how an incoming WhatsApp message is handled when both the
 * Flows engine and the AI conversation system are available:
 *
 *  - ai_first     AI answers first; if it declines, a matching flow runs. (default)
 *  - flows_first  A matching flow runs first; if none consumes it, AI answers.
 *  - flows_only   Only flows run. AI is skipped entirely.
 *  - ai_only      Only AI runs. Flows are skipped entirely.
 *
 * In every mode, if neither AI nor flows handle the message, automations
 * still get their turn (unchanged behavior).
 */

import { prisma } from "@/lib/prisma";

export const INBOUND_ROUTING_MODES = [
  "ai_first",
  "flows_first",
  "flows_only",
  "ai_only",
] as const;

export type InboundRoutingMode = (typeof INBOUND_ROUTING_MODES)[number];

export const DEFAULT_INBOUND_ROUTING_MODE: InboundRoutingMode = "ai_first";

export function isInboundRoutingMode(v: unknown): v is InboundRoutingMode {
  return (
    typeof v === "string" &&
    (INBOUND_ROUTING_MODES as readonly string[]).includes(v)
  );
}

/**
 * Resolve the inbound routing mode for a user, reading the per-segment
 * AI settings row. Healthcare uses `AISettings` (keyed by clinicId);
 * every other segment uses `BusinessAISettings` (keyed by businessId).
 *
 * Falls back to the default when no settings row exists yet, so the
 * webhook never breaks on a freshly-created account.
 */
export async function getInboundRoutingMode(
  userId: string,
  segment: string,
): Promise<InboundRoutingMode> {
  try {
    if (segment === "healthcare") {
      const clinic = await prisma.clinic.findUnique({
        where: { userId },
        select: { aiSettings: { select: { inboundRoutingMode: true } } },
      });
      const mode = clinic?.aiSettings?.inboundRoutingMode;
      return isInboundRoutingMode(mode) ? mode : DEFAULT_INBOUND_ROUTING_MODE;
    }

    const business = await prisma.businessProfile.findUnique({
      where: { userId },
      select: { aiSettings: { select: { inboundRoutingMode: true } } },
    });
    const mode = business?.aiSettings?.inboundRoutingMode;
    return isInboundRoutingMode(mode) ? mode : DEFAULT_INBOUND_ROUTING_MODE;
  } catch {
    return DEFAULT_INBOUND_ROUTING_MODE;
  }
}
