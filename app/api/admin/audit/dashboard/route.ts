import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAuditSafetyDashboard } from "@/lib/admin/audit-dashboard";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  return NextResponse.json(await getAuditSafetyDashboard(), { headers: { "Cache-Control": "no-store" } });
}
