# WhatsAppBusiness

Panel privado para gestionar una cuenta de WhatsApp. Esta primera fase implementa la base segura del proyecto; todavía no conecta con WhatsApp ni incorpora la bandeja de mensajes.

## Contenido de la Fase 1

- Next.js con TypeScript y una interfaz mínima.
- Usuarios con roles `ADMIN`, `AGENT` y `VIEWER`.
- Inicio y cierre de sesión mediante tokens aleatorios, cookies `HttpOnly`, `SameSite=Lax` y almacenamiento del hash de sesión en SQLite.
- Contraseñas protegidas con Argon2id.
- Auditoría de creación del administrador inicial, inicio y cierre de sesión.
- Prisma, migración inicial, pruebas, Docker y configuración de Railway.
- Worker persistente para vincular WhatsApp por QR e importar contactos y mensajes nuevos de texto.

## Desarrollo local

Requiere Node.js 20 o superior.

```bash
npm install
cp .env.example .env
# Edita .env con valores propios y seguros.
npm run db:migrate
npm run db:seed
npm run dev
```

Abre `http://localhost:3000`. El primer `db:seed` crea un administrador únicamente si la base de datos no contiene usuarios.

Comprobaciones disponibles:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Variables de entorno

| Variable | Descripción |
| --- | --- |
| `DATABASE_URL` | Desarrollo: `file:./dev.db`. Railway: `file:/data/app.db`. |
| `AUTH_SECRET` | Secreto aleatorio de, al menos, 32 caracteres para proteger los hashes de sesión. |
| `INITIAL_ADMIN_EMAIL` | Correo del primer administrador. |
| `INITIAL_ADMIN_PASSWORD` | Contraseña inicial; nunca se registra ni se guarda en texto plano. |
| `INITIAL_ADMIN_NAME` | Nombre del primer administrador. |
| `NODE_ENV` | `development` o `production`. |
| `PORT` | Puerto proporcionado por Railway; la aplicación lo usa automáticamente. |
| `WA_AUTH_DIR` | Ruta de la sesión vinculada. En Railway: `/data/wa-auth`. |
| `LOG_LEVEL` | Nivel de log técnico; nunca registra mensajes, QR, números completos ni tokens. |

## Despliegue en Railway

1. Crea un proyecto Railway desde este repositorio privado y selecciona la rama `main` cuando la fase se integre.
2. Railway detectará el `Dockerfile` y construirá la aplicación.
3. Añade un volumen de **1 GB** y móntalo en `/data`. Usa una sola réplica: la sesión vinculada no admite varios workers simultáneos.
4. Configura `DATABASE_URL=file:/data/app.db`, `WA_AUTH_DIR=/data/wa-auth` y el resto de variables de entorno requeridas.
5. Configura `/api/health` como *healthcheck*; `railway.toml` ya lo declara.
6. En cada arranque, el contenedor valida las variables, aplica migraciones y crea el administrador inicial de forma idempotente antes de iniciar Next.js.

El volumen no se monta durante el build: las migraciones se ejecutan únicamente al arrancar el contenedor. Railway debe conservar `/data` entre despliegues para la base de datos y la sesión vinculada. El worker no sincroniza historial completo: importa contactos y mensajes nuevos tras la vinculación; no descarga medios ni envía mensajes.

## Seguridad de datos

No versionar ni compartir nunca `.env`, `dev.db`, `/data`, sesiones de WhatsApp ni credenciales. Todos están incluidos en `.gitignore`. Usa secretos de Railway para producción y realiza copias de seguridad del volumen antes de cambios importantes.
