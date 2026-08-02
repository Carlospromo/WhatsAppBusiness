import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AddressBookImportForm } from "../../administracion/agenda/importar/import-form";

export default async function ImportAddressBookPage() {
  await requireRole("ADMIN");
  const accounts = await prisma.whatsAppAccount.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6"><Link href="/dashboard/agenda" className="text-sm font-medium text-emerald-700">← Agenda</Link><h1 className="mt-3 text-2xl font-semibold tracking-tight">Importar contactos</h1><p className="mt-2 text-sm text-slate-600">CSV UTF-8 o XLSX. Se analiza una vista previa y el archivo no se conserva.</p><AddressBookImportForm accounts={accounts}/></main>;
}
