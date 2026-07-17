import { requireUser } from "@/lib/auth";
import { LogoutButton } from "./logout-button";

export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <div><p className="font-semibold">WhatsAppBusiness</p><p className="text-xs text-slate-500">{user.name} · {user.role}</p></div>
        <LogoutButton />
      </header>
      {children}
    </div>
  );
}
