import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AddressBookImportForm } from "./import-form";

export default async function ImportAddressBookPage() {
  await requireRole("ADMIN"); const accounts = await prisma.whatsAppAccount.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return <main className="mx-auto max-w-3xl p-6"><h1 className="text-xl font-semibold">Importar agenda</h1><p className="mt-2 text-sm text-slate-600">Admite CSV UTF-8 y Excel XLSX. El fichero se analiza y no se conserva.</p><AddressBookImportForm accounts={accounts}/></main>;
}
