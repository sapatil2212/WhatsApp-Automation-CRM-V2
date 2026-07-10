import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json();
    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        paymentProofAttached: true,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[payment-proof POST]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
