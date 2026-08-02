"use client";

import Link from "next/link";
import { useState } from "react";

type Account = { id: string; name: string };
type Origin = "IMPORTED" | "WHATSAPP_SYNC" | "EXTERNAL" | "MANUAL";
type Status = "VERIFIED" | "EXTERNAL";
type ContactRow = {
  id: string;
  account: Account;
  displayName: string;
  lastName: string | null;
  company: string | null;
  origin: Origin;
  status: Status;
  phone: string | null;
  conversationId: string | null;
};

const originLabels: Record<Origin, string> = {
  IMPORTED: "Importado",
  WHATSAPP_SYNC: "Sincronizado",
  EXTERNAL: "Externo",
  MANUAL: "Manual",
};

function originClass(origin: Origin) {
  if (origin === "EXTERNAL") return "bg-amber-50 text-amber-800 ring-amber-200";
  if (origin === "IMPORTED") return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  return "bg-slate-100 text-slate-700 ring-slate-200";
}

function paramsFor(query: { accountId?: string; q?: string; origin?: string; status?: string; conversation?: string; cursor?: string }) {
  const params = new URLSearchParams();
  if (query.accountId) params.set("accountId", query.accountId);
  if (query.q) params.set("q", query.q);
  if (query.origin) params.set("origin", query.origin);
  if (query.status) params.set("status", query.status);
  if (query.conversation) params.set("conversation", query.conversation);
  if (query.cursor) params.set("cursor", query.cursor);
  return params;
}

export function AgendaClient({
  accounts,
  initialRows,
  initialTotal,
  initialNextCursor,
  accountId,
  q,
  origin,
  status,
  conversation,
  admin,
}: {
  accounts: Account[];
  initialRows: ContactRow[];
  initialTotal: number;
  initialNextCursor: string | null;
  accountId?: string;
  q?: string;
  origin?: Origin;
  status?: Status;
  conversation?: "with" | "without";
  admin: boolean;
}) {
  const [rows, setRows] = useState(initialRows);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const pageParams = (changes: { account?: string | null; q?: string; origin?: string; status?: string; conversation?: string } = {}) => {
    const params = new URLSearchParams();
    const nextAccount = changes.account === undefined ? accountId : changes.account;
    const nextQuery = changes.q ?? q;
    const nextOrigin = changes.origin ?? origin;
    const nextStatus = changes.status ?? status;
    const nextConversation = changes.conversation ?? conversation;
    if (nextAccount) params.set("account", nextAccount);
    if (nextQuery) params.set("q", nextQuery);
    if (nextOrigin) params.set("origin", nextOrigin);
    if (nextStatus) params.set("status", nextStatus);
    if (nextConversation) params.set("conversation", nextConversation);
    const value = params.toString();
    return `/dashboard/agenda${value ? `?${value}` : ""}`;
  };

  async function loadMore() {
    if (!nextCursor || loading) return;
    setLoading(true);
    setError("");
    try {
      const params = paramsFor({ accountId, q, origin, status, conversation, cursor: nextCursor });
      const response = await fetch(`/api/address-book?${params.toString()}`, { cache: "no-store" });
      const data = await response.json().catch(() => null) as { rows?: ContactRow[]; total?: number; nextCursor?: string | null } | null;
      if (!response.ok || !data?.rows) throw new Error("address_book_unavailable");
      setRows((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...data.rows!.filter((item) => !known.has(item.id))];
      });
      setNextCursor(data.nextCursor ?? null);
      if (typeof data.total === "number") setTotal(data.total);
    } catch {
      setError("No se pudieron cargar más contactos. Vuelve a intentarlo.");
    } finally {
      setLoading(false);
    }
  }

  return <main className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <Link href="/dashboard" className="text-sm font-medium text-emerald-700 hover:text-emerald-800">← Conversaciones</Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Agenda</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">Contactos importados, creados manualmente y conocidos por WhatsApp. Los datos importados siempre prevalecen.</p>
      </div>
      {admin && <div className="flex flex-wrap gap-2">
        <Link href="/dashboard/agenda/nuevo" className="rounded-full bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800">Añadir contacto</Link>
        <Link href="/dashboard/agenda/importar" className="rounded-full border border-emerald-700 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50">Importar</Link>
        <Link href="/dashboard/agenda/manage" className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-emerald-300">Gestionar</Link>
      </div>}
    </header>

    <nav className="mt-5 flex gap-2 overflow-x-auto pb-1 text-sm" aria-label="Cuentas de agenda">
      <Link href={pageParams({ account: null })} className={`whitespace-nowrap rounded-full px-3 py-1.5 ${!accountId ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>Todas las autorizadas</Link>
      {accounts.map((account) => <Link key={account.id} href={pageParams({ account: account.id })} className={`whitespace-nowrap rounded-full px-3 py-1.5 ${accountId === account.id ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>{account.name}</Link>)}
    </nav>

    <form className="mt-4 grid gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto]">
      <input type="hidden" name="account" value={accountId || ""} />
      <label className="sr-only" htmlFor="agenda-search">Buscar contactos</label>
      <input id="agenda-search" name="q" defaultValue={q} placeholder="Nombre, apellidos, empresa, correo o teléfono" className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100" />
      <select name="origin" defaultValue={origin || ""} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="">Todos los orígenes</option><option value="IMPORTED">Importados</option><option value="MANUAL">Manuales</option><option value="WHATSAPP_SYNC">Sincronizados</option><option value="EXTERNAL">Externos</option></select>
      <select name="status" defaultValue={status || ""} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="">Todos los estados</option><option value="VERIFIED">Verificados</option><option value="EXTERNAL">Externos</option></select>
      <select name="conversation" defaultValue={conversation || ""} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="">Con y sin conversación</option><option value="with">Con conversación</option><option value="without">Sin conversación</option></select>
      <button className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700">Filtrar</button>
    </form>

    <p className="mt-4 text-sm text-slate-500" aria-live="polite">{rows.length} de {total} contactos cargados</p>
    <section className="mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Contactos de agenda">
      {rows.length ? rows.map((contact) => <article key={contact.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-0 sm:flex-nowrap">
        <div className="min-w-0">
          <Link href={`/dashboard/agenda/${contact.id}`} className="font-semibold text-slate-800 hover:text-emerald-700">{contact.displayName}{contact.lastName ? ` ${contact.lastName}` : ""}</Link>
          <p className="mt-0.5 truncate text-sm text-slate-500">{contact.phone || "Número no disponible"}{contact.company ? ` · ${contact.company}` : ""}</p>
          {!accountId && <p className="mt-0.5 text-xs text-slate-400">{contact.account.name}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`rounded-full px-2 py-1 text-xs font-medium ring-1 ${originClass(contact.origin)}`}>{originLabels[contact.origin]}</span>
          {contact.conversationId && <Link className="rounded-lg px-2 py-1 text-sm font-medium text-emerald-700 hover:bg-emerald-50" href={`/dashboard?selected=${contact.conversationId}${accountId ? `&account=${accountId}` : ""}`}>Conversación</Link>}
        </div>
      </article>) : <div className="px-6 py-12 text-center"><p className="font-medium text-slate-800">No hay contactos para este filtro</p><p className="mt-1 text-sm text-slate-500">Los contactos que escriban y los importados aparecerán aquí.</p></div>}
    </section>
    {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}
    {nextCursor && <div className="mt-4 text-center"><button type="button" onClick={() => void loadMore()} disabled={loading} className="rounded-full border border-emerald-700 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">{loading ? "Cargando…" : "Cargar 50 contactos más"}</button></div>}
  </main>;
}
