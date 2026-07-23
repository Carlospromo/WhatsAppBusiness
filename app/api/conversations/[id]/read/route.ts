import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canManageMessages } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { canAccessAccount } from "@/lib/account";
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(); if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!canManageMessages(user.role)) return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  const { id } = await params;
  const conversation = await prisma.conversation.findUnique({ where: { id }, select: { accountId: true } });
  if (!conversation) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  if (!await canAccessAccount(user, conversation.accountId)) return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  let result: { requestCreated: boolean };
  try {
    result = await prisma.$transaction(async (transaction) => {
      const unreadMessages = await transaction.message.findMany({
        where: { conversationId: id, direction: "INBOUND", isRead: false },
        select: { id: true },
      });
      await transaction.message.updateMany({ where: { conversationId: id, direction: "INBOUND", isRead: false }, data: { isRead: true } });
      await transaction.conversation.update({ where: { id }, data: { unreadCount: 0 } });

      const messageIds = unreadMessages.map((message) => message.id);
      if (!messageIds.length) return { requestCreated: false };

      const request = await transaction.readReceiptRequest.create({
        data: {
          accountId: conversation.accountId,
          conversationId: id,
          requestedById: user.id,
          messages: { create: messageIds.map((messageId) => ({ messageId })) },
        },
        select: { id: true },
      });
      await transaction.auditLog.create({ data: { accountId: conversation.accountId, userId: user.id, action: "WHATSAPP_READ_RECEIPT_REQUESTED", entity: "ReadReceiptRequest", entityId: request.id } });
      return { requestCreated: true };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    // A simultaneous open can race on the unique message-to-receipt relation.
    // The other request is already durable, so the local read action remains
    // successful without creating a duplicate WhatsApp receipt.
    if ((error as { code?: string }).code === "P2002" || (error as { code?: string }).code === "P2034") result = { requestCreated: false };
    else throw error;
  }
  return NextResponse.json({ ok: true, requestCreated: result.requestCreated });
}
