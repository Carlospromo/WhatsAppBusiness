"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }
  return <button onClick={logout} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">Cerrar sesión</button>;
}
