import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
export async function GET(request: NextRequest) {
  if (!await getCurrentUser()) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const q = request.nextUrl.searchParams.get("q")?.trim().slice(0, 100);
  const contacts = await prisma.contact.findMany({ where: q ? { OR: [{ displayName: { contains: q } }, { pushName: { contains: q } }, { phone: { contains: q } }] } : {}, include: { conversations: { select: { id: true }, take: 1 } }, orderBy: { syncedAt: "desc" }, take: 31 });
  return NextResponse.json({ rows: contacts.slice(0, 30), nextCursor: contacts.length > 30 ? contacts[30].id : null });
}
