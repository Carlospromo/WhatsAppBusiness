import { Role } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";

export async function requireAdminApi() {
  const user = await getCurrentUser();
  return user?.role === Role.ADMIN ? user : null;
}
