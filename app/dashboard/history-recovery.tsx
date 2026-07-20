"use client";
import { useEffect, useState } from "react";

type Recovery = { status: string; pageCount: number; importedCount: number; duplicateCount: number; safeError: string | null } | null;
function day(value: Date) { return value.toISOString().slice(0, 10); }

export function HistoryRecovery({ conversationId, enabled }: { conversationId: string; enabled: boolean }) {
  const [from, setFrom] = useState(() => day(new Date(Date.now() - 7 * 86_400_000)));
  const [to, setTo] = useState(() => day(new Date(Date.now() - 86_400_000)));
  const [status, setStatus] = useState(""); const [recovery, setRecovery] = useState<Recovery>(null);
  useEffect(() => { const poll = async () => { const response = await fetch(`/api/conversations/${conversationId}/history-recovery`, { cache: "no-store" }); if (response.ok) setRecovery((await response.json()).request); }; void poll(); const timer = window.setInterval(() => void poll(), 4_000); return () => window.clearInterval(timer); }, [conversationId]);
  async function submit(event: React.FormEvent) { event.preventDefault(); setStatus("Solicitud enviada al worker…"); const response = await fetch(`/api/conversations/${conversationId}/history-recovery`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: `${from}T00:00:00.000Z`, to: `${to}T23:59:59.999Z` }) }); const data = await response.json().catch(() => ({})); setStatus(response.ok ? "Recuperación en curso. Solo se añadirán mensajes que no existan." : data.error || "No se pudo solicitar la recuperación."); }
  if (!enabled) return null;
  return <details className="ml-auto text-xs text-slate-600"><summary className="cursor-pointer rounded-lg border border-slate-200 px-2 py-1 hover:bg-slate-50">Recuperar historial reciente</summary><form onSubmit={submit} className="absolute right-3 z-20 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-lg"><p className="mb-2 text-xs text-slate-500">Consulta manual, por páginas y sin garantía de disponibilidad en WhatsApp. Necesita algún mensaje local posterior al inicio elegido.</p><label className="block">Desde<input required type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="mt-1 w-full rounded border p-1.5"/></label><label className="mt-2 block">Hasta<input required type="date" value={to} min={from} max={day(new Date())} onChange={(event) => setTo(event.target.value)} className="mt-1 w-full rounded border p-1.5"/></label><button className="mt-3 rounded bg-emerald-700 px-2 py-1.5 font-medium text-white">Recuperar</button><p aria-live="polite" className="mt-2">{status}</p>{recovery && <p className="mt-1 text-slate-500">{recovery.status}: {recovery.importedCount} añadidos · {recovery.duplicateCount} ya existentes{recovery.safeError ? ` · ${recovery.safeError}` : ""}</p>}</form></details>;
}
