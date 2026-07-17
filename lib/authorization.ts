import { Role } from "@prisma/client";

export const canManageUsers = (role: Role) => role === Role.ADMIN;
export const canSendMessages = (role: Role) =>
  role === Role.ADMIN || role === Role.AGENT;
export const canManageMessages = canSendMessages;
