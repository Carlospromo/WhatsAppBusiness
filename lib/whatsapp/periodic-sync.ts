export type PeriodicSyncConfig = {
  mode: "continuous" | "periodic";
  intervalMs: number;
  windowMs: number;
  connectTimeoutMs: number;
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
  const configuredMode = environment.WA_CONNECTION_MODE ?? "continuous";
  if (configuredMode !== "continuous" && configuredMode !== "periodic") {
    throw new Error("WA_CONNECTION_MODE debe ser continuous o periodic.");
  }
  const mode = configuredMode;
  const accountCheckSeconds = secondsFromEnvironment(environment, "WA_ACCOUNT_CHECK_SECONDS", 15, 5, 300);
  const linkWindowSeconds = secondsFromEnvironment(environment, "WA_LINK_WINDOW_SECONDS", 120, 30, 600);

  if (mode === "continuous") {
    return {
      mode,
      intervalMs: 0,
      windowMs: 0,
      connectTimeoutMs: 0,
      accountCheckMs: accountCheckSeconds * SECOND,
      linkWindowMs: linkWindowSeconds * SECOND,
    };
  }

  const intervalSeconds = secondsFromEnvironment(environment, "WA_SYNC_INTERVAL_SECONDS", 300, 60, 86_400);
  const windowSeconds = secondsFromEnvironment(environment, "WA_SYNC_WINDOW_SECONDS", 45, 10, 900);
  const connectTimeoutSeconds = secondsFromEnvironment(environment, "WA_SYNC_CONNECT_TIMEOUT_SECONDS", 45, 15, 900);

  if (windowSeconds + connectTimeoutSeconds > intervalSeconds) {
    throw new Error("WA_SYNC_WINDOW_SECONDS más WA_SYNC_CONNECT_TIMEOUT_SECONDS no puede superar WA_SYNC_INTERVAL_SECONDS.");
  }

  return {
    mode,
    intervalMs: intervalSeconds * SECOND,
    windowMs: windowSeconds * SECOND,
    connectTimeoutMs: connectTimeoutSeconds * SECOND,
    accountCheckMs: accountCheckSeconds * SECOND,
    linkWindowMs: linkWindowSeconds * SECOND,
  };
}

/** A linked account is opened only in a scheduled window or for an explicit QR request. */
export function canOpenSocket(mode: PeriodicSyncConfig["mode"], scheduledWindowActive: boolean, explicitLinkRequested: boolean) {
  return mode === "continuous" || scheduledWindowActive || explicitLinkRequested;
}
