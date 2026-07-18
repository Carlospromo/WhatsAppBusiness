import { Role } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { canManageAccounts, canManageUsers, canSendMessages } from "../lib/authorization";

describe("authorization", () => {
  it("limits user management to administrators", () => {
    expect(canManageUsers(Role.ADMIN)).toBe(true);
    expect(canManageUsers(Role.AGENT)).toBe(false);
    expect(canManageUsers(Role.VIEWER)).toBe(false);
  });

  it("limits account creation, deactivation and linking to administrators", () => {
    expect(canManageAccounts(Role.ADMIN)).toBe(true);
    expect(canManageAccounts(Role.AGENT)).toBe(false);
    expect(canManageAccounts(Role.VIEWER)).toBe(false);
  });

  it("allows only operators to send messages", () => {
    expect(canSendMessages(Role.ADMIN)).toBe(true);
    expect(canSendMessages(Role.AGENT)).toBe(true);
    expect(canSendMessages(Role.VIEWER)).toBe(false);
  });
});
