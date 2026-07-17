import { Role } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { hashPassword } from "../lib/password";

async function main() {
  const users = await prisma.user.count();
  if (users > 0) return;

  const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  const name = process.env.INITIAL_ADMIN_NAME?.trim();
  if (!email || !password || !name) {
    throw new Error(
      "No hay usuarios: define INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_PASSWORD e INITIAL_ADMIN_NAME para crear el administrador inicial.",
    );
  }

  const user = await prisma.user.create({
    data: { email, name, passwordHash: await hashPassword(password), role: Role.ADMIN },
  });
  await prisma.auditLog.create({
    data: { userId: user.id, action: "ADMIN_INITIAL_CREATED", entity: "User", entityId: user.id },
  });
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "No se pudo crear el administrador inicial.");
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
