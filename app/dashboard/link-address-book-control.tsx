"use client";
import { useState } from "react";

export function LinkAddressBookControl({ contactId, contacts }: { contactId: string; contacts: { id: string; displayName: string }[] }) {
  const [selected, setSelected] = useState(""); const [status, setStatus] = useState("");
  async function link() { if (!selected) return; setStatus("Enlazando…"); const response = await fetch(`/api/address-book/contacts/${contactId}/link`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ addressBookContactId: selected }) }); const data = await response.json().catch(() => ({})); setStatus(response.ok ? "Contacto enlazado. Recarga la conversación para ver los datos de agenda." : data.error || "No se pudo enlazar."); }
  if (!contacts.length) return null;
  return <div className="mt-2 flex flex-wrap items-center gap-2"><select value={selected} onChange={(event) => setSelected(event.target.value)} className="rounded border p-1 text-xs"><option value="">Enlazar con agenda…</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.displayName}</option>)}</select><button type="button" onClick={link} disabled={!selected} className="rounded border border-emerald-700 px-2 py-1 text-xs text-emerald-700 disabled:opacity-50">Enlazar</button><span aria-live="polite" className="text-xs text-slate-500">{status}</span></div>;
}
