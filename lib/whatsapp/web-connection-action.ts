export type WebConnectionAction = "retry" | "relink";

/**
 * Relinking is destructive because the worker removes the account's LocalAuth
 * directory. Keep that action opt-in; old callers that do not explicitly ask
 * to relink become safe retries.
 */
export function requestedWebConnectionAction(payload: { action?: unknown; relink?: unknown }): WebConnectionAction {
  return payload.action === "relink" || payload.relink === true ? "relink" : "retry";
}
