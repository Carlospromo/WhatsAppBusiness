import { createHash } from "node:crypto";

type SafeFields = Record<string, string | number | boolean | null | undefined>;

function logLevel() {
  return String(process.env.LOG_LEVEL ?? "info").toLowerCase();
}

export function safeLogRef(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/** Extract only stable transport metadata. Never expose raw error messages,
 * stacks, WhatsApp identifiers, message content, credentials or URLs. */
export function safeErrorInfo(error: unknown): SafeFields {
  const source = error && typeof error === "object" ? error as { name?: unknown; code?: unknown; message?: unknown; output?: { statusCode?: unknown } } : {};
  const name = typeof source.name === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(source.name) ? source.name : typeof error === "string" ? "Error" : "unknown";
  const code = typeof source.code === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(source.code) ? source.code : undefined;
  const status = typeof source.output?.statusCode === "number" && Number.isInteger(source.output.statusCode) && source.output.statusCode >= 100 && source.output.statusCode <= 599 ? source.output.statusCode : undefined;
  const message = typeof source.message === "string" ? source.message : typeof error === "string" ? error : "";
  const category = /ready timeout/i.test(message)
    ? "WWEBJS_READY_TIMEOUT"
    : /auth timeout/i.test(message)
      ? "WWEBJS_AUTH_TIMEOUT"
      : /target closed|session closed/i.test(message)
        ? "BROWSER_CLOSED"
        : /sandbox|namespace/i.test(message)
          ? "BROWSER_SANDBOX"
            : /navigation timeout/i.test(message)
              ? "BROWSER_NAVIGATION_TIMEOUT"
              : /execution context|detached frame/i.test(message)
                ? "BROWSER_CONTEXT_LOST"
                : /protocol error/i.test(message)
                  ? "BROWSER_PROTOCOL"
                  : /cannot read properties of undefined|is not a function/i.test(message)
                    ? "WWEBJS_INJECTION_FAILED"
                    : undefined;
  // A one-way digest lets operators correlate recurring failures without
  // putting a browser/WhatsApp error (which can include private data) in logs.
  const errorFingerprint = message ? createHash("sha256").update(message).digest("hex").slice(0, 12) : undefined;
  return { errorType: name, errorCode: code, statusCode: status, errorCategory: category, errorFingerprint };
}

export function operationalLog(event: string, fields: SafeFields = {}, level: "info" | "debug" | "error" = "info") {
  if (level === "debug" && !["debug", "trace"].includes(logLevel())) return;
  const output = JSON.stringify({ component: "whatsapp-business", event, ...fields });
  if (level === "error") console.error(output);
  else console.info(output);
}
