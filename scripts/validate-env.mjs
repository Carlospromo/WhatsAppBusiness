const required = ["DATABASE_URL", "AUTH_SECRET", "INITIAL_ADMIN_EMAIL", "INITIAL_ADMIN_PASSWORD", "INITIAL_ADMIN_NAME", "WA_WEB_AUTH_DIR"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`Faltan variables de entorno requeridas: ${missing.join(", ")}`);
if (process.env.AUTH_SECRET.length < 32) throw new Error("AUTH_SECRET debe contener al menos 32 caracteres.");
if (process.env.NODE_ENV === "production" && !process.env.WA_WEB_AUTH_DIR.startsWith("/data/")) throw new Error("WA_WEB_AUTH_DIR debe estar dentro del volumen persistente /data en producciÃ³n.");
if (process.env.PUPPETEER_NO_SANDBOX && !["true", "false"].includes(process.env.PUPPETEER_NO_SANDBOX)) throw new Error("PUPPETEER_NO_SANDBOX debe ser true o false.");

const mediaRequired = ["MEDIA_STORAGE", "R2_BUCKET", "R2_ACCOUNT_ID", "R2_ENDPOINT", "R2_REGION", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
const missingMedia = mediaRequired.filter((name) => !process.env[name]);
if (missingMedia.length) throw new Error(`Faltan variables de medios requeridas: ${missingMedia.join(", ")}`);
if (process.env.MEDIA_STORAGE !== "r2") throw new Error("MEDIA_STORAGE debe ser r2.");
if (!process.env.R2_ENDPOINT.startsWith("https://") || !process.env.R2_ENDPOINT.endsWith(".r2.cloudflarestorage.com")) throw new Error("R2_ENDPOINT debe ser un endpoint HTTPS de Cloudflare R2.");

function positiveInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} debe ser un número entero.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} debe estar entre ${minimum} y ${maximum}.`);
  return value;
}

positiveInteger("WA_ACCOUNT_CHECK_SECONDS", 15, 5, 300);
positiveInteger("WA_WEB_CLIENT_READY_TIMEOUT_SECONDS", 120, 30, 600);
positiveInteger("WA_WEB_READY_PROBE_DELAY_SECONDS", 25, 5, 90);
positiveInteger("WA_WEB_HEALTHCHECK_SECONDS", 60, 15, 300);
positiveInteger("WA_WEB_INBOUND_RECONCILE_SECONDS", 30, 10, 300);
positiveInteger("WA_WEB_INBOUND_RECONCILE_LIMIT", 25, 1, 100);
positiveInteger("WA_WEB_MAX_MEDIA_BYTES", 25 * 1024 * 1024, 1, 40 * 1024 * 1024);
positiveInteger("WA_WEB_MAX_IMAGE_BYTES", 10 * 1024 * 1024, 1, 40 * 1024 * 1024);
positiveInteger("WA_WEB_MAX_AUDIO_BYTES", 20 * 1024 * 1024, 1, 40 * 1024 * 1024);
positiveInteger("WA_WEB_MAX_VIDEO_BYTES", 25 * 1024 * 1024, 1, 40 * 1024 * 1024);
for (const [name, fallback, minimum, maximum] of [
  ["WA_OUTBOUND_MAX_PENDING", 20, 1, 500],
  ["WA_OUTBOUND_MAX_PER_MINUTE", 6, 1, 60],
  ["WA_OUTBOUND_MIN_INTERVAL_SECONDS", 5, 1, 300],
  ["WA_OUTBOUND_MAX_NEW_CHATS_PER_DAY", 10, 1, 100],
]) positiveInteger(name, fallback, minimum, maximum);
