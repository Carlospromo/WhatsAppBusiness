import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const CONFIRMATION = "BORRAR_AGENDA";

/** Clears only the address-book layer; messages and conversations remain intact. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Prohibido" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as { accountId?: unknown; confirmation?: unknown };
  const accountId = typeof body.accountId === "string" && /^[a-z0-9]{10,40}$/i.test(body.accountId) ? body.accountId : null;
  if (!accountId || body.confirmation !== CONFIRMATION) return NextResponse.json({ error: "Confirmación de borrado inválida" }, { status: 400 });

  const account = await prisma.whatsAppAccount.findUnique({ where: { id: accountId }, select: { id: true } });
  if (!account) return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });

  const result = await prisma.$transaction(async (transaction) => {
    const phones = await transaction.addressBookPhone.deleteMany({ where: { accountId } });
    const contacts = await transaction.addressBookContact.deleteMany({ where: { accountId } });
    const imports = await transaction.contactImport.deleteMany({ where: { accountId } });
    await transaction.auditLog.create({
      data: {
        userId: user.id,
        accountId,
        action: "ADDRESS_BOOK_CLEARED",
        entity: "WhatsAppAccount",
        entityId: accountId,
        metadata: JSON.stringify({ contactsDeleted: contacts.count, phonesDeleted: phones.count, importsDeleted: imports.count }),
      },
    });
    return { contactsDeleted: contacts.count, phonesDeleted: phones.count, importsDeleted: imports.count };
  });

  return NextResponse.json({ ok: true, ...result });
}
