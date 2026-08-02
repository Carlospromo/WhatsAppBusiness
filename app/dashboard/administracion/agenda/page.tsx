import { redirect } from "next/navigation";

export default function LegacyAdminAddressBookPage() {
  redirect("/dashboard/agenda/manage");
}
