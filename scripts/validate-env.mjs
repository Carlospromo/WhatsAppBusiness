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
