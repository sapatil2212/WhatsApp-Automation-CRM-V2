import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySuperAdminToken } from "@/lib/auth";

async function isAuthed(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get("super_admin_session")?.value ?? cookieStore.get("admin_session")?.value;
  return Boolean(token && verifySuperAdminToken(token));
}

// GET /api/super-admin/cms/articles — List articles
export async function GET() {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const articles = await prisma.cmsArticle.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ articles });
  } catch (err: any) {
    console.error("[CMS Articles GET]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/super-admin/cms/articles — Create article
export async function POST(req: NextRequest) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { title, slug, category = "general", excerpt, content, status = "published", author = "ChatNexGen Team" } = body;

    if (!title?.trim() || !content?.trim()) {
      return NextResponse.json({ error: "Title and content are required" }, { status: 400 });
    }

    const generatedSlug = slug?.trim()
      ? slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")
      : title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now().toString(36);

    const article = await prisma.cmsArticle.create({
      data: {
        title: title.trim(),
        slug: generatedSlug,
        category,
        excerpt: excerpt?.trim() || null,
        content: content.trim(),
        status,
        author: author.trim(),
      },
    });

    return NextResponse.json({ article }, { status: 201 });
  } catch (err: any) {
    console.error("[CMS Articles POST]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT /api/super-admin/cms/articles — Update article
export async function PUT(req: NextRequest) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { id, ...data } = body;

    if (!id) {
      return NextResponse.json({ error: "Article ID required" }, { status: 400 });
    }

    const article = await prisma.cmsArticle.update({
      where: { id },
      data,
    });

    return NextResponse.json({ article });
  } catch (err: any) {
    console.error("[CMS Articles PUT]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/super-admin/cms/articles — Delete article
export async function DELETE(req: NextRequest) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Article ID required" }, { status: 400 });
    }

    await prisma.cmsArticle.delete({
      where: { id },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[CMS Articles DELETE]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
