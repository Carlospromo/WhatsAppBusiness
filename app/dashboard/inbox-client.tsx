"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DirectMessageComposer } from "./direct-message-composer";
import { MessageComposer } from "./message-composer";

type Role = "ADMIN" | "AGENT" | "VIEWER";
type Account = { id: string; name: string; slug: string; isActive: boolean };
type AddressBookContact = { displayName: string; origin: string } | null;
type Contact = { id: string | null; displayName: string | null; pushName: string | null; phone: string | null; profilePictureUpdatedAt: string | null; addressBookContact: AddressBookContact } | null;
type Conversation = {
  id: string;
  accountId: string;
  type: "DIRECT" | "GROUP";
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  contact: Contact;
  account: Pick<Account, "id" | "name" | "slug">;
};
type MediaAttachment = { id: string; kind: "IMAGE" | "AUDIO" | "VIDEO"; status: "PENDING" | "DOWNLOADING" | "STORED" | "RETRYING" | "FAILED" | "REJECTED_LIMIT" | "UNAVAILABLE"; mimeType: string; sizeBytes: number | null; width: number | null; height: number | null; durationSeconds: number | null };
type Message = { id: string; direction: "INBOUND" | "OUTBOUND"; body: string | null; sentAt: string; messageType: string; mediaAttachments?: MediaAttachment[]; outboundStatus?: "PENDING" | "SENDING" | "SENT" | "FAILED" | "CANCELED"; outboundAttemptCount?: number | null };
type ConversationResponse = { conversation: Conversation; messages: Message[]; nextCursor: string | null };

function conversationName(conversation: Pick<Conversation, "contact" | "type">) {
  const contact = conversation.contact;
  const addressBookName = contact?.addressBookContact?.displayName;
  const hasGenericAddressBookName = (contact?.addressBookContact?.origin === "EXTERNAL" && addressBookName === "Contacto externo")
    || (contact?.addressBookContact?.origin === "WHATSAPP_SYNC" && addressBookName === "Contacto de WhatsApp");
  return (hasGenericAddressBookName ? null : addressBookName)
    || contact?.displayName
    || contact?.pushName
    || contact?.phone
    || (conversation.type === "GROUP" ? "Grupo" : "Conversación");
}

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "W";
}

function ConversationAvatar({ contact, name, size = "regular" }: { contact: Contact; name: string; size?: "small" | "regular" }) {
  const [imageFailed, setImageFailed] = useState(false);
  const dimension = size === "small" ? 40 : 48;
  const pictureVersion = contact?.profilePictureUpdatedAt;

  useEffect(() => setImageFailed(false), [contact?.id, pictureVersion]);

  if (contact?.id && !imageFailed) {
    const src = `/api/contacts/${contact.id}/avatar${pictureVersion ? `?v=${encodeURIComponent(pictureVersion)}` : ""}`;
    return <Image src={src} alt="" width={dimension} height={dimension} unoptimized onError={() => setImageFailed(true)} className={`${size === "small" ? "h-10 w-10" : "h-12 w-12"} shrink-0 rounded-full object-cover bg-slate-100`} />;
  }

  return <span className={`flex ${size === "small" ? "h-10 w-10" : "h-12 w-12"} shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-800`}>{initials(name)}</span>;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function emptyMessageLabel(messageType: string) {
  if (messageType === "image") return "📷 Imagen";
  if (messageType === "audio") return "🎙️ Audio";
  if (messageType === "video") return "🎥 Vídeo";
  return "Mensaje sin texto";
}

function mergeById<T extends { id: string }>(older: T[], newer: T[]) {
  const seen = new Set<string>();
  return [...older, ...newer].filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function sortConversationsByRecent(conversations: Conversation[]) {
  return [...conversations].sort((left, right) => {
    const leftTime = left.lastMessageAt ? new Date(left.lastMessageAt).getTime() : 0;
    const rightTime = right.lastMessageAt ? new Date(right.lastMessageAt).getTime() : 0;
    return rightTime - leftTime || right.id.localeCompare(left.id);
  });
}

function MediaContent({ attachment, outbound }: { attachment: MediaAttachment; outbound: boolean }) {
  const source = `/api/media/${attachment.id}`;
  const stateClass = outbound ? "text-emerald-50" : "text-slate-500";
  if (attachment.status === "REJECTED_LIMIT") return <p className={`text-sm ${stateClass}`}>Archivo no almacenado por superar el límite permitido.</p>;
  if (attachment.status === "UNAVAILABLE" || attachment.status === "FAILED") return <p className={`text-sm ${stateClass}`}>Archivo no disponible.</p>;
  if (attachment.status !== "STORED") return <p className={`text-sm ${stateClass}`}>Preparando archivo…</p>;
  const download = <a href={source} target="_blank" rel="noreferrer" className={`mt-2 inline-block text-xs font-medium underline ${outbound ? "text-emerald-50" : "text-emerald-700"}`}>Abrir o descargar</a>;
  if (attachment.kind === "IMAGE") return <div><a href={source} target="_blank" rel="noreferrer"><Image src={source} alt="Imagen recibida" width={960} height={720} unoptimized className="max-h-80 w-auto max-w-full rounded-xl object-contain" /></a>{download}</div>;
  if (attachment.kind === "AUDIO") return <div><audio controls preload="metadata" className="max-w-full" src={source}>Tu navegador no puede reproducir este audio.</audio>{download}</div>;
  return <div><video controls preload="metadata" className="max-h-80 max-w-full rounded-xl bg-slate-900" src={source}>Tu navegador no puede reproducir este vídeo.</video>{download}</div>;
}

export function InboxClient({ accounts, initialRows, initialNextCursor, initialSelectedId, accountId, filter, search, role, connectionStatuses }: {
  accounts: Account[];
  initialRows: Conversation[];
  initialNextCursor: string | null;
  initialSelectedId: string | null;
  accountId?: string;
  filter: string;
  search?: string;
  role: Role;
  connectionStatuses: Record<string, string>;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(() => sortConversationsByRecent(initialRows));
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [detail, setDetail] = useState<ConversationResponse | null>(null);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [conversationError, setConversationError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [directComposerOpen, setDirectComposerOpen] = useState(false);
  const [locallyReadIds, setLocallyReadIds] = useState<Set<string>>(() => new Set());
  const messageScrollerRef = useRef<HTMLDivElement>(null);
  const shouldScrollThreadToBottom = useRef(Boolean(initialSelectedId));
  const threadWasAtBottom = useRef(true);
  const renderedThreadRef = useRef<{ conversationId: string; lastMessageId: string | null } | null>(null);
  const canManage = role === "ADMIN" || role === "AGENT";

  const pageUrl = useCallback((changes: { account?: string | null; filter?: string; selected?: string | null } = {}) => {
    const params = new URLSearchParams();
    const selectedAccount = changes.account === undefined ? accountId : changes.account;
    const selectedFilter = changes.filter ?? filter;
    const selectedConversation = changes.selected === undefined ? selectedId : changes.selected;
    if (selectedAccount) params.set("account", selectedAccount);
    if (selectedFilter && selectedFilter !== "all") params.set("filter", selectedFilter);
    if (search) params.set("q", search);
    if (selectedConversation) params.set("selected", selectedConversation);
    const query = params.toString();
    return `/dashboard${query ? `?${query}` : ""}`;
  }, [accountId, filter, search, selectedId]);

  const markRead = useCallback(async (id: string) => {
    if (!canManage) return;
    // The badge is a local inbox indicator. Clear it immediately when the
    // user actually opens the thread; the persisted read receipt follows in
    // the background and never runs merely because a list was refreshed.
    setLocallyReadIds((current) => new Set(current).add(id));
    setRows((current) => current.map((item) => item.id === id ? { ...item, unreadCount: 0 } : item));
    setDetail((current) => current?.conversation.id === id
      ? { ...current, conversation: { ...current.conversation, unreadCount: 0 } }
      : current);
    const response = await fetch(`/api/conversations/${id}/read`, { method: "POST" });
    if (response.ok) return;
    // The server remains authoritative. A later refresh will restore the
    // badge if this request could not be persisted.
    setLocallyReadIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, [canManage]);

  const loadConversation = useCallback(async (id: string, quiet = false) => {
    if (!quiet) {
      setLoadingConversation(true);
      setConversationError("");
    }
    try {
      const response = await fetch(`/api/conversations/${id}`, { cache: "no-store" });
      const data = await response.json().catch(() => null) as ConversationResponse | null;
      if (!response.ok || !data) throw new Error("conversation_unavailable");
      const normalized = locallyReadIds.has(id)
        ? { ...data, conversation: { ...data.conversation, unreadCount: 0 } }
        : data;
      setDetail(normalized);
      setRows((current) => {
        const existing = current.find((item) => item.id === normalized.conversation.id);
        const next = existing
          ? current.map((item) => item.id === normalized.conversation.id ? { ...item, ...normalized.conversation } : item)
          : [normalized.conversation, ...current];
        return sortConversationsByRecent(next);
      });
      if (data.conversation.unreadCount > 0 && !locallyReadIds.has(id)) void markRead(id);
    } catch {
      if (!quiet) setConversationError("No se pudo cargar esta conversación. Vuelve a intentarlo.");
    } finally {
      if (!quiet) setLoadingConversation(false);
    }
  }, [locallyReadIds, markRead]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setConversationError("");
      return;
    }
    void loadConversation(selectedId);
  }, [loadConversation, selectedId]);

  useLayoutEffect(() => {
    const scroller = messageScrollerRef.current;
    if (!scroller || !detail) return;
    const lastMessageId = detail.messages.at(-1)?.id ?? null;
    const previous = renderedThreadRef.current;
    const changedConversation = previous?.conversationId !== detail.conversation.id;
    const hasNewLastMessage = previous?.conversationId === detail.conversation.id && previous.lastMessageId !== lastMessageId;
    if (shouldScrollThreadToBottom.current || changedConversation || (hasNewLastMessage && threadWasAtBottom.current)) {
      scroller.scrollTop = scroller.scrollHeight;
      shouldScrollThreadToBottom.current = false;
      threadWasAtBottom.current = true;
    }
    renderedThreadRef.current = { conversationId: detail.conversation.id, lastMessageId };
  }, [detail]);

  useEffect(() => {
    if (!selectedId) return;
    const timer = window.setInterval(() => void loadConversation(selectedId, true), 7_000);
    return () => window.clearInterval(timer);
  }, [loadConversation, selectedId]);

  const selectedConversation = detail?.conversation || rows.find((conversation) => conversation.id === selectedId) || null;
  const selectedName = selectedConversation ? conversationName(selectedConversation) : "";
  const selectedPhone = selectedConversation?.contact?.phone ?? null;
  const sendingEnabled = Boolean(selectedConversation && canManage && connectionStatuses[selectedConversation.accountId] === "CONNECTED");
  const selectedAccount = accounts.find((account) => account.id === accountId) ?? null;
  const directMessageEnabled = Boolean(selectedAccount && canManage && connectionStatuses[selectedAccount.id] === "CONNECTED");
  const hasExternalContact = selectedConversation?.contact?.addressBookContact?.origin === "EXTERNAL";
  const filters = useMemo(() => [["all", "Todas"], ["unread", "No leídas"], ["direct", "Directas"], ["group", "Grupos"]], []);

  function selectConversation(id: string) {
    if (rows.find((conversation) => conversation.id === id)?.unreadCount) void markRead(id);
    setSelectedId(id);
    setDetail(null);
    setConversationError("");
    shouldScrollThreadToBottom.current = true;
    threadWasAtBottom.current = true;
    router.replace(pageUrl({ selected: id }));
  }

  function closeConversation() {
    setSelectedId(null);
    setDetail(null);
    router.replace(pageUrl({ selected: null }));
  }

  async function loadOlder() {
    if (!selectedId || !detail?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await fetch(`/api/conversations/${selectedId}?cursor=${encodeURIComponent(detail.nextCursor)}`, { cache: "no-store" });
      const data = await response.json().catch(() => null) as ConversationResponse | null;
      if (!response.ok || !data) throw new Error("messages_unavailable");
      setDetail((current) => current?.conversation.id === selectedId
        ? { ...current, messages: mergeById(data.messages, current.messages), nextCursor: data.nextCursor }
        : current);
    } finally {
      setLoadingMore(false);
    }
  }

  async function loadMoreConversations() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ cursor: nextCursor, filter });
      if (accountId) params.set("accountId", accountId);
      if (search) params.set("q", search);
      const response = await fetch(`/api/conversations?${params.toString()}`, { cache: "no-store" });
      const data = await response.json().catch(() => null) as { rows?: Conversation[]; nextCursor?: string | null } | null;
      if (!response.ok || !data?.rows) throw new Error("conversations_unavailable");
      setRows((current) => sortConversationsByRecent(mergeById(current, data.rows!)));
      setNextCursor(data.nextCursor ?? null);
    } finally {
      setLoadingMore(false);
    }
  }

  let previousDay = "";
  return (
    <main className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">WhatsAppBusiness</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Conversaciones</h1>
        </div>
        <div className="flex gap-2">
          {canManage && <button type="button" onClick={() => setDirectComposerOpen(true)} disabled={!selectedAccount} className="rounded-full bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50" title={!selectedAccount ? "Selecciona una cuenta para iniciar un mensaje" : undefined}>Nuevo mensaje</button>}
          <Link href="/dashboard/agenda" className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-emerald-300 hover:text-emerald-700">Agenda</Link>
        </div>
      </div>

      <nav className="mb-4 flex gap-2 overflow-x-auto pb-1 text-sm" aria-label="Cuentas">
        <Link href={pageUrl({ account: null, selected: null })} className={`whitespace-nowrap rounded-full px-3 py-1.5 ${!accountId ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>Todas las cuentas</Link>
        {accounts.map((account) => <Link key={account.id} href={pageUrl({ account: account.id, selected: null })} className={`whitespace-nowrap rounded-full px-3 py-1.5 ${accountId === account.id ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>{account.name}</Link>)}
      </nav>

      <div className="grid h-[calc(100dvh-10rem)] max-h-[46rem] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:grid-cols-[22rem_minmax(0,1fr)]">
        <aside className={`min-h-0 flex-col border-r border-slate-200 bg-white ${selectedId ? "hidden md:flex" : "flex"}`}>
          <form className="border-b border-slate-100 p-3">
            <input type="hidden" name="account" value={accountId || ""} />
            <input type="hidden" name="filter" value={filter === "all" ? "" : filter} />
            <label className="sr-only" htmlFor="conversation-search">Buscar conversaciones</label>
            <input id="conversation-search" name="q" defaultValue={search} placeholder="Buscar conversaciones" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100" />
          </form>
          <nav className="flex gap-1 overflow-x-auto border-b border-slate-100 p-2" aria-label="Filtros">
            {filters.map(([id, label]) => <Link key={id} href={pageUrl({ filter: id, selected: null })} className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium ${filter === id || (id === "all" && !filter) ? "bg-emerald-50 text-emerald-800" : "text-slate-500 hover:bg-slate-50"}`}>{label}</Link>)}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-scroll [scrollbar-gutter:stable]">
            {rows.length ? rows.map((conversation) => {
              const name = conversationName(conversation);
              const isSelected = conversation.id === selectedId;
              const external = conversation.contact?.addressBookContact?.origin === "EXTERNAL";
              return <button key={conversation.id} type="button" onClick={() => selectConversation(conversation.id)} className={`flex w-full gap-3 border-b border-slate-100 px-3 py-3 text-left transition ${isSelected ? "bg-emerald-50" : "hover:bg-slate-50"}`}>
                <ConversationAvatar contact={conversation.contact} name={name} size="small" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2"><strong className="truncate text-sm text-slate-800">{name}</strong>{conversation.lastMessageAt && <time className="shrink-0 text-[11px] text-slate-400">{formatTime(conversation.lastMessageAt)}</time>}</span>
                  <span className="mt-0.5 flex items-center gap-2"><span className={`min-w-0 flex-1 truncate text-xs ${conversation.unreadCount > 0 ? "font-medium text-slate-700" : "text-slate-500"}`}>{conversation.lastMessagePreview || "Sin texto"}</span>{conversation.unreadCount > 0 && <span className="rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">{conversation.unreadCount}</span>}</span>
                  <span className="mt-1 flex gap-1">{external && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800">Externo</span>}{!accountId && <span className="truncate text-[10px] text-slate-400">{conversation.account.name}</span>}</span>
                </span>
              </button>;
            }) : <div className="p-8 text-center text-sm text-slate-500"><p className="font-medium text-slate-700">No hay conversaciones</p><p className="mt-1">Los nuevos mensajes aparecerán aquí.</p></div>}
          </div>
          {nextCursor && <button type="button" onClick={() => void loadMoreConversations()} disabled={loadingMore} className="border-t border-slate-100 px-3 py-3 text-sm font-medium text-emerald-700 disabled:opacity-50">{loadingMore ? "Cargando…" : "Cargar más conversaciones"}</button>}
        </aside>

        <section className={`min-h-0 flex-col bg-slate-50 ${selectedId ? "flex" : "hidden md:flex"}`}>
          {!selectedId ? <div className="m-auto max-w-sm px-8 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-xl">💬</div><h2 className="mt-4 text-lg font-semibold text-slate-800">Selecciona una conversación</h2><p className="mt-2 text-sm text-slate-500">Abre un chat para ver sus mensajes y responder desde aquí.</p></div> : <>
            {selectedConversation && <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-3 py-3 sm:px-5">
              <button type="button" onClick={closeConversation} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 md:hidden" aria-label="Volver a conversaciones">←</button>
              <ConversationAvatar contact={selectedConversation.contact} name={selectedName} />
              <div className="min-w-0 flex-1"><h2 className="truncate font-semibold text-slate-900">{selectedName}</h2><p className="truncate text-xs text-slate-500">{selectedConversation.account.name}{selectedPhone && selectedPhone !== selectedName ? ` · ${selectedPhone}` : ""}{hasExternalContact ? " · Contacto externo" : ""}</p></div>
              {hasExternalContact && <span className="hidden rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-800 sm:inline">Externo</span>}
            </header>}
            <div ref={messageScrollerRef} onScroll={(event) => {
              const element = event.currentTarget;
              threadWasAtBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
            }} className="min-h-0 flex-1 overflow-y-scroll bg-[radial-gradient(circle_at_top,_#f8fafc,_#eef5f2)] px-3 py-4 [scrollbar-gutter:stable] sm:px-6">
              {loadingConversation && <p className="py-10 text-center text-sm text-slate-500">Cargando conversación…</p>}
              {conversationError && <div className="mx-auto max-w-md rounded-xl border border-rose-200 bg-rose-50 p-4 text-center text-sm text-rose-800"><p>{conversationError}</p><button type="button" onClick={() => selectedId && void loadConversation(selectedId)} className="mt-2 font-medium underline">Reintentar</button></div>}
              {detail && <div className="mx-auto flex max-w-3xl flex-col gap-2">
                {detail.nextCursor && <button type="button" onClick={() => void loadOlder()} disabled={loadingMore} className="mx-auto rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm ring-1 ring-slate-200 disabled:opacity-50">{loadingMore ? "Cargando…" : "Cargar mensajes anteriores"}</button>}
                {detail.messages.length ? detail.messages.map((message) => {
                  const day = formatDay(message.sentAt);
                  const showDay = day !== previousDay;
                  previousDay = day;
                  const outbound = message.direction === "OUTBOUND";
                  return <div key={message.id}>
                    {showDay && <p className="my-3 text-center text-[11px] font-medium text-slate-400"><span className="rounded-full bg-white px-3 py-1.5 shadow-sm">{day}</span></p>}
                    <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
                      <article className={`max-w-[88%] rounded-2xl px-3 py-2.5 text-sm shadow-sm sm:max-w-[74%] ${outbound ? "rounded-br-md bg-emerald-600 text-white" : "rounded-bl-md bg-white text-slate-800"}`}>
                        {message.mediaAttachments?.map((attachment) => <MediaContent key={attachment.id} attachment={attachment} outbound={outbound} />)}
                        {message.body ? <p className={`${message.mediaAttachments?.length ? "mt-2" : ""} whitespace-pre-wrap break-words leading-relaxed`}>{message.body}</p> : !message.mediaAttachments?.length && <p className="whitespace-pre-wrap break-words leading-relaxed">{emptyMessageLabel(message.messageType)}</p>}
                        <div className={`mt-1 flex items-center justify-end gap-1.5 text-[10px] ${outbound ? "text-emerald-100" : "text-slate-400"}`}>{outbound && message.outboundStatus === "SENDING" && <span>Enviando</span>}{outbound && message.outboundStatus === "CANCELED" && <span className="font-medium text-amber-100">Cancelado</span>}{outbound && message.outboundStatus === "FAILED" && <span className="font-medium text-rose-100">Error</span>}{outbound && message.outboundStatus === "SENT" && <span>Enviado</span>}<time>{formatTime(message.sentAt)}</time></div>
                      </article>
                    </div>
                  </div>;
                }) : <p className="py-10 text-center text-sm text-slate-500">Esta conversación todavía no contiene mensajes de texto.</p>}
              </div>}
            </div>
            {selectedConversation && <MessageComposer conversationId={selectedConversation.id} enabled={sendingEnabled} onQueued={() => selectedId && void loadConversation(selectedId, true)} />}
          </>}
        </section>
      </div>
      {directComposerOpen && selectedAccount && <DirectMessageComposer accountId={selectedAccount.id} accountName={selectedAccount.name} enabled={directMessageEnabled} onClose={() => setDirectComposerOpen(false)} onQueued={(conversationId) => { setDirectComposerOpen(false); selectConversation(conversationId); }} />}
    </main>
  );
}
