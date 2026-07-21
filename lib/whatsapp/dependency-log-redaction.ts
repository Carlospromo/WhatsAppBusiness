const SESSION_LOG_PREFIXES = [
  "Closing session:",
  "Opening session:",
  "Removing old closed session:",
  "Session already closed",
  "Closing open session in favor of incoming prekey bundle",
];

/**
 * libsignal v6 writes complete SessionEntry objects directly to the process
 * console. Those objects can contain private key material, so they must not
 * reach a platform log sink.
 */
export function isSensitiveDependencySessionLog(args: unknown[]) {
  return args.some((arg) => typeof arg === "string" && SESSION_LOG_PREFIXES.some((prefix) => arg.startsWith(prefix)));
}

export function installDependencySessionLogRedaction(target: Pick<Console, "info" | "warn"> = console) {
  for (const method of ["info", "warn"] as const) {
    const original = target[method].bind(target);
    target[method] = (...args: unknown[]) => {
      if (isSensitiveDependencySessionLog(args)) return;
      original(...args);
    };
  }
}
