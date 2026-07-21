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

/** Only codes with a documented, actionable meaning are retained in logs. */
export function safeOutboundRejectionCode(parameters: readonly unknown[] | null | undefined) {
  const code = parameters?.[0];
  return code === "463" || code === 463 || code === "479" || code === 479 ? Number(code) : undefined;
}

export function safeOutboundRejectionMessage(code: number | undefined) {
  if (code === 463) return "WhatsApp ha restringido el envío desde este dispositivo vinculado.";
  if (code === 479) return "WhatsApp rechazó la sesión de envío para este destinatario.";
  return "WhatsApp no pudo entregar el mensaje.";
}
