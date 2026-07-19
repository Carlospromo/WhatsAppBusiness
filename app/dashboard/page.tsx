import { getCurrentUser } from "@/lib/auth";
import { accountsForUser, canAccessAccount } from "@/lib/account";
import { listConversations } from "@/lib/inbox";
import { prisma } from "@/lib/prisma";
import { InboxClient } from "./inbox-client";

const validFilters = new Set(["all", "unread", "direct", "group"]);

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ selected?: string; filter?: string; q?: string; account?: string }> }) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) return null;

  const accounts = await accountsForUser(user);
  const activeAccounts = accounts.filter((account) => account.isActive);
  const accountId = params.account && await canAccessAccount(user, params.account) ? params.account : undefined;
  const filter = validFilters.has(params.filter || "") ? params.filter || "all" : "all";
  const search = params.q?.trim().slice(0, 100) || undefined;
  const { rows, nextCursor } = await listConversations({ accountIds: activeAccounts.map((account) => account.id), accountId, filter, search });
  const selected = params.selected || null;
  const connections = await prisma.whatsAppConnection.findMany({ where: { accountId: { in: activeAccounts.map((account) => account.id) } }, select: { accountId: true, status: true } });
  const connectionStatuses = Object.fromEntries(connections.map((connection) => [connection.accountId, connection.status]));
  const clientRows = rows.map((conversation) => ({
    id: conversation.id,
    accountId: conversation.accountId,
    type: conversation.type,
    lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
    lastMessagePreview: conversation.lastMessagePreview,
    unreadCount: conversation.unreadCount,
    contact: conversation.contact ? {
      id: conversation.contact.id,
      displayName: conversation.contact.displayName,
      pushName: conversation.contact.pushName,
      phone: conversation.contact.phone,
      profilePictureUpdatedAt: conversation.contact.profilePictureUpdatedAt?.toISOString() ?? null,
      addressBookContact: conversation.contact.addressBookContact ? { displayName: conversation.contact.addressBookContact.displayName, origin: conversation.contact.addressBookContact.origin } : null,
    } : null,
    account: conversation.account,
  }));

  return <InboxClient key={`${accountId || "all"}:${filter}:${search || ""}:${selected || ""}`} accounts={activeAccounts} initialRows={clientRows} initialNextCursor={nextCursor} initialSelectedId={selected} accountId={accountId} filter={filter} search={search} role={user.role} connectionStatuses={connectionStatuses}/>;
}
