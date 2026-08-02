import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { previewImport, normalizePhone, phoneFromJid, validCountry, validateManualAddressBookContact } from "../lib/address-book";
import { canLinkAddressBookContact, canManageAddressBook } from "../lib/authorization";
import { addressBookPage, firstAddressBookPageSize, subsequentAddressBookPageSize } from "../lib/address-book-list";

describe("hybrid address book", () => {
  it("normalizes direct WhatsApp identities and imported phones", () => {
    expect(phoneFromJid("34600000000@s.whatsapp.net")).toBe("+34600000000");
    expect(phoneFromJid("123@g.us")).toBeNull();
    expect(normalizePhone("600 000 000", "ES")).toBe("+34600000000");
    expect(normalizePhone("not-a-phone", "ES")).toBeNull();
    expect(validCountry("ES")).toBe("ES");
    expect(validCountry("es")).toBeNull();
    expect(validCountry("ZZ")).toBeNull();
  });

  it("creates an idempotent preview and identifies duplicate rows", async () => {
    const preview = await previewImport("agenda.csv", Buffer.from("nombre,telefono,empresa\nAna,600000000,Acme\nOtra,600000000,Acme\n"), "ES");
    expect(preview.rows[0]).toMatchObject({ normalizedPhone: "+34600000000", action: "CREATE" });
    expect(preview.rows[1]).toMatchObject({ action: "SKIP" });
    expect(preview.fileHash).toHaveLength(64);
  });

  it("accepts the documented XLSX template without evaluating formulas", async () => {
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Agenda");
    sheet.addRow(["nombre", "telefono"]); sheet.addRow(["Ana", "600000000"]); sheet.addRow([{ formula: "NOW()" }, "611111111"]);
    const preview = await previewImport("agenda.xlsx", Buffer.from(await workbook.xlsx.writeBuffer()), "ES");
    expect(preview.rows[0].action).toBe("CREATE");
    expect(preview.rows[1].action).toBe("ERROR");
  });

  it("keeps viewers read-only while agents may link existing contacts", () => {
    expect(canManageAddressBook("ADMIN")).toBe(true);
    expect(canManageAddressBook("AGENT")).toBe(false);
    expect(canLinkAddressBookContact("AGENT")).toBe(true);
    expect(canLinkAddressBookContact("VIEWER")).toBe(false);
  });

  it("validates a manual contact with the account country", () => {
    expect(validateManualAddressBookContact({ nombre: "Ana", telefono: "600 000 000", email: "ana@example.com", empresa: "Acme" }, "ES")).toMatchObject({ displayName: "Ana", normalizedPhone: "+34600000000" });
    expect(validateManualAddressBookContact({ nombre: "<script>", telefono: "600000000" }, "ES")).toBeNull();
    expect(validateManualAddressBookContact({ nombre: "Ana", telefono: "600000000", email: "incorrecto" }, "ES")).toBeNull();
  });

  it("loads all address-book pages without dropping the first contact of the next page", () => {
    expect(firstAddressBookPageSize).toBe(100);
    expect(subsequentAddressBookPageSize).toBe(50);
    expect(addressBookPage([{ id: "a" }, { id: "b" }, { id: "c" }], 2)).toEqual({ rows: [{ id: "a" }, { id: "b" }], nextCursor: "b" });
  });
});
