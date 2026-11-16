import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyAccessToken, rotateRefreshToken } from "@/lib/auth";
import { getBusinessSegment } from "@/lib/business/terminology";
import {
  DEFAULT_INBOUND_ROUTING_MODE,
  isInboundRoutingMode,
  type InboundRoutingMode,
} from "@/lib/inbound/routing";

/**
 * GET  /api/flows/routing  → { mode }
 * PUT  /api/flows/routing  { mode } → { mode }
 *
 * Reads/writes the per-business "inbound routing mode" that decides how
 * incoming WhatsApp messages are handled (AI vs Flows). Healthcare
 * businesses store it on AISettings (keyed by clinicId); every other
 * segment stores it on BusinessAISettings (keyed by businessId).
 *
 * The settings row is created during onboarding. If it doesn't exist
 * yet we create a minimal one so the toggle works before full AI setup.
 */

async function getAuthContext() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("accessToken")?.value;
  const refreshToken = cookieStore.get("refreshToken")?.value;

  let payload = accessToken ? verifyAccessToken(accessToken) : null;
  if (!payload && refreshToken) {
    const rotation = await rotateRefreshToken(refreshToken);
    if (rotation) payload = rotation.user;
  }
  if (!payload) return null;

  const profile = await prisma.profile.findUnique({
    where: { userId: payload.userId },
  });
  if (!profile?.tenantId) return null;

  return {
    userId: payload.userId,
    tenantId: profile.tenantId,
    segment: getBusinessSegment(profile.businessType),
  };
}

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let mode: InboundRoutingMode = DEFAULT_INBOUND_ROUTING_MODE;

  if (ctx.segment === "healthcare") {
    const clinic = await prisma.clinic.findUnique({
      where: { userId: ctx.userId },
      select: { aiSettings: { select: { inboundRoutingMode: true } } },
    });
    if (isInboundRoutingMode(clinic?.aiSettings?.inboundRoutingMode)) {
      mode = clinic!.aiSettings!.inboundRoutingMode as InboundRoutingMode;
    }
  } else {
    const business = await prisma.businessProfile.findUnique({
      where: { userId: ctx.userId },
      select: { aiSettings: { select: { inboundRoutingMode: true } } },
    });
    if (isInboundRoutingMode(business?.aiSettings?.inboundRoutingMode)) {
      mode = business!.aiSettings!.inboundRoutingMode as InboundRoutingMode;
    }
  }

  return NextResponse.json({ mode, segment: ctx.segment });
}

export async function PUT(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { mode?: string } | null;
  if (!body || !isInboundRoutingMode(body.mode)) {
    return NextResponse.json(
      { error: "Invalid mode. Expected one of ai_first, flows_first, flows_only, ai_only." },
      { status: 400 },
    );
  }
  const mode = body.mode;

  if (ctx.segment === "healthcare") {
    const clinic = await prisma.clinic.findUnique({
      where: { userId: ctx.userId },
      select: { id: true },
    });
    if (!clinic) {
      return NextResponse.json(
        { error: "Complete your business setup before configuring routing." },
        { status: 400 },
      );
    }
    await prisma.aISettings.upsert({
      where: { clinicId: clinic.id },
      create: { clinicId: clinic.id, inboundRoutingMode: mode },
      update: { inboundRoutingMode: mode },
    });
  } else {
    const business = await prisma.businessProfile.findUnique({
      where: { userId: ctx.userId },
      select: { id: true },
    });
    if (!business) {
      return NextResponse.json(
        { error: "Complete your business setup before configuring routing." },
        { status: 400 },
      );
    }
    await prisma.businessAISettings.upsert({
      where: { businessId: business.id },
      create: { businessId: business.id, inboundRoutingMode: mode },
      update: { inboundRoutingMode: mode },
    });
  }

  return NextResponse.json({ mode });
}
