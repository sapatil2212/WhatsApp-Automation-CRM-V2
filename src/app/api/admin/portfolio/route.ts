import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyAccessToken, rotateRefreshToken } from "@/lib/auth";

async function isAuthorized(): Promise<boolean> {
  // Check Access Token Cookie
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("accessToken")?.value;
    if (token) return true;
  } catch (err) {}

  // Check Super Admin Cookie
  try {
    const cookieStore = await cookies();
    return cookieStore.get("admin_session")?.value === "authenticated";
  } catch (err) {
    return false;
  }
}

async function getAuthContext() {
  try {
    const cookieStore = await cookies()
    let accessToken = cookieStore.get('accessToken')?.value
    const refreshToken = cookieStore.get('refreshToken')?.value

    let payload = accessToken ? verifyAccessToken(accessToken) : null

    if (!payload && refreshToken) {
      const rotation = await rotateRefreshToken(refreshToken)
      if (rotation) {
        payload = rotation.user
      }
    }

    if (!payload) {
      // Check if super admin is authenticated
      const isAdmin = cookieStore.get("admin_session")?.value === "authenticated";
      if (isAdmin) {
        // Fallback or find first user/tenant
        const firstUser = await prisma.user.findFirst({
          include: { profile: true }
        });
        if (firstUser && firstUser.profile?.tenantId) {
          return { userId: firstUser.id, tenantId: firstUser.profile.tenantId };
        }
      }
      return null;
    }

    const profile = await prisma.profile.findUnique({
      where: { userId: payload.userId }
    })
    if (!profile || !profile.tenantId) return null

    return { userId: payload.userId, tenantId: profile.tenantId }
  } catch (err) {
    return null
  }
}

function mapToSnakeCase(item: any) {
  if (!item) return null;
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    thumbnail_url: item.thumbnailUrl,
    metadata_tags: item.metadataTags || [],
    project_links: item.projectLinks || {},
    preview_media: item.previewMedia || [],
    created_at: item.createdAt.toISOString(),
    updated_at: item.updatedAt.toISOString(),
  };
}

// GET /api/admin/portfolio - Get all showcase items
export async function GET() {
  if (!(await isAuthorized())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const data = await prisma.portfolioItem.findMany({
      orderBy: { createdAt: "desc" }
    });

    const items = data.map(mapToSnakeCase);
    return NextResponse.json({ items, db_fallback: false });
  } catch (error: any) {
    console.error("GET portfolio error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch items" }, { status: 500 });
  }
}

// POST /api/admin/portfolio - Create a new showcase item
export async function POST(req: NextRequest) {
  const context = await getAuthContext()
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { title, description, thumbnail_url, metadata_tags, project_links, preview_media } = body;

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    const item = await prisma.portfolioItem.create({
      data: {
        title,
        description: description || null,
        thumbnailUrl: thumbnail_url || null,
        metadataTags: metadata_tags || [],
        projectLinks: project_links || {},
        previewMedia: preview_media || [],
        userId: context.userId,
        tenantId: context.tenantId
      }
    });

    return NextResponse.json({ item: mapToSnakeCase(item) });
  } catch (error: any) {
    console.error("POST portfolio error:", error);
    return NextResponse.json({ error: error.message || "Failed to create item" }, { status: 500 });
  }
}

// PUT /api/admin/portfolio - Update an existing showcase item
export async function PUT(req: NextRequest) {
  if (!(await isAuthorized())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { id, title, description, thumbnail_url, metadata_tags, project_links, preview_media } = body;

    if (!id || !title) {
      return NextResponse.json({ error: "ID and Title are required" }, { status: 400 });
    }

    const item = await prisma.portfolioItem.update({
      where: { id },
      data: {
        title,
        description: description || null,
        thumbnailUrl: thumbnail_url || null,
        metadataTags: metadata_tags || [],
        projectLinks: project_links || {},
        previewMedia: preview_media || []
      }
    });

    return NextResponse.json({ item: mapToSnakeCase(item) });
  } catch (error: any) {
    console.error("PUT portfolio error:", error);
    return NextResponse.json({ error: error.message || "Failed to update item" }, { status: 500 });
  }
}

// DELETE /api/admin/portfolio - Delete a showcase item
export async function DELETE(req: NextRequest) {
  if (!(await isAuthorized())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID parameter is required" }, { status: 400 });
    }

    await prisma.portfolioItem.delete({
      where: { id }
    });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("DELETE portfolio error:", error);
    return NextResponse.json({ error: error.message || "Failed to delete item" }, { status: 500 });
  }
}
