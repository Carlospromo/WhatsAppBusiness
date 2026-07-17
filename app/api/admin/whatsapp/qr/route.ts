import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { requireAdminApi } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  if (!(await requireAdminApi())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const connection = await prisma.whatsAppConnection.findUnique({ where: { id: "default" } });
  if (!connection?.qrCode || !connection.qrExpiresAt || connection.qrExpiresAt <= new Date()) {
    return NextResponse.json({ error: "qr_unavailable" }, { status: 404 });
  }
  const image = await QRCode.toBuffer(connection.qrCode, { width: 280, margin: 1 });
  return new NextResponse(new Uint8Array(image), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
}
