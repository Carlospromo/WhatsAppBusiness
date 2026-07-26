import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { LogoutButton } from "./logout-button";

export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser(); const admin = user.role === "ADMIN";
  return <div className="min-h-screen bg-slate-50"><header className="border-b border-slate-200 bg-white px-4 py-3 sm:px-6"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3"><div><Link href="/dashboard" className="font-semibold">WhatsAppBusiness</Link><p className="text-xs text-slate-500">{user.name} · {user.role}</p></div><nav className="order-3 flex w-full gap-3 overflow-auto text-sm sm:order-2 sm:w-auto"><Link href="/dashboard">Bandeja</Link><Link href="/dashboard/agenda">Agenda</Link>{admin && <Link href="/dashboard/integracion">Vinculación</Link>}{admin && <Link href="/dashboard/administracion/cuentas">Cuentas</Link>}{admin && <Link href="/dashboard/administracion/usuarios">Usuarios</Link>}{admin && <Link href="/dashboard/administracion/auditoria">Auditoría</Link>}{admin && <Link href="/dashboard/administracion/estado">Estado</Link>}{admin && <Link href="/dashboard/administracion/agenda">Importaciones</Link>}</nav><LogoutButton /></div></header>{children}</div>;
}
