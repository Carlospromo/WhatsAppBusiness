import { describe, expect, it } from "vitest";
import { canCollaborate, validNote, validTag } from "../lib/collaboration";
describe("collaboration safeguards",()=>{
  it("keeps viewers read-only",()=>expect(canCollaborate("VIEWER")).toBe(false));
  it("accepts only safe notes and tag colours",()=>{expect(validNote(" interna ")).toBe("interna");expect(validNote(" ")).toBeNull();expect(validTag("Pendiente","emerald")).toEqual({name:"Pendiente",color:"emerald"});expect(validTag("<script>","red")).toBeNull();});
});
