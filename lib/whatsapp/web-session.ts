import { access, lstat, rm } from "node:fs/promises";
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

/**
 * Chromium writes these process-lock entries at the root of its user-data
 * directory. A container replacement can leave them behind even though the
 * process that owned them has already stopped. They are not WhatsApp session
 * data; removing only these entries lets the next Chromium process reopen the
 * persisted LocalAuth profile.
 *
 * Call this only when the caller has established exclusive ownership of the
 * account profile (this worker uses one client per account and one replica).
 */
export async function clearStaleWebSessionLocks(accountId: string, authRoot?: string) {
  const profile = webSessionProfilePath(accountId, authRoot);
  const lockNames = ["SingletonLock", "SingletonCookie", "SingletonSocket"];
  let cleared = 0;
  for (const lockName of lockNames) {
    try {
      const lockPath = join(profile, lockName);
      await lstat(lockPath);
      await rm(lockPath, { force: true });
      cleared += 1;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
      // A permissions or filesystem error must stop startup rather than risk
      // silently changing any part of the profile.
      throw error;
    }
  }
  return cleared;
}
