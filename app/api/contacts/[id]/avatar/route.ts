import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessAccount } from "@/lib/account";
import { prisma } from "@/lib/prisma";
import { isTrustedProfilePictureUrl } from "@/lib/whatsapp/profile-picture-url";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;
  const contact = await prisma.contact.findUnique({ where: { id }, select: { accountId: true, profilePictureUrl: true } });
  if (!contact) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  if (!await canAccessAccount(user, contact.accountId)) return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  const profilePictureUrl = contact.profilePictureUrl;
  if (!profilePictureUrl || !isTrustedProfilePictureUrl(profilePictureUrl)) return new NextResponse(null, { status: 404 });

  try {
    const image = await fetch(profilePictureUrl, { signal: AbortSignal.timeout(8_000), cache: "no-store" });
    const contentType = image.headers.get("content-type");
    if (!image.ok || !image.body || !contentType?.startsWith("image/")) return new NextResponse(null, { status: 404 });
    return new NextResponse(image.body, { headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=300" } });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
