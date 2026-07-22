/** Manual messages are never retried automatically after a relay result. */
export const MAX_OUTBOUND_ATTEMPTS = 3;
export const OUTBOUND_CONFIRMATION_TIMEOUT_MS = 15 * 60 * 1_000;
export const OUTBOUND_CONFIRMATION_TIMEOUT_MESSAGE = "WhatsApp no confirmó el envío a tiempo. No se reintentó para evitar duplicados.";
