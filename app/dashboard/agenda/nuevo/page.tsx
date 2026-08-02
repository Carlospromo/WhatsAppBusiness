import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ManualAddressBookContactForm } from "../../administracion/agenda/nuevo/manual-contact-form";

export default async function NewAddressBookContactPage() {
  await requireRole("ADMIN");
  const accounts = await prisma.whatsAppAccount.findMany({ where: { isActive: true }, select: { id: true, name: true, defaultPhoneCountry: true }, orderBy: { name: "asc" } });
  return <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6"><Link href="/dashboard/agenda" className="text-sm font-medium text-emerald-700">← Agenda</Link><h1 className="mt-3 text-2xl font-semibold tracking-tight">Añadir contacto</h1><p className="mt-2 text-sm text-slate-600">El alta manual se combina con la agenda existente por teléfono normalizado. No sobrescribe contactos importados.</p><ManualAddressBookContactForm accounts={accounts}/></main>;
}
