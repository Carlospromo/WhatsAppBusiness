import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessAccount } from "@/lib/account";
import { messagesFromNewestPage, parseCursor } from "@/lib/inbox";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user=await getCurrentUser(); if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { id } = await params;
  const conversation = await prisma.conversation.findUnique({ where: { id }, include: { contact: { include: { addressBookContact: true } }, account: { select: { id: true, name: true, slug: true } } } });
  if (!conversation) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  if (!await canAccessAccount(user,conversation.accountId)) return NextResponse.json({error:"Prohibido"},{status:403});
  const cursor = parseCursor(request.nextUrl.searchParams.get("cursor"));
  const results = await prisma.message.findMany({ where: { conversationId: id, accountId: conversation.accountId }, orderBy: [{ sentAt: "desc" }, { id: "desc" }], take: 51, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
  return NextResponse.json({ conversation, ...messagesFromNewestPage(results) });
}
