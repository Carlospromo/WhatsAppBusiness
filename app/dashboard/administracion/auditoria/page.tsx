import { requireRole } from "@/lib/auth";
import { getAuditSafetyDashboard } from "@/lib/admin/audit-dashboard";
import { prisma } from "@/lib/prisma";
import { SafetyDashboard } from "./safety-dashboard";

export default async function AuditPage() {
  await requireRole("ADMIN");
  const [dashboard, logs] = await Promise.all([
    getAuditSafetyDashboard(),
    prisma.auditLog.findMany({ include: { user: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  return <main className="mx-auto max-w-6xl p-4 sm:p-6"><h1 className="text-xl font-semibold">Auditoría</h1><SafetyDashboard initial={dashboard} /><section className="mt-6"><h2 className="text-lg font-semibold">Eventos recientes</h2><div className="mt-3 rounded-xl border bg-white">{logs.length ? logs.map((log) => <div className="border-b p-3 text-sm last:border-0" key={log.id}><strong>{log.action}</strong> · {log.entity} · {log.user?.name || "Sistema"}<time className="ml-2 text-slate-500">{log.createdAt.toLocaleString("es-ES")}</time></div>) : <p className="p-4 text-slate-500">No hay eventos.</p>}</div></section></main>;
}
