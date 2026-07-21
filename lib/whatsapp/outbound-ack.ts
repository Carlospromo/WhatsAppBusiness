export type OutboundAckOutcome = "PENDING" | "ACKNOWLEDGED" | "REJECTED";

/**
 * Kept separate from the socket so protocol-state handling can be tested
 * without opening a WhatsApp connection.
 */
export function outboundAckOutcome(status: number | undefined, errorStatus: number, serverAckStatus: number): OutboundAckOutcome {
  if (status === errorStatus) return "REJECTED";
  if (typeof status === "number" && status >= serverAckStatus) return "ACKNOWLEDGED";
  return "PENDING";
}
