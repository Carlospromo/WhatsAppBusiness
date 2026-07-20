import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessAccount } from "@/lib/account";
import { normalizePhone } from "@/lib/address-book";
import { canSendMessages } from "@/lib/authorization";
import { createDirectConversationAndQueue, validateMessageBody } from "@/lib/inbox";
import { prisma } from "@/lib/prisma";
import { operationalLog, safeLogRef } from "@/lib/operational-log";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!canSendMessages(user.role)) return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  const payload = await request.json().catch(() => ({})) as { accountId?: unknown; phone?: unknown; body?: unknown };
  const accountId = typeof payload.accountId === "string" && /^[a-z0-9]{10,40}$/i.test(payload.accountId) ? payload.accountId : null;
  const body = validateMessageBody(payload.body);
  if (!accountId || !body) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  if (!await canAccessAccount(user, accountId)) return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  const account = await prisma.whatsAppAccount.findFirst({ where: { id: accountId, isActive: true }, select: { defaultPhoneCountry: true } });
  if (!account) return NextResponse.json({ error: "Cuenta no disponible" }, { status: 404 });
  const phone = normalizePhone(payload.phone, account.defaultPhoneCountry);
  if (!phone) return NextResponse.json({ error: "Número de teléfono inválido" }, { status: 400 });
  const created = await createDirectConversationAndQueue(accountId, user.id, phone, body);
  if (!created) return NextResponse.json({ error: "Número de teléfono inválido" }, { status: 400 });
  await prisma.auditLog.create({ data: { accountId, userId: user.id, action: "OUTBOUND_DIRECT_REQUESTED", entity: "OutboundMessageRequest", entityId: created.request.id } });
  operationalLog("outbound.queued", { account: safeLogRef(accountId), request: safeLogRef(created.request.id), source: "direct" });
  return NextResponse.json({ conversationId: created.conversation.id, requestId: created.request.id, status: created.request.status }, { status: 201 });
}
