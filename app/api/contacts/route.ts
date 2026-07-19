import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { accountsForUser, canAccessAccount } from "@/lib/account";
export async function GET(request: NextRequest) {
  const user=await getCurrentUser(); if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const accountId=request.nextUrl.searchParams.get("accountId")||undefined; if(accountId&&!await canAccessAccount(user,accountId))return NextResponse.json({error:"Prohibido"},{status:403}); const accounts=await accountsForUser(user);
  const q = request.nextUrl.searchParams.get("q")?.trim().slice(0, 100);
  const contacts = await prisma.contact.findMany({ where: {accountId:accountId??{in:accounts.map(a=>a.id)},...(q ? { OR: [{ displayName: { contains: q } }, { pushName: { contains: q } }, { phone: { contains: q } }] } : {})}, select: { id: true, accountId: true, displayName: true, pushName: true, phone: true, profilePictureUpdatedAt: true, syncedAt: true, conversations: { select: { id: true }, take: 1 } }, orderBy: { syncedAt: "desc" }, take: 31 });
  return NextResponse.json({ rows: contacts.slice(0, 30), nextCursor: contacts.length > 30 ? contacts[30].id : null });
}
