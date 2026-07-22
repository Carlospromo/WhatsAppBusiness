import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { conversationForUser } from "@/lib/account";
import { prisma } from "@/lib/prisma";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (user.role === "VIEWER") return NextResponse.json({ error: "Prohibido" }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const targetId = body.userId === null ? null : typeof body.userId === "string" ? body.userId : undefined;
  if (targetId === undefined) return NextResponse.json({ error: "Asignación inválida" }, { status: 400 });

  const existing = await conversationForUser(user, id);
  if (!existing) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  if (user.role === "AGENT" && !((targetId === user.id) || (!targetId && existing.assignedToId === user.id))) {
    return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  }

  if (targetId) {
    const target = await prisma.user.findFirst({
      where: {
        id: targetId,
        isActive: true,
        OR: [
          { role: "ADMIN" },
          { role: "AGENT", accountMemberships: { some: { accountId: existing.accountId } } },
        ],
      },
      select: { id: true },
    });
    if (!target) return NextResponse.json({ error: "Usuario inválido" }, { status: 400 });
  }

  const conversation = await prisma.conversation.update({
    where: { id },
    data: { assignedToId: targetId, assignedAt: targetId ? new Date() : null },
    include: { assignedTo: { select: { id: true, name: true, role: true } } },
  });
  await prisma.auditLog.create({
    data: {
      accountId: existing.accountId,
      userId: user.id,
      action: targetId ? "CONVERSATION_ASSIGNED" : "CONVERSATION_UNASSIGNED",
      entity: "Conversation",
      entityId: id,
    },
  });
  return NextResponse.json(conversation);
}
