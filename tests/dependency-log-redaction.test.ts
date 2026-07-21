import { describe, expect, it } from "vitest";
import { installDependencySessionLogRedaction, isSensitiveDependencySessionLog } from "../lib/whatsapp/dependency-log-redaction";

describe("dependency session log redaction", () => {
  it("recognizes logs that can include libsignal session keys", () => {
    expect(isSensitiveDependencySessionLog(["Closing session:", { privKey: "must-not-log" }])).toBe(true);
    expect(isSensitiveDependencySessionLog(["Closing open session in favor of incoming prekey bundle"])).toBe(true);
  });

  it("keeps ordinary structured operational logs available", () => {
    expect(isSensitiveDependencySessionLog(["outbound.relay_accepted", { status: "SENDING" }])).toBe(false);
  });

  it("suppresses only the unsafe dependency output", () => {
    const output: unknown[][] = [];
    const target = {
      info: (...args: unknown[]) => output.push(args),
      warn: (...args: unknown[]) => output.push(args),
    };
    installDependencySessionLogRedaction(target);
    target.info("Closing session:", { privKey: "must-not-log" });
    target.info("outbound.relay_accepted", { status: "SENDING" });
    expect(output).toEqual([["outbound.relay_accepted", { status: "SENDING" }]]);
  });
});
