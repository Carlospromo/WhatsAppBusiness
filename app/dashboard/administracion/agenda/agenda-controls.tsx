"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AgendaControls({ accounts }: { accounts: { id: string; name: string; defaultPhoneCountry: string }[] }) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id || "");
  const [country, setCountry] = useState(accounts[0]?.defaultPhoneCountry || "ES");
  const [status, setStatus] = useState("");

  function changeAccount(id: string) {
    setAccountId(id);
    setCountry(accounts.find((account) => account.id === id)?.defaultPhoneCountry || "ES");
  }

  async function reconcile() {
    if (!accountId) return;
    setStatus("Reconciliando contactos…");
    const response = await fetch("/api/admin/address-book/reconcile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId }) });
    const data = await response.json().catch(() => ({}));
    setStatus(response.ok ? `Proceso terminado: ${data.created} creados y ${data.linked} enlazados.` : data.error || "No se pudo reconciliar.");
  }

  async function saveCountry() {
    if (!accountId) return;
    setStatus("Guardando país…");
    const response = await fetch(`/api/admin/accounts/${accountId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ defaultPhoneCountry: country.toUpperCase() }) });
    const data = await response.json().catch(() => ({}));
    setStatus(response.ok ? "País de importación actualizado." : data.error || "No se pudo guardar.");
  }

  async function clearAddressBook() {
    if (!accountId) return;
    const confirmation = window.prompt("Esta acción borra únicamente la agenda de esta cuenta; no borra mensajes ni conversaciones. Escribe BORRAR AGENDA para continuar.");
    if (confirmation !== "BORRAR AGENDA") return;
    setStatus("Borrando agenda…");
    const response = await fetch("/api/admin/address-book/clear", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, confirmation: "BORRAR_AGENDA" }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setStatus(data.error || "No se pudo borrar la agenda.");
    setStatus(`Agenda eliminada: ${data.contactsDeleted ?? 0} contactos y ${data.phonesDeleted ?? 0} teléfonos. Los mensajes y conversaciones se han conservado.`);
    router.refresh();
  }

  return <section className="mt-6 rounded-xl border p-4">
    <h2 className="font-medium">Sincronización y país de importación</h2>
    <div className="mt-3 flex flex-wrap gap-2">
      <select value={accountId} onChange={(event) => changeAccount(event.target.value)} className="rounded-md border p-2 text-sm">{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select>
      <button type="button" onClick={reconcile} disabled={!accountId} className="rounded-md bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-50">Sincronizar contactos ya existentes</button>
    </div>
    <div className="mt-3 flex gap-2">
      <input value={country} onChange={(event) => setCountry(event.target.value.toUpperCase().slice(0, 2))} maxLength={2} aria-label="País de importación" className="w-20 rounded-md border p-2 text-sm" />
      <button type="button" onClick={saveCountry} disabled={!accountId} className="rounded-md border border-emerald-700 px-3 py-2 text-sm text-emerald-700 disabled:opacity-50">Guardar país</button>
    </div>
    <div className="mt-5 border-t border-rose-100 pt-4">
      <h3 className="text-sm font-medium text-rose-900">Restablecer agenda</h3>
      <p className="mt-1 text-sm text-slate-600">Elimina contactos, teléfonos y lotes importados de la cuenta seleccionada. No elimina identidades técnicas, conversaciones, mensajes, medios ni solicitudes de envío.</p>
      <button type="button" onClick={() => void clearAddressBook()} disabled={!accountId} className="mt-3 rounded-md border border-rose-300 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50">Borrar agenda de esta cuenta</button>
    </div>
    <p aria-live="polite" className="mt-3 text-sm text-slate-600">{status}</p>
  </section>;
}
