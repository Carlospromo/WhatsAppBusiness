import { AddressBookContactOrigin, AddressBookContactStatus, Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export const firstAddressBookPageSize = 100;
export const subsequentAddressBookPageSize = 50;

export type AddressBookListQuery = {
  accountIds: string[];
  accountId?: string;
  q?: string;
  origin?: AddressBookContactOrigin;
  status?: AddressBookContactStatus;
  conversation?: "with" | "without";
  cursor?: string;
};

export function parseAddressBookCursor(value: string | null | undefined) {
  return value && /^[a-zA-Z0-9_-]{10,40}$/.test(value) ? value : undefined;
}

export function addressBookPage<T extends { id: string }>(results: T[], pageSize: number) {
  const rows = results.slice(0, pageSize);
  return { rows, nextCursor: results.length > pageSize ? rows.at(-1)?.id ?? null : null };
}

export function addressBookWhere(query: AddressBookListQuery): Prisma.AddressBookContactWhereInput {
  const q = query.q?.trim().slice(0, 100);
  return {
    accountId: query.accountId ?? { in: query.accountIds },
    ...(query.origin ? { origin: query.origin } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.conversation === "with" ? { whatsappContacts: { some: { conversations: { some: {} } } } } : {}),
    ...(query.conversation === "without" ? { whatsappContacts: { none: { conversations: { some: {} } } } } : {}),
    ...(q ? {
      OR: [
        { displayName: { contains: q } },
        { lastName: { contains: q } },
        { company: { contains: q } },
        { email: { contains: q } },
        { phones: { some: { normalizedPhone: { contains: q.replace(/\s/g, "") } } } },
      ],
    } : {}),
  };
}

/**
 * The address book is intentionally paged instead of capped: the initial
 * page is large enough for normal work and later pages remain lightweight.
 */
export async function listAddressBookContacts(query: AddressBookListQuery) {
  const where = addressBookWhere(query);
  const pageSize = query.cursor ? subsequentAddressBookPageSize : firstAddressBookPageSize;
  const [results, total] = await prisma.$transaction([
    prisma.addressBookContact.findMany({
      where,
      include: {
        account: { select: { id: true, name: true } },
        phones: { select: { normalizedPhone: true }, orderBy: { createdAt: "asc" }, take: 1 },
        whatsappContacts: { select: { conversations: { select: { id: true }, orderBy: { lastMessageAt: "desc" }, take: 1 } }, take: 1 },
      },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
      take: pageSize + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    }),
    prisma.addressBookContact.count({ where }),
  ]);
  const page = addressBookPage(results, pageSize);
  return {
    rows: page.rows,
    total,
    nextCursor: page.nextCursor,
  };
}
