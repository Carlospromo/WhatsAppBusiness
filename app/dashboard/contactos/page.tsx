import { redirect } from "next/navigation";

/**
 * The technical WhatsApp-identity view was retired in favour of the hybrid
 * address book. Keep this redirect for existing bookmarks without exposing a
 * second, potentially stale contact catalogue.
 */
export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string; account?: string; origin?: string }> }) {
  const params = await searchParams;
  const query = new URLSearchParams();
  if (params.account) query.set("account", params.account);
  if (params.q) query.set("q", params.q);
  if (params.origin) query.set("origin", params.origin);
  redirect(`/dashboard/agenda${query.size ? `?${query.toString()}` : ""}`);
}
