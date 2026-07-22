import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessAccount } from "@/lib/account";
import { validNote } from "@/lib/collaboration";
import { prisma } from "@/lib/prisma";

async function noteWithAccount(id: string) {
  return prisma.conversationNote.findUnique({
    where: { id },
    include: { conversation: { select: { accountId: true } } },
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;
  const note = await noteWithAccount(id);
  if (!note || !await canAccessAccount(user, note.conversation.accountId)) {
    return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  }
  if (user.role !== "ADMIN" && note.authorId !== user.id) {
    return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  }

  const body = validNote((await request.json().catch(() => ({}))).body);
  if (!body) return NextResponse.json({ error: "Nota inválida" }, { status: 400 });

  const updated = await prisma.conversationNote.update({ where: { id }, data: { body } });
  await prisma.auditLog.create({
    data: { accountId: note.conversation.accountId, userId: user.id, action: "NOTE_UPDATED", entity: "ConversationNote", entityId: id },
  });
  return NextResponse.json(updated);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Prohibido" }, { status: 403 });

  const { id } = await params;
  const note = await noteWithAccount(id);
  if (!note || !await canAccessAccount(user, note.conversation.accountId)) {
    return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  }

  await prisma.conversationNote.delete({ where: { id } });
  await prisma.auditLog.create({
    data: { accountId: note.conversation.accountId, userId: user.id, action: "NOTE_DELETED", entity: "ConversationNote", entityId: id },
  });
  return NextResponse.json({ ok: true });
}
