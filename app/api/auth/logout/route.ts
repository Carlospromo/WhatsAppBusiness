import { NextResponse } from "next/server";
import { destroySession, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const user = await getCurrentUser();
  if (user) await prisma.auditLog.create({ data: { userId: user.id, action: "LOGOUT", entity: "Session" } });
  await destroySession();
  return NextResponse.json({ ok: true });
}
