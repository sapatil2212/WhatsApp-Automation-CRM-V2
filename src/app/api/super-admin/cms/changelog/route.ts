import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySuperAdminToken } from "@/lib/auth";

async function isAuthed(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get("super_admin_session")?.value ?? cookieStore.get("admin_session")?.value;
  return Boolean(token && verifySuperAdminToken(token));
}

// GET /api/super-admin/cms/changelog — List changelogs
export async function GET() {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const changelogs = await prisma.cmsChangelog.findMany({
      orderBy: { publishedAt: "desc" },
    });
    return NextResponse.json({ changelogs });
  } catch (err: any) {
    console.error("[CMS Changelog GET]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/super-admin/cms/changelog — Create changelog
export async function POST(req: NextRequest) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { version, title, tag = "feature", content, publishedAt, isPublished = true } = body;

    if (!version?.trim() || !title?.trim() || !content?.trim()) {
      return NextResponse.json({ error: "Version, title, and content are required" }, { status: 400 });
    }

    const changelog = await prisma.cmsChangelog.create({
      data: {
        version: version.trim(),
        title: title.trim(),
        tag,
        content: content.trim(),
        publishedAt: publishedAt ? new Date(publishedAt) : new Date(),
        isPublished: Boolean(isPublished),
      },
    });

    return NextResponse.json({ changelog }, { status: 201 });
  } catch (err: any) {
    console.error("[CMS Changelog POST]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT /api/super-admin/cms/changelog — Update changelog
export async function PUT(req: NextRequest) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { id, ...data } = body;

    if (!id) {
      return NextResponse.json({ error: "Changelog ID required" }, { status: 400 });
    }

    if (data.publishedAt) data.publishedAt = new Date(data.publishedAt);

    const changelog = await prisma.cmsChangelog.update({
      where: { id },
      data,
    });

    return NextResponse.json({ changelog });
  } catch (err: any) {
    console.error("[CMS Changelog PUT]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/super-admin/cms/changelog — Delete changelog
export async function DELETE(req: NextRequest) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Changelog ID required" }, { status: 400 });
    }

    await prisma.cmsChangelog.delete({
      where: { id },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[CMS Changelog DELETE]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
