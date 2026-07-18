import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { requireAdminApi } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  if (!(await requireAdminApi())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const accountId = new URL(request.url).searchParams.get("accountId"); if (!accountId) return NextResponse.json({ error: "qr_unavailable" }, { status: 404 });
  const connection = await prisma.whatsAppConnection.findUnique({ where: { accountId } });
  if (!connection?.qrCode || !connection.qrExpiresAt || connection.qrExpiresAt <= new Date()) {
    return NextResponse.json({ error: "qr_unavailable" }, { status: 404 });
  }
  const image = await QRCode.toBuffer(connection.qrCode, { width: 280, margin: 1 });
  return new NextResponse(new Uint8Array(image), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
}
