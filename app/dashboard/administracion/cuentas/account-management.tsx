"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Account = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  defaultPhoneCountry: string;
  connection: { status: string; maskedPhone: string | null } | null;
  memberships: { user: { id: string; name: string; email: string; role: string } }[];
};
type User = { id: string; name: string; email: string; role: string };

export function AccountManagement({ accounts, users }: { accounts: Account[]; users: User[] }) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setStatus("Creando cuenta…");
    const response = await fetch("/api/admin/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, slug }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setStatus(data.error || "No se pudo crear la cuenta.");
    setStatus("Cuenta creada. Puedes vincularla desde Vinculación.");
    setName(""); setSlug(""); router.refresh();
  }

  async function active(account: Account) {
    if (account.isActive && !window.confirm(`¿Desactivar ${account.name}? Sus datos y sesión se conservarán.`)) return;
    setStatus(account.isActive ? "Desactivando…" : "Reactivando…");
    const response = await fetch(`/api/admin/accounts/${account.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !account.isActive }) });
    const data = await response.json().catch(() => ({}));
    setStatus(response.ok ? (account.isActive ? "Cuenta desactivada de forma recuperable." : "Cuenta reactivada.") : data.error || "No se pudo actualizar la cuenta.");
    router.refresh();
  }

  function beginRename(account: Account) {
    setEditingId(account.id);
    setEditingName(account.name);
  }

  async function rename(account: Account) {
    const normalizedName = editingName.trim();
    if (!normalizedName) return setStatus("Introduce un nombre de cuenta válido.");
    setStatus("Guardando nombre…");
    const response = await fetch(`/api/admin/accounts/${account.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: normalizedName }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setStatus(data.error || "No se pudo cambiar el nombre de la cuenta.");
    setEditingId(null);
    setStatus("Nombre de cuenta actualizado.");
    router.refresh();
  }

  async function membership(accountId: string, userId: string, enabled: boolean) {
    const response = await fetch(`/api/admin/accounts/${accountId}/memberships`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, enabled }) });
    if (response.ok) router.refresh(); else setStatus("No se pudo cambiar el acceso.");
  }

  return <div className="mt-6 space-y-6">
    <form onSubmit={create} className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-[1fr_1fr_auto]">
      <input required value={name} onChange={(event) => { setName(event.target.value); if (!slug) setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")); }} placeholder="Nombre, por ejemplo Personal" className="rounded-md border p-2" />
      <input required value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase())} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="slug, por ejemplo personal" className="rounded-md border p-2" />
      <button className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white">Crear cuenta</button>
    </form>
    <p aria-live="polite" className="text-sm text-slate-600">{status}</p>
    <div className="space-y-4">
      {accounts.map((account) => <article key={account.id} className="rounded-xl border bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {editingId === account.id ? <div className="flex flex-wrap items-center gap-2"><input value={editingName} onChange={(event) => setEditingName(event.target.value)} maxLength={80} aria-label="Nombre de cuenta" className="rounded-md border px-2 py-1 font-semibold" /><button type="button" onClick={() => void rename(account)} className="rounded-md bg-emerald-700 px-2 py-1 text-sm text-white">Guardar</button><button type="button" onClick={() => setEditingId(null)} className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100">Cancelar</button></div> : <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{account.name}</h2><button type="button" onClick={() => beginRename(account)} className="text-sm font-medium text-emerald-700 hover:underline">Cambiar nombre</button></div>}
            <p className="mt-1 text-sm text-slate-600">{account.isActive ? "Activa" : "Desactivada"} · {account.connection?.status || "DISCONNECTED"}{account.connection?.maskedPhone ? ` · ${account.connection.maskedPhone}` : ""}</p>
          </div>
          <div className="flex gap-2"><Link href={`/dashboard/integracion?account=${account.id}`} className="rounded-md border border-emerald-700 px-3 py-2 text-sm text-emerald-700">Vincular</Link><button type="button" onClick={() => void active(account)} className="rounded-md border px-3 py-2 text-sm">{account.isActive ? "Desactivar" : "Reactivar"}</button></div>
        </div>
        <div className="mt-4 border-t pt-4"><p className="text-sm font-medium">Usuarios con acceso</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{users.map((user) => { const enabled = account.memberships.some((membership) => membership.user.id === user.id); return <label className="flex items-center justify-between rounded border p-2 text-sm" key={user.id}><span className="truncate">{user.name} <span className="text-slate-500">· {user.role}</span></span><input checked={enabled} onChange={(event) => void membership(account.id, user.id, event.target.checked)} type="checkbox" /></label>; })}</div></div>
      </article>)}
      {!accounts.length && <p className="rounded-xl border border-dashed p-5 text-sm text-slate-500">Crea la primera cuenta para iniciar la vinculación.</p>}
    </div>
  </div>;
}
