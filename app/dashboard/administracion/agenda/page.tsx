import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AgendaControls } from "./agenda-controls";

export default async function AdminAddressBookPage() {
  await requireRole("ADMIN"); const accounts = await prisma.whatsAppAccount.findMany({ select: { id: true, name: true, defaultPhoneCountry: true }, orderBy: { name: "asc" } });
  return <main className="mx-auto max-w-4xl p-6"><Link href="/dashboard/administracion" className="text-sm text-emerald-700">← Administración</Link><h1 className="mt-3 text-xl font-semibold">Agenda híbrida</h1><p className="mt-2 text-sm text-slate-600">Los contactos importados prevalecen sobre los datos recibidos desde WhatsApp.</p><nav className="mt-5 grid gap-3 sm:grid-cols-3"><Link className="rounded-lg border p-4 hover:bg-slate-50" href="/dashboard/administracion/agenda/importar">Importar archivo</Link><Link className="rounded-lg border p-4 hover:bg-slate-50" href="/dashboard/administracion/agenda/importaciones">Historial de importaciones</Link><Link className="rounded-lg border p-4 hover:bg-slate-50" href="/dashboard/agenda">Ver agenda</Link></nav><AgendaControls accounts={accounts}/></main>;
}
