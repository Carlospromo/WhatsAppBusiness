import { Role } from "@prisma/client";
export const tagColors = ["slate", "blue", "emerald", "amber", "rose"] as const;
export function canCollaborate(role: Role) { return role === Role.ADMIN || role === Role.AGENT; }
export function validNote(value: unknown) { if (typeof value !== "string") return null; const text=value.trim(); return text && text.length <= 2000 ? text : null; }
export function validTag(value: unknown, color: unknown) { if (typeof value !== "string") return null; const name=value.trim(); if (!name || name.length > 40 || !/^[\p{L}\p{N} _-]+$/u.test(name)) return null; return { name, color: typeof color === "string" && tagColors.includes(color as typeof tagColors[number]) ? color : null }; }
