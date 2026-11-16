import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyAccessToken } from "@/lib/auth";

// GET /api/announcements — Returns active system announcements for tenants
export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("access_token")?.value;
    const session = token ? verifyAccessToken(token) : null;

    let user: { id: string; selectedPlan: string | null; isVerified: boolean } | null = null;
    if (session?.userId) {
      user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { id: true, selectedPlan: true, isVerified: true },
      });
    }

    const now = new Date();

    const announcements = await prisma.cmsAnnouncement.findMany({
      where: {
        isActive: true,
        OR: [
          { startDate: null },
          { startDate: { lte: now } },
        ],
        AND: [
          {
            OR: [
              { endDate: null },
              { endDate: { gte: now } },
            ],
          },
        ],
      },
      orderBy: [
        { priority: "desc" },
        { createdAt: "desc" },
      ],
      take: 5,
    });

    // If user is logged in, optionally filter by user's plan or verification status
    const filtered = announcements.filter((a) => {
      if (a.targetPlan !== "all" && user?.selectedPlan && a.targetPlan !== user.selectedPlan) {
        return false;
      }
      if (a.targetAudience === "verified_only" && !user?.isVerified) {
        return false;
      }
      if (a.targetAudience === "unverified_only" && user?.isVerified) {
        return false;
      }
      return true;
    });

    return NextResponse.json({ announcements: filtered });
  } catch (err: any) {
    console.error("[Active Announcements GET]", err);
    return NextResponse.json({ announcements: [] });
  }
}
