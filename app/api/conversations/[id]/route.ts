import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessAccount } from "@/lib/account";
import { messagesFromNewestPage, parseCursor } from "@/lib/inbox";
import { visibleConversation } from "@/lib/conversation-identity";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user=await getCurrentUser(); if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { id } = await params;
  const conversation = await prisma.conversation.findUnique({
    where: { id },
    select: {
      id: true,
      accountId: true,
      jid: true,
      type: true,
      lastMessageAt: true,
      lastMessagePreview: true,
      unreadCount: true,
      updatedAt: true,
      contact: { select: { id: true, displayName: true, pushName: true, phone: true, profilePictureUpdatedAt: true, addressBookContact: { select: { displayName: true, origin: true } } } },
      account: { select: { id: true, name: true, slug: true } },
    },
  });
  if (!conversation) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  if (!await canAccessAccount(user,conversation.accountId)) return NextResponse.json({error:"Prohibido"},{status:403});
  const cursor = parseCursor(request.nextUrl.searchParams.get("cursor"));
  const results = await prisma.message.findMany({ where: { conversationId: id, accountId: conversation.accountId }, orderBy: [{ sentAt: "desc" }, { id: "desc" }], take: 51, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: { mediaAttachments: { select: { id: true, kind: true, status: true, mimeType: true, sizeBytes: true, width: true, height: true, durationSeconds: true } } } });
  const page = messagesFromNewestPage(results);

  // Earlier versions updated the conversation preview before message persistence
  // failed. The original full history cannot be reconstructed, but its latest
  // preview remains available until new, correctly persisted messages arrive.
  const messages = !cursor && page.messages.length === 0 && conversation.lastMessagePreview
    ? [{
      id: `legacy-preview-${conversation.id}`,
      // Its historical direction was not stored. Keep the fallback stable while
      // the user reads it; all new messages include their real direction.
      direction: "INBOUND",
      body: conversation.lastMessagePreview,
      messageType: "legacy-preview",
      sentAt: conversation.lastMessageAt ?? conversation.updatedAt,
    }]
    : page.messages;
  return NextResponse.json({ conversation: visibleConversation(conversation), messages, nextCursor: page.nextCursor });
}
