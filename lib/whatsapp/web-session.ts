import { access } from "node:fs/promises";
import { join } from "node:path";

export function webSessionClientId(accountId: string) {
  return accountId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function webSessionProfilePath(accountId: string, authRoot = process.env.WA_WEB_AUTH_DIR || "/data/wwebjs-auth") {
  return join(authRoot, `session-${webSessionClientId(accountId)}`);
}

/**
 * This is intentionally only a filesystem-presence check. It never reads a
 * profile and it does not claim that WhatsApp will still accept the session.
 */
export async function hasWebSessionProfile(accountId: string, authRoot?: string) {
  try {
    await access(webSessionProfilePath(accountId, authRoot));
    return true;
  } catch {
    return false;
  }
}
