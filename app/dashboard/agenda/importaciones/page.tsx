import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function AddressBookImportsPage() {
  await requireRole("ADMIN");
  const imports = await prisma.contactImport.findMany({ include: { account: { select: { name: true } }, createdBy: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
  return <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6"><Link href="/dashboard/agenda/manage" className="text-sm font-medium text-emerald-700">← Gestionar agenda</Link><h1 className="mt-3 text-2xl font-semibold tracking-tight">Importaciones</h1><div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">{imports.length ? imports.map((item) => <article className="flex flex-wrap justify-between gap-3 border-b border-slate-100 p-4 last:border-0" key={item.id}><div><strong className="text-slate-800">{item.safeFileName}</strong><p className="mt-1 text-sm text-slate-600">{item.account.name} · {item.createdBy.name} · {item.createdRows} creados · {item.updatedRows} actualizados</p></div><span className="h-fit rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{item.status}</span></article>) : <p className="p-6 text-sm text-slate-500">Todavía no hay importaciones.</p>}</div></main>;
}
