import { describe, expect, it } from "vitest";
import { safetyAlerts } from "../lib/admin/audit-dashboard";

describe("audit safety dashboard", () => {
  it("raises only safe, aggregate operational alerts", () => {
    const alerts = safetyAlerts({
      accounts: { active: 2, connected: 2, restricted: 1 },
      outbound: { pending: 0, sending: 0, failedLast24Hours: 0, stuckSending: 2, acknowledgedLast24Hours: 0, rejectedLast24Hours: 3 },
      readReceipts: { failedLast24Hours: 1 },
    });
    expect(alerts.map((alert) => alert.title)).toEqual(expect.arrayContaining(["Envíos restringidos", "Envíos atascados", "Entregas rechazadas", "Lecturas pendientes"]));
    expect(JSON.stringify(alerts)).not.toMatch(/@s\.whatsapp\.net|@lid|\+\d{6}/);
  });

  it("reports a calm state when no operational warning exists", () => {
    expect(safetyAlerts({
      accounts: { active: 1, connected: 1, restricted: 0 },
      outbound: { pending: 0, sending: 0, failedLast24Hours: 0, stuckSending: 0, acknowledgedLast24Hours: 0, rejectedLast24Hours: 0 },
      readReceipts: { failedLast24Hours: 0 },
    })).toEqual([{ level: "info", title: "Sin alertas operativas", detail: "No hay restricciones ni fallos de entrega recientes registrados." }]);
  });
});
