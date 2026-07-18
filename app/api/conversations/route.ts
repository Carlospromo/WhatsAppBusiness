import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listConversations, parseCursor } from "@/lib/inbox";
import { accountsForUser, canAccessAccount } from "@/lib/account";
export async function GET(request: NextRequest) {
  const user = await getCurrentUser(); if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const p = request.nextUrl.searchParams;
  const filter = p.get("filter") || "all";
  if (!["all", "unread", "direct", "group"].includes(filter)) return NextResponse.json({ error: "Filtro inválido" }, { status: 400 });
  const accountId = p.get("accountId") || undefined;
  if (accountId && !await canAccessAccount(user, accountId)) return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  const accounts = await accountsForUser(user);
  return NextResponse.json(await listConversations({ accountIds: accounts.filter((account) => account.isActive).map((account) => account.id), accountId, filter, search: p.get("q") || undefined, cursor: parseCursor(p.get("cursor")) }));
}
