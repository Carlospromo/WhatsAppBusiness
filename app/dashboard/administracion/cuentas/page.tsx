import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AccountManagement } from "./account-management";

export default async function AccountsPage() {
  await requireRole(Role.ADMIN);
  const [accounts, users] = await Promise.all([
    prisma.whatsAppAccount.findMany({ include: { connection: { select: { status: true, maskedPhone: true } }, memberships: { include: { user: { select: { id: true, name: true, email: true, role: true } } } } }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true, role: true }, orderBy: { name: "asc" } }),
  ]);
  return <main className="mx-auto max-w-5xl p-4 sm:p-6"><h1 className="text-xl font-semibold">Gestión de cuentas</h1><p className="mt-2 text-sm text-slate-600">Solo los administradores pueden crear cuentas, conceder accesos o desactivarlas. Desactivar conserva sus datos y sesión para recuperarla después.</p><AccountManagement accounts={accounts} users={users}/></main>;
}
