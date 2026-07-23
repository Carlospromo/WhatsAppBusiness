# WhatsAppBusiness

Aplicación privada para gestionar varias cuentas de WhatsApp desde una bandeja web. Incluye agenda híbrida, roles, notas, etiquetas, auditoría, envío manual, recibos de lectura, medios entrantes y almacenamiento privado.

## Bridge de WhatsApp

El worker usa [`whatsapp-web.js` 1.34.7](https://github.com/wwebjs/whatsapp-web.js), fijada sin rangos, y un navegador Chromium real. Sustituye al bridge anterior para que el worker use APIs públicas del cliente de WhatsApp Web mediante un proceso ESM compilado (`node dist/worker/worker.js`), nunca `tsx` en producción.

`whatsapp-web.js` no es un producto oficial de WhatsApp: no garantiza la aceptación de un envío ni evita restricciones que aplique WhatsApp. La aplicación solo permite acciones manuales de usuarios autorizados; no incluye respuestas automáticas, campañas, difusión ni envío masivo.

La recepción fiable requiere mantener el cliente conectado. Cuando el cliente queda listo, el worker solicita presencia no disponible; esto no garantiza cómo WhatsApp mostrará la presencia a terceros.

La conexión se confirma normalmente con el evento `ready`. Como medida de compatibilidad para versiones de WhatsApp Web que emiten `authenticated` pero no `ready`, el worker consulta el estado público del cliente durante el arranque y solo habilita la cuenta si dicho estado confirma `CONNECTED`. Si ninguna de las dos comprobaciones lo consigue, la cuenta queda en error seguro y los logs muestran fases de conexión sin exponer datos privados.

## Funciones

- Múltiples cuentas aisladas con miembros y roles globales `ADMIN`, `AGENT` y `VIEWER`.
- Bandeja de conversaciones, contactos, agenda híbrida, notas, etiquetas y asignaciones.
- Envío manual con cola persistente, límites preventivos y confirmación mediante acuse del cliente web.
- Lectura sincronizada al abrir realmente una conversación, mediante cola persistente.
- Recepción de imágenes, audios y vídeos pequeños; PostgreSQL conserva metadatos y Cloudflare R2 privado almacena los archivos.
- Gestión administrativa, auditoría y panel de indicadores de operación.

## Persistencia y sesiones

| Ubicación | Contenido |
| --- | --- |
| PostgreSQL | Datos de dominio, mensajes, colas, agenda, auditoría y metadatos de medios. |
| Cloudflare R2 privado | Objetos de imagen, audio y vídeo. No se publica el bucket ni se usan URLs permanentes. |
| `/data/wwebjs-auth` | Perfiles `LocalAuth` de Chromium de cada cuenta (`session-<accountId>`). Son secretos. |
| `/data/wa-auth` | Sesiones heredadas del bridge anterior. Se conservan intactas y el worker nuevo no las usa. |

Cada cuenta debe volver a vincularse mediante QR. No se convierten ni copian sesiones heredadas. Desde la integración, una desvinculación explícita y confirmada borra solo el perfil web de esa cuenta, nunca el de otra cuenta ni el directorio heredado.

Las identidades externas de conversación permiten enlazar chats de WhatsApp Web (`<teléfono>@c.us` y `<id>@g.us`) con conversaciones ya existentes, para no duplicar el histórico anterior.

## Desarrollo local

1. Copia `.env.example` a `.env` y completa las variables. Para desarrollo se puede usar un directorio local, por ejemplo `WA_WEB_AUTH_DIR=./.local/wwebjs-auth`.
2. Inicia PostgreSQL con `docker compose -f docker-compose.dev.yml up -d`.
3. Instala dependencias y prepara Prisma:

   ```bash
   npm ci
   npx prisma generate
   npm run db:migrate
   npm run db:seed
   ```

4. Instala Chromium localmente o define `PUPPETEER_EXECUTABLE_PATH` con la ruta de Chrome/Chromium. Después ejecuta:

   ```bash
   npm run dev
   npm run worker:build
   npm run worker:verify
   ```

`worker:verify` importa el artefacto ESM real y abre/cierra Chromium en `about:blank`; no se conecta a WhatsApp ni requiere QR, PostgreSQL o R2.

## Variables

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | Conexión de PostgreSQL. En Railway: `${{Postgres.DATABASE_URL}}`. |
| `AUTH_SECRET` | Secreto de sesiones, mínimo 32 caracteres. |
| `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`, `INITIAL_ADMIN_NAME` | Administrador inicial del seed idempotente. |
| `WA_WEB_AUTH_DIR` | En Railway: `/data/wwebjs-auth`. |
| `PUPPETEER_EXECUTABLE_PATH` | En la imagen: `/usr/bin/chromium`. |
| `PUPPETEER_NO_SANDBOX` | `true` dentro de Railway porque su runtime bloquea los *namespaces* del sandbox de Chromium; en local debe permanecer `false` salvo necesidad equivalente. |
| `WA_WEB_CLIENT_READY_TIMEOUT_SECONDS` | Tiempo máximo de inicio del cliente (30–600). |
| `WA_ACCOUNT_CHECK_SECONDS` | Frecuencia de supervisión de cuentas activas (5–300). |
| `WA_WEB_MAX_MEDIA_BYTES`, `WA_WEB_MAX_IMAGE_BYTES`, `WA_WEB_MAX_AUDIO_BYTES`, `WA_WEB_MAX_VIDEO_BYTES` | Límites opcionales: global y por tipo para medios Base64. Si se omiten, se usan 25 MB globales, 10 MB para imágenes, 20 MB para audio y 25 MB para vídeo. |
| `WA_OUTBOUND_MAX_PENDING`, `WA_OUTBOUND_MAX_PER_MINUTE`, `WA_OUTBOUND_MIN_INTERVAL_SECONDS`, `WA_OUTBOUND_MAX_NEW_CHATS_PER_DAY` | Límites preventivos de envío manual. |
| `MEDIA_STORAGE=r2`, `R2_BUCKET`, `R2_ACCOUNT_ID`, `R2_ENDPOINT`, `R2_REGION`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Bucket R2 privado para medios. |
| `LOG_LEVEL` | Nivel de logs de aplicación. |

No reutilices `AUTH_SECRET` como clave de R2. No guardes variables reales en Git.

## Medios

Se aceptan únicamente imágenes, audio y vídeo de tamaño reducido. `whatsapp-web.js` entrega los medios como Base64, no como stream; por ello los límites son deliberadamente más bajos que los de una integración de streaming. Los estados, documentos, stickers, ubicaciones, llamadas, mensajes efímeros y “ver una vez” se descartan. Base64, claves, URL de WhatsApp, QR y perfiles nunca se almacenan en PostgreSQL.

R2 debe permanecer privado: no actives `r2.dev`, dominio público ni credenciales de lectura en el frontend. La ruta autenticada de medios genera acceso breve y no almacena URLs firmadas.

## Railway

1. Crea un servicio PostgreSQL y un servicio de esta aplicación desde GitHub.
2. Monta un único volumen en `/data` y configura `WA_WEB_AUTH_DIR=/data/wwebjs-auth`.
3. Configura `DATABASE_URL=${{Postgres.DATABASE_URL}}`, el resto de variables y el bucket R2 privado.
4. Despliega una sola réplica. Next.js y el worker comparten el mismo contenedor y el mismo volumen.
5. Configura `/api/health` como healthcheck público.

La imagen está basada en `node:22-bookworm-slim`, instala Chromium y `chromium-sandbox` de Debian y ejecuta Next.js y el worker como un usuario sin privilegios. El entrypoint prepara solo `/data/wwebjs-auth` para ese usuario; no modifica `/data/wa-auth`. No se inicia Chromium, no se aplican migraciones y no se escribe en `/data` durante el build.

El runtime de Railway bloquea los *namespaces* que necesita el sandbox de Chromium. Por ello la imagen activa explícitamente `PUPPETEER_NO_SANDBOX=true` y usa `--no-sandbox` junto con `--disable-setuid-sandbox`. Es una reducción de aislamiento del navegador: se compensa parcialmente ejecutando la aplicación como usuario sin privilegios, sin exponer el depurador de Chromium y manteniendo una sola réplica, pero no equivale al sandbox normal. No actives esos flags en desarrollo salvo que el entorno lo exija.

## Migración controlada

1. Prueba primero en otro servicio Railway, con PostgreSQL, volumen y cuenta de prueba nuevos.
2. No copies `/data/wa-auth` ni ejecutes el bridge antiguo y el nuevo sobre el mismo número.
3. Verifica QR, reinicio, recepción, envío manual a un chat conocido, acuse, lectura, imagen/audio/vídeo pequeño, roles y dos cuentas aisladas.
4. Antes de producción, realiza una copia de seguridad de PostgreSQL y conserva el volumen actual intacto.
5. Despliega una sola réplica y vincula cada cuenta una a una mediante QR.
6. Si falla, vuelve a la imagen anterior sin borrar `/data/wa-auth` ni los nuevos perfiles hasta diagnosticar el problema.

La recuperación manual de historial es solo para administradores, por cuenta y conversación, con rango, límites y deduplicación. WhatsApp Web no garantiza que conserve mensajes antiguos.

## Calidad y CI

```bash
npm ci
npx prisma generate
npm run lint
npm run typecheck
npm test
npm run build
npm run worker:build
npm run worker:verify
docker build -t whatsapp-business .
docker run --rm --entrypoint node whatsapp-business /app/scripts/verify-worker-esm.mjs
```

El flujo de CI hace la misma comprobación ESM y de Chromium, sin iniciar sesión de WhatsApp ni requerir credenciales de Railway o R2.

## Datos sensibles

No versiones `.env`, QR, perfiles de Chromium, `/data`, archivos multimedia, bases de datos, credenciales R2 ni sesiones. Los logs operativos solo usan referencias resumidas y no incluyen teléfonos, IDs de chat, contenido de mensajes, URLs, tokens o secretos.
