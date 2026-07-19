import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessAccount } from "@/lib/account";
import { signedMediaReadUrl } from "@/lib/media-storage";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { id } = await params;
  if (!/^[a-z0-9]+$/i.test(id)) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  const attachment = await prisma.mediaAttachment.findUnique({ where: { id }, select: { accountId: true, objectKey: true, status: true } });
  if (!attachment) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  if (!await canAccessAccount(user, attachment.accountId)) return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  if (attachment.status !== "STORED") return NextResponse.json({ error: "Archivo no disponible" }, { status: 404 });
  const url = await signedMediaReadUrl(attachment.objectKey);
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
