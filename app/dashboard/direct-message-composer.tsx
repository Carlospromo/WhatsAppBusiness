"use client";

import { useState } from "react";

export function DirectMessageComposer({ accountId, accountName, enabled, onQueued, onClose }: { accountId: string; accountName: string; enabled: boolean; onQueued: (conversationId: string) => void; onClose: () => void }) {
  const [phone, setPhone] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("");

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!enabled || !phone.trim() || !body.trim()) return;
    setStatus("Preparando el mensaje…");
    const response = await fetch("/api/conversations/direct", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, phone, body }) });
    const data = await response.json().catch(() => null) as { conversationId?: string; error?: string } | null;
    if (!response.ok || !data?.conversationId) {
      setStatus(data?.error || "No se pudo preparar el mensaje.");
      return;
    }
    setStatus("Mensaje añadido a la cola de envío.");
    onQueued(data.conversationId);
  }

  return <div className="fixed inset-0 z-50 flex items-end bg-slate-950/30 p-3 sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-label="Nuevo mensaje">
    <form onSubmit={send} className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
      <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold text-slate-900">Nuevo mensaje</h2><p className="mt-1 text-sm text-slate-500">Cuenta: {accountName}</p></div><button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100">Cerrar</button></div>
      <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Para iniciar una conversación nueva, el número debe pertenecer a un contacto verificado de la agenda importada o creado manualmente. Las respuestas a conversaciones existentes siguen disponibles.</p>
      <label className="mt-5 block text-sm font-medium text-slate-700" htmlFor="direct-phone">Número de teléfono</label>
      <input id="direct-phone" value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" autoComplete="tel" maxLength={64} placeholder="Ej.: +34 600 000 000" className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100" />
      <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="direct-body">Mensaje</label>
      <textarea id="direct-body" value={body} onChange={(event) => setBody(event.target.value)} maxLength={2000} className="mt-1 min-h-28 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100" placeholder="Escribe un mensaje…" />
      <p aria-live="polite" className="mt-2 min-h-5 text-xs text-slate-500">{status}</p>
      <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancelar</button><button type="submit" disabled={!enabled || !phone.trim() || !body.trim()} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">Enviar</button></div>
      {!enabled && <p className="mt-3 text-xs text-amber-700">WhatsApp debe estar conectado para iniciar una conversación nueva.</p>}
    </form>
  </div>;
}
