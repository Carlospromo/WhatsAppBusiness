import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  if (!(await requireAdminApi())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const connection = await prisma.whatsAppConnection.findUnique({ where: { id: "default" } });
  return NextResponse.json({
    status: connection?.status ?? "DISCONNECTED",
    connected: connection?.status === "CONNECTED",
    hasQr: Boolean(connection?.qrCode && connection.qrExpiresAt && connection.qrExpiresAt > new Date()),
    maskedPhone: connection?.maskedPhone ?? null,
    updatedAt: connection?.updatedAt ?? null,
  });
}
