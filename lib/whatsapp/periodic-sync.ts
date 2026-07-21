export type PeriodicSyncConfig = {
  intervalMs: number;
  windowMs: number;
  accountCheckMs: number;
  linkWindowMs: number;
};

type Environment = Record<string, string | undefined>;

const SECOND = 1_000;

function secondsFromEnvironment(
  environment: Environment,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const raw = environment[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} debe ser un número entero de segundos.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} debe estar entre ${minimum} y ${maximum} segundos.`);
  }
  return value;
}

/**
 * The worker keeps no WebSocket open between these windows. Defaults favour
 * low resource use while keeping the maximum normal delay bounded to 5 min.
 */
export function periodicSyncConfig(environment: Environment = process.env): PeriodicSyncConfig {
  const intervalSeconds = secondsFromEnvironment(environment, "WA_SYNC_INTERVAL_SECONDS", 300, 60, 86_400);
  const windowSeconds = secondsFromEnvironment(environment, "WA_SYNC_WINDOW_SECONDS", 45, 10, 900);
  const accountCheckSeconds = secondsFromEnvironment(environment, "WA_ACCOUNT_CHECK_SECONDS", 15, 5, 300);
  const linkWindowSeconds = secondsFromEnvironment(environment, "WA_LINK_WINDOW_SECONDS", 120, 30, 600);

  if (windowSeconds >= intervalSeconds) {
    throw new Error("WA_SYNC_WINDOW_SECONDS debe ser menor que WA_SYNC_INTERVAL_SECONDS.");
  }

  return {
    intervalMs: intervalSeconds * SECOND,
    windowMs: windowSeconds * SECOND,
    accountCheckMs: accountCheckSeconds * SECOND,
    linkWindowMs: linkWindowSeconds * SECOND,
  };
}

/** A linked account is opened only in a scheduled window or for an explicit QR request. */
export function canOpenSocket(scheduledWindowActive: boolean, explicitLinkRequested: boolean) {
  return scheduledWindowActive || explicitLinkRequested;
}
