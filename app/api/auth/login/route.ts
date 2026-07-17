import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { email } });
  const valid = user ? await verifyPassword(user.passwordHash, password) : false;
  if (!user || !valid) return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });

  await createSession(user.id);
  await prisma.auditLog.create({ data: { userId: user.id, action: "LOGIN", entity: "Session" } });
  return NextResponse.json({ ok: true });
}
