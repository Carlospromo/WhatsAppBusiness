const required = ["DATABASE_URL", "AUTH_SECRET", "INITIAL_ADMIN_EMAIL", "INITIAL_ADMIN_PASSWORD", "INITIAL_ADMIN_NAME"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  throw new Error(`Faltan variables de entorno requeridas: ${missing.join(", ")}`);
}
if (process.env.AUTH_SECRET.length < 32) {
  throw new Error("AUTH_SECRET debe contener al menos 32 caracteres.");
}
if (!process.env.WA_AUTH_DIR) {
  throw new Error("WA_AUTH_DIR es obligatorio y debe estar dentro del volumen persistente /data en Railway.");
}
const mediaRequired = ["MEDIA_STORAGE", "R2_BUCKET", "R2_ACCOUNT_ID", "R2_ENDPOINT", "R2_REGION", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "MEDIA_ENCRYPTION_KEY", "MEDIA_MAX_IMAGE_BYTES", "MEDIA_MAX_AUDIO_BYTES", "MEDIA_MAX_VIDEO_BYTES"];
const missingMedia = mediaRequired.filter((name) => !process.env[name]);
if (missingMedia.length) throw new Error(`Faltan variables de medios requeridas: ${missingMedia.join(", ")}`);
if (process.env.MEDIA_STORAGE !== "r2") throw new Error("MEDIA_STORAGE debe ser r2.");
if (!process.env.R2_ENDPOINT.startsWith("https://") || !process.env.R2_ENDPOINT.endsWith(".r2.cloudflarestorage.com")) throw new Error("R2_ENDPOINT debe ser un endpoint HTTPS de Cloudflare R2.");
const mediaKey = Buffer.from(process.env.MEDIA_ENCRYPTION_KEY, "base64");
if (mediaKey.length !== 32 || mediaKey.toString("base64") !== process.env.MEDIA_ENCRYPTION_KEY) throw new Error("MEDIA_ENCRYPTION_KEY debe ser una clave Base64 de 32 bytes.");
for (const name of ["MEDIA_MAX_IMAGE_BYTES", "MEDIA_MAX_AUDIO_BYTES", "MEDIA_MAX_VIDEO_BYTES"]) {
  const value = Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} debe ser un entero positivo.`);
}
function optionalSeconds(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} debe ser un número entero de segundos.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} debe estar entre ${minimum} y ${maximum} segundos.`);
  return value;
}
const connectionMode = process.env.WA_CONNECTION_MODE || "continuous";
if (connectionMode !== "continuous" && connectionMode !== "periodic") throw new Error("WA_CONNECTION_MODE debe ser continuous o periodic.");
optionalSeconds("WA_ACCOUNT_CHECK_SECONDS", 15, 5, 300);
optionalSeconds("WA_LINK_WINDOW_SECONDS", 120, 30, 600);
for (const [name, fallback, minimum, maximum] of [
  ["WA_OUTBOUND_MAX_PENDING", 20, 1, 500],
  ["WA_OUTBOUND_MAX_PER_MINUTE", 6, 1, 60],
  ["WA_OUTBOUND_MIN_INTERVAL_SECONDS", 5, 1, 300],
  ["WA_OUTBOUND_MAX_NEW_CHATS_PER_DAY", 10, 1, 100],
]) optionalSeconds(name, fallback, minimum, maximum);
if (connectionMode === "periodic") {
  const syncInterval = optionalSeconds("WA_SYNC_INTERVAL_SECONDS", 300, 60, 86_400);
  const syncWindow = optionalSeconds("WA_SYNC_WINDOW_SECONDS", 45, 10, 900);
  const syncConnectTimeout = optionalSeconds("WA_SYNC_CONNECT_TIMEOUT_SECONDS", 45, 15, 900);
  if (syncWindow + syncConnectTimeout > syncInterval) throw new Error("WA_SYNC_WINDOW_SECONDS más WA_SYNC_CONNECT_TIMEOUT_SECONDS no puede superar WA_SYNC_INTERVAL_SECONDS.");
}
