import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessAccount } from "@/lib/account";
import { prisma } from "@/lib/prisma";

export default async function AddressBookContactPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(); if (!user) return null; const { id } = await params;
  const contact = await prisma.addressBookContact.findUnique({ where: { id }, include: { account: { select: { name: true } }, phones: true, whatsappContacts: { include: { conversations: { select: { id: true }, take: 1 } } } } });
  if (!contact || !await canAccessAccount(user, contact.accountId)) notFound();
  return <main className="mx-auto max-w-3xl p-6"><Link href="/dashboard/agenda" className="text-sm text-emerald-700">← Agenda</Link><h1 className="mt-3 text-xl font-semibold">{contact.displayName}{contact.lastName ? ` ${contact.lastName}` : ""}</h1><p className="mt-1 text-sm text-slate-500">{contact.account.name} · {contact.origin === "EXTERNAL" ? "Contacto externo" : "Contacto verificado"}</p><section className="mt-5 rounded-xl border p-4"><h2 className="font-medium">Datos de agenda</h2><dl className="mt-3 space-y-2 text-sm text-slate-600"><div><dt className="inline font-medium text-slate-800">Teléfonos: </dt><dd className="inline">{contact.phones.map((phone) => phone.normalizedPhone).join(", ") || "No disponible"}</dd></div>{contact.email && <div><dt className="inline font-medium text-slate-800">Email: </dt><dd className="inline">{contact.email}</dd></div>}{contact.company && <div><dt className="inline font-medium text-slate-800">Empresa: </dt><dd className="inline">{contact.company}</dd></div>}</dl></section>{contact.whatsappContacts[0]?.conversations[0] && <Link href={`/dashboard?selected=${contact.whatsappContacts[0].conversations[0].id}`} className="mt-5 inline-block text-sm font-medium text-emerald-700">Abrir conversación</Link>}</main>;
}
