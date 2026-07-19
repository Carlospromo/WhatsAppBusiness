"use client";

import { useState } from "react";

export function ManualAddressBookContactForm({ accounts }: { accounts: { id: string; name: string; defaultPhoneCountry: string }[] }) {
  const [status, setStatus] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    setStatus("Guardando contacto…");
    setCreatedId(null);
    const response = await fetch("/api/address-book", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setStatus(data.error || "No se pudo guardar el contacto.");
    setCreatedId(data.id);
    setStatus(data.status === "UPDATED" ? "Se han actualizado los datos de agenda del contacto existente." : "Contacto creado correctamente.");
    event.currentTarget.reset();
  }

  return <form onSubmit={submit} className="mt-5 space-y-4 rounded-xl border p-5"><label className="block text-sm">Cuenta<select required name="accountId" defaultValue="" className="mt-1 block w-full rounded-md border p-2"><option value="">Selecciona una cuenta</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} ({account.defaultPhoneCountry})</option>)}</select></label><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm">Nombre<input required name="nombre" maxLength={120} className="mt-1 block w-full rounded-md border p-2" /></label><label className="block text-sm">Apellidos<input name="apellidos" maxLength={120} className="mt-1 block w-full rounded-md border p-2" /></label></div><label className="block text-sm">Teléfono<input required name="telefono" inputMode="tel" maxLength={64} placeholder="600 000 000 o +34 600 000 000" className="mt-1 block w-full rounded-md border p-2" /></label><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm">Email<input name="email" type="email" maxLength={254} className="mt-1 block w-full rounded-md border p-2" /></label><label className="block text-sm">Empresa<input name="empresa" maxLength={160} className="mt-1 block w-full rounded-md border p-2" /></label></div><label className="block text-sm">Etiquetas internas<input name="etiquetas" maxLength={300} placeholder="Cliente, Madrid" className="mt-1 block w-full rounded-md border p-2" /></label><label className="flex gap-2 text-sm"><input required type="checkbox" name="confirmed" value="true" />Confirmo que dispongo de legitimación para utilizar los datos de este contacto.</label><button className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white">Guardar contacto</button>{createdId && <a href={`/dashboard/agenda/${createdId}`} className="ml-3 text-sm font-medium text-emerald-700">Ver contacto</a>}<p aria-live="polite" className="text-sm text-slate-600">{status}</p></form>;
}
