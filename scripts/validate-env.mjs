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
