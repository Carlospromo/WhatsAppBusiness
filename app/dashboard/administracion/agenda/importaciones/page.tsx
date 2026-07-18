import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function AddressBookImportsPage() {
  await requireRole("ADMIN"); const imports = await prisma.contactImport.findMany({ include: { account: { select: { name: true } }, createdBy: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 50 });
  return <main className="mx-auto max-w-4xl p-6"><Link href="/dashboard/administracion/agenda" className="text-sm text-emerald-700">← Agenda híbrida</Link><h1 className="mt-3 text-xl font-semibold">Importaciones</h1><div className="mt-5 rounded-xl border">{imports.length ? imports.map((item) => <article className="border-b p-4 last:border-0" key={item.id}><div className="flex justify-between gap-3"><strong>{item.safeFileName}</strong><span className="text-sm text-slate-500">{item.status}</span></div><p className="mt-1 text-sm text-slate-600">{item.account.name} · {item.createdBy.name} · {item.createdRows} creados · {item.updatedRows} actualizados</p></article>) : <p className="p-4 text-sm text-slate-500">Todavía no hay importaciones.</p>}</div></main>;
}
