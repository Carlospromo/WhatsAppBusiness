import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { IntegrationPanel } from "./integration-panel";

export default async function IntegrationPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  await requireRole(Role.ADMIN); const params = await searchParams;
  const accounts = await prisma.whatsAppAccount.findMany({ select: { id: true, name: true, isActive: true, connection: { select: { status: true, maskedPhone: true, qrCode: true, qrExpiresAt: true, updatedAt: true } } }, orderBy: { name: "asc" } });
  const account = accounts.find((item) => item.id === params.account) || accounts[0];
  if (!account) return <main className="mx-auto max-w-2xl p-6"><h1 className="text-2xl font-semibold">Vinculación de WhatsApp</h1><p className="mt-3 text-sm text-slate-600">Primero crea una cuenta desde Gestión de cuentas.</p><Link href="/dashboard/administracion/cuentas" className="mt-4 inline-block text-sm font-medium text-emerald-700">Ir a Gestión de cuentas</Link></main>;
  const hasQr = Boolean(account.connection?.qrCode && account.connection.qrExpiresAt && account.connection.qrExpiresAt > new Date());
  return <main className="mx-auto max-w-3xl p-4 sm:p-6"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-semibold">Vinculación de WhatsApp</h1><p className="mt-1 text-sm text-slate-600">Vincula cada número desde el navegador mediante un QR seguro.</p></div><Link href="/dashboard/administracion/cuentas" className="text-sm font-medium text-emerald-700">Gestión de cuentas</Link></div><nav className="mt-4 flex gap-3 overflow-auto text-sm">{accounts.map((item) => <Link key={item.id} href={`/dashboard/integracion?account=${item.id}`} className={item.id === account.id ? "font-semibold text-emerald-700" : "text-slate-500"}>{item.name}</Link>)}</nav><IntegrationPanel accountId={account.id} accountName={account.name} active={account.isActive} initial={{ status: account.connection?.status || "DISCONNECTED", maskedPhone: account.connection?.maskedPhone || null, hasQr, updatedAt: account.connection?.updatedAt?.toISOString() || null }}/></main>;
}
