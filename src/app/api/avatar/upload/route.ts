import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import { verifyAccessToken, rotateRefreshToken } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate user from session cookies
    const cookieStore = await cookies();
    let accessToken = cookieStore.get("accessToken")?.value;
    const refreshToken = cookieStore.get("refreshToken")?.value;

    let payload = accessToken ? verifyAccessToken(accessToken) : null;

    if (!payload && refreshToken) {
      const rotation = await rotateRefreshToken(refreshToken);
      if (rotation) {
        payload = rotation.user;
      }
    }

    if (!payload) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Parse file from request form data
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // 3. Load Cloudinary Credentials
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      return NextResponse.json(
        { error: "Cloudinary credentials are not fully configured on the server" },
        { status: 500 }
      );
    }

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Generate unique signature params
    const timestamp = Math.round(Date.now() / 1000).toString();
    const folder = "avatars";

    const paramsToSign = {
      folder,
      timestamp,
    };

    // Sort parameters alphabetically
    const sortedKeys = Object.keys(paramsToSign).sort() as Array<keyof typeof paramsToSign>;
    const signatureString = sortedKeys.map(key => `${key}=${paramsToSign[key]}`).join("&") + apiSecret;
    const signature = crypto.createHash("sha1").update(signatureString).digest("hex");

    // Construct form data for Cloudinary
    const cloudinaryForm = new FormData();
    const blob = new Blob([buffer], { type: file.type });
    cloudinaryForm.append("file", blob, file.name);
    cloudinaryForm.append("api_key", apiKey);
    cloudinaryForm.append("timestamp", timestamp);
    cloudinaryForm.append("folder", folder);
    cloudinaryForm.append("signature", signature);

    // Post directly to Cloudinary upload URL
    const cloudinaryResponse = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      {
        method: "POST",
        body: cloudinaryForm,
      }
    );

    if (!cloudinaryResponse.ok) {
      const errorText = await cloudinaryResponse.text();
      return NextResponse.json(
        { error: `Cloudinary response error: ${errorText}` },
        { status: cloudinaryResponse.status }
      );
    }

    const data = await cloudinaryResponse.json();
    return NextResponse.json({
      url: data.secure_url,
      public_id: data.public_id,
    });
  } catch (error: any) {
    console.error("Cloudinary avatar upload proxy error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to upload file to Cloudinary" },
      { status: 500 }
    );
  }
}
