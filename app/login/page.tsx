import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <section className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-7 shadow-sm">
        <p className="text-sm font-semibold text-emerald-700">WhatsAppBusiness</p>
        <h1 className="mt-2 text-2xl font-semibold">Acceso privado</h1>
        <p className="mt-2 text-sm text-slate-600">Inicia sesión para gestionar la cuenta.</p>
        <LoginForm />
      </section>
    </main>
  );
}
