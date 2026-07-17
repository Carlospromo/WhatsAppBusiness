import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listConversations, parseCursor } from "@/lib/inbox";
export async function GET(request: NextRequest) {
  if (!await getCurrentUser()) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const p = request.nextUrl.searchParams;
  const filter = p.get("filter") || "all";
  if (!["all", "unread", "direct", "group"].includes(filter)) return NextResponse.json({ error: "Filtro inválido" }, { status: 400 });
  return NextResponse.json(await listConversations({ filter, search: p.get("q") || undefined, cursor: parseCursor(p.get("cursor")) }));
}
