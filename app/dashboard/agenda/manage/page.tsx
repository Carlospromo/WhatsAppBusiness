import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AgendaControls } from "../../administracion/agenda/agenda-controls";

export default async function ManageAddressBookPage() {
  await requireRole("ADMIN");
  const accounts = await prisma.whatsAppAccount.findMany({ select: { id: true, name: true, defaultPhoneCountry: true }, orderBy: { name: "asc" } });
  return <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6"><Link href="/dashboard/agenda" className="text-sm font-medium text-emerald-700">← Agenda</Link><h1 className="mt-3 text-2xl font-semibold tracking-tight">Gestionar agenda</h1><p className="mt-2 text-sm text-slate-600">Importa, reconcilia identidades técnicas y configura la normalización por cuenta.</p><nav className="mt-5 grid gap-3 sm:grid-cols-3"><Link className="rounded-xl border border-slate-200 bg-white p-4 font-medium hover:border-emerald-300" href="/dashboard/agenda/nuevo">Añadir contacto</Link><Link className="rounded-xl border border-slate-200 bg-white p-4 font-medium hover:border-emerald-300" href="/dashboard/agenda/importar">Importar archivo</Link><Link className="rounded-xl border border-slate-200 bg-white p-4 font-medium hover:border-emerald-300" href="/dashboard/agenda/importaciones">Ver importaciones</Link></nav><AgendaControls accounts={accounts}/></main>;
}
