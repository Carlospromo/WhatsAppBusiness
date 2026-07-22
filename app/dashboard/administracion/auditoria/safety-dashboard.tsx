"use client";

import { useEffect, useState } from "react";
import type { AuditSafetyDashboard } from "@/lib/admin/audit-dashboard";

function Metric({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><dt className="text-sm text-slate-500">{label}</dt><dd className="mt-1 text-2xl font-semibold text-slate-900">{value}</dd>{hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}</div>;
}

function dateTime(value: string | null) {
  return value ? new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "Sin actividad registrada";
}

export function SafetyDashboard({ initial }: { initial: AuditSafetyDashboard }) {
  const [dashboard, setDashboard] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      const response = await fetch("/api/admin/audit/dashboard", { cache: "no-store" });
      if (response.ok) setDashboard(await response.json());
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return <section className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Cuadro de seguridad operativa</h2><p className="mt-1 max-w-3xl text-sm text-slate-600">Indicadores agregados de recepción, cola de salida, restricciones y recibos de lectura. No se muestran mensajes ni datos de contactos.</p></div><button type="button" onClick={() => void refresh()} disabled={refreshing} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium disabled:opacity-60">{refreshing ? "Actualizando…" : "Actualizar"}</button></div>
    <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Cuentas activas" value={dashboard.accounts.active} hint={`${dashboard.accounts.connected} conectadas`} /><Metric label="Recepción última hora" value={dashboard.inbound.importedLastHour} hint={`${dashboard.inbound.importedLast24Hours} en 24 h`} /><Metric label="Pendientes de envío" value={dashboard.outbound.pending} hint={`${dashboard.outbound.sending} en proceso`} /><Metric label="Envíos rechazados" value={dashboard.outbound.rejectedLast24Hours} hint="Últimas 24 h" /></dl>
    <div className="mt-4 grid gap-4 lg:grid-cols-2"><div className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-medium">Alertas</h3><ul className="mt-3 space-y-2">{dashboard.alerts.map((alert) => <li key={alert.title} className={alert.level === "warning" ? "rounded-lg bg-amber-50 p-3 text-sm text-amber-950" : "rounded-lg bg-slate-50 p-3 text-sm text-slate-700"}><p className="font-medium">{alert.title}</p><p className="mt-1">{alert.detail}</p></li>)}</ul></div><div className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-medium">Límites preventivos por cuenta</h3><dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-slate-500">Cola máxima</dt><dd className="font-medium">{dashboard.limits.maxPending}</dd></div><div><dt className="text-slate-500">Máximo por minuto</dt><dd className="font-medium">{dashboard.limits.maxPerMinute}</dd></div><div><dt className="text-slate-500">Intervalo mínimo</dt><dd className="font-medium">{dashboard.limits.minIntervalMs / 1_000} s</dd></div><div><dt className="text-slate-500">Nuevos chats / día</dt><dd className="font-medium">{dashboard.limits.maxNewChatsPerDay}</dd></div></dl><p className="mt-4 text-xs text-slate-500">Última entrada recibida: {dateTime(dashboard.inbound.lastImportedAt)}.</p></div></div>
    <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Cuentas restringidas" value={dashboard.accounts.restricted} /><Metric label="Envíos atascados" value={dashboard.outbound.stuckSending} hint="Más de 15 min" /><Metric label="Envíos cancelados" value={dashboard.outbound.canceledLast24Hours} hint="Sin reintento automático" /><Metric label="Lecturas fallidas" value={dashboard.readReceipts.failedLast24Hours} hint="Últimas 24 h" /></dl>
  </section>;
}
