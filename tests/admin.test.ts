import { describe, expect, it } from "vitest";
import { requireAdminRole, validUserInput } from "../lib/admin";
describe("admin safeguards",()=>{it("limits administration to admins",()=>{expect(requireAdminRole("ADMIN")).toBe(true);expect(requireAdminRole("AGENT")).toBe(false);});it("validates temporary user credentials",()=>{expect(validUserInput({email:"a@example.com",name:"Ana",password:"123456789012",role:"AGENT"})?.role).toBe("AGENT");expect(validUserInput({email:"bad",name:"",password:"short",role:"ADMIN"})).toBeNull();});});
