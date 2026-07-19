import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ManualAddressBookContactForm } from "./manual-contact-form";

export default async function NewAddressBookContactPage() {
  await requireRole("ADMIN");
  const accounts = await prisma.whatsAppAccount.findMany({ where: { isActive: true }, select: { id: true, name: true, defaultPhoneCountry: true }, orderBy: { name: "asc" } });
  return <main className="mx-auto max-w-3xl p-6"><Link href="/dashboard/administracion/agenda" className="text-sm text-emerald-700">← Agenda híbrida</Link><h1 className="mt-3 text-xl font-semibold">Añadir contacto</h1><p className="mt-2 text-sm text-slate-600">Crea un contacto individual para una cuenta. Sus datos prevalecerán sobre los datos sincronizados desde WhatsApp.</p><ManualAddressBookContactForm accounts={accounts} /></main>;
}
