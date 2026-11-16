import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySuperAdminToken } from "@/lib/auth";

async function isAuthed(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get("super_admin_session")?.value ?? cookieStore.get("admin_session")?.value;
  return Boolean(token && verifySuperAdminToken(token));
}

// GET /api/super-admin/cms/announcements — List all announcements
export async function GET() {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const announcements = await prisma.cmsAnnouncement.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ announcements });
  } catch (err: any) {
    console.error("[CMS Announcements GET]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/super-admin/cms/announcements — Create announcement
export async function POST(req: NextRequest) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      title,
      content,
      type = "info",
      priority = "normal",
      targetPlan = "all",
      targetAudience = "all",
      isActive = true,
      isDismissible = true,
      actionLabel,
      actionUrl,
      startDate,
      endDate,
    } = body;

    if (!title?.trim() || !content?.trim()) {
      return NextResponse.json({ error: "Title and content are required" }, { status: 400 });
    }

    const announcement = await prisma.cmsAnnouncement.create({
      data: {
        title: title.trim(),
        content: content.trim(),
        type,
        priority,
        targetPlan,
        targetAudience,
        isActive: Boolean(isActive),
        isDismissible: Boolean(isDismissible),
        actionLabel: actionLabel?.trim() || null,
        actionUrl: actionUrl?.trim() || null,
        startDate: startDate ? new Date(startDate) : new Date(),
        endDate: endDate ? new Date(endDate) : null,
      },
    });

    return NextResponse.json({ announcement }, { status: 201 });
  } catch (err: any) {
    console.error("[CMS Announcements POST]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT /api/super-admin/cms/announcements — Update announcement
export async function PUT(req: NextRequest) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { id, ...data } = body;

    if (!id) {
      return NextResponse.json({ error: "Announcement ID required" }, { status: 400 });
    }

    if (data.startDate) data.startDate = new Date(data.startDate);
    if (data.endDate !== undefined) data.endDate = data.endDate ? new Date(data.endDate) : null;

    const announcement = await prisma.cmsAnnouncement.update({
      where: { id },
      data,
    });

    return NextResponse.json({ announcement });
  } catch (err: any) {
    console.error("[CMS Announcements PUT]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/super-admin/cms/announcements — Delete announcement
export async function DELETE(req: NextRequest) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Announcement ID required" }, { status: 400 });
    }

    await prisma.cmsAnnouncement.delete({
      where: { id },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[CMS Announcements DELETE]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
