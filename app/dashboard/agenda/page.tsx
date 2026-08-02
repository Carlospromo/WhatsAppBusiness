import { AddressBookContactOrigin, AddressBookContactStatus } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { accountsForUser, canAccessAccount } from "@/lib/account";
import { listAddressBookContacts } from "@/lib/address-book-list";
import { AgendaClient } from "./agenda-client";

const origins = new Set(Object.values(AddressBookContactOrigin));
const statuses = new Set(Object.values(AddressBookContactStatus));

function mask(phone: string | undefined) {
  return phone ? `•••• ${phone.slice(-4)}` : null;
}

export default async function AddressBookPage({ searchParams }: { searchParams: Promise<{ account?: string; q?: string; origin?: string; status?: string; conversation?: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const params = await searchParams;
  const accounts = (await accountsForUser(user)).filter((account) => account.isActive);
  const accountId = params.account && await canAccessAccount(user, params.account) ? params.account : undefined;
  const origin = origins.has(params.origin as AddressBookContactOrigin) ? params.origin as AddressBookContactOrigin : undefined;
  const status = statuses.has(params.status as AddressBookContactStatus) ? params.status as AddressBookContactStatus : undefined;
  const conversation = params.conversation === "with" || params.conversation === "without" ? params.conversation : undefined;
  const { rows, total, nextCursor } = await listAddressBookContacts({
    accountIds: accounts.map((account) => account.id), accountId, q: params.q, origin, status, conversation,
  });
  const clientRows = rows.map((contact) => ({
    id: contact.id, account: contact.account, displayName: contact.displayName, lastName: contact.lastName,
    company: contact.company, origin: contact.origin, status: contact.status,
    phone: mask(contact.phones[0]?.normalizedPhone), conversationId: contact.whatsappContacts[0]?.conversations[0]?.id ?? null,
  }));
  return <AgendaClient
    accounts={accounts.map(({ id, name }) => ({ id, name }))}
    initialRows={clientRows} initialTotal={total} initialNextCursor={nextCursor}
    accountId={accountId} q={params.q?.trim().slice(0, 100) || undefined}
    origin={origin} status={status} conversation={conversation} admin={user.role === "ADMIN"}
  />;
}
