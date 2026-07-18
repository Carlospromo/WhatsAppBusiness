# WhatsAppBusiness

Panel privado para gestionar una cuenta de WhatsApp. La Fase 3 incorpora una bandeja web y agenda de contactos sobre la sincronización persistente de WhatsApp.

## Contenido de la Fase 1

- Next.js con TypeScript y una interfaz mínima.
- Usuarios con roles `ADMIN`, `AGENT` y `VIEWER`.
- Inicio y cierre de sesión mediante tokens aleatorios, cookies `HttpOnly`, `SameSite=Lax` y almacenamiento del hash de sesión en SQLite.
- Contraseñas protegidas con Argon2id.
- Auditoría de creación del administrador inicial, inicio y cierre de sesión.
- Prisma, migración inicial, pruebas, Docker y configuración de Railway.
- Worker persistente para vincular WhatsApp por QR e importar contactos y mensajes nuevos de texto.
- Bandeja responsive de conversaciones, filtros, búsqueda y contador de no leídos.
- Agenda de contactos sincronizados y envío manual de texto desde conversaciones existentes.
- Cola persistente en SQLite: la web solicita el envío y el worker lo procesa una sola vez.
- Gestión colaborativa: asignación de conversaciones, notas internas y etiquetas de clasificación.
- Administración segura de usuarios, auditoría consultable y estado operativo del MVP.

## Uso de la bandeja

En `/dashboard` se pueden buscar y filtrar conversaciones. Al abrir una, `ADMIN` y `AGENT` pueden marcar entradas como leídas y solicitar mensajes de texto; `VIEWER` solo tiene acceso de lectura. La agenda está disponible en `/dashboard/contactos`.

La Fase 3 se limita a texto manual en conversaciones ya existentes: no admite medios, difusión, automatizaciones, respuestas automáticas, asignaciones, notas internas ni IA.

## Colaboración y permisos

`ADMIN` puede asignar conversaciones, administrar etiquetas y eliminar notas. `AGENT` puede asignarse conversaciones, gestionar etiquetas existentes y escribir notas. `VIEWER` tiene acceso de solo lectura. Las notas y etiquetas son datos internos: nunca se envían a WhatsApp ni son procesadas por el worker.

La aplicación sigue sin automatizaciones, IA, campañas, respuestas automáticas ni medios.

## Administración y operación

Solo `ADMIN` puede gestionar usuarios, consultar auditoría, revisar el estado resumido y depurar logs antiguos de forma manual. Desactivar un usuario invalida sus sesiones. La instalación Railway debe mantenerse en una única réplica y conservar el volumen `/data`.

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
3. Añade un volumen de **1 GB** y móntalo en `/data`. Usa una sola réplica: la sesión vinculada y la cola de envíos no admiten varios workers simultáneos.
4. Configura `DATABASE_URL=file:/data/app.db`, `WA_AUTH_DIR=/data/wa-auth` y el resto de variables de entorno requeridas.
5. Configura `/api/health` como *healthcheck*; `railway.toml` ya lo declara.
6. En cada arranque, el contenedor valida las variables, aplica migraciones y crea el administrador inicial de forma idempotente antes de iniciar Next.js.

El volumen no se monta durante el build: las migraciones se ejecutan únicamente al arrancar el contenedor. Railway debe conservar `/data` entre despliegues para la base de datos y la sesión vinculada. El worker no sincroniza historial completo: importa contactos y mensajes nuevos tras la vinculación; no descarga medios ni envía mensajes.

## Seguridad de datos

No versionar ni compartir nunca `.env`, `dev.db`, `/data`, sesiones de WhatsApp ni credenciales. Todos están incluidos en `.gitignore`. Usa secretos de Railway para producción y realiza copias de seguridad del volumen antes de cambios importantes.

## Fase 6: múltiples cuentas y PostgreSQL

Cada cuenta tiene una sesión, QR, contactos, conversaciones, cola de envíos, etiquetas y estado aislados. Los administradores acceden a todas; agentes y lectores solo a cuentas con membresía. La bandeja permite seleccionar una cuenta o ver todas las autorizadas.

Los datos operativos se guardan en PostgreSQL. En Railway añade un servicio PostgreSQL y configura `DATABASE_URL=${{Postgres.DATABASE_URL}}`. El volumen `/data` solo conserva `WA_AUTH_DIR=/data/wa-auth`; usa una única réplica mientras web y worker se ejecuten en el mismo contenedor.

Para desarrollo local, ejecuta `docker compose -f docker-compose.dev.yml up -d`, configura `.env` y usa `npm run db:migrate`.

### Importación manual desde SQLite

Antes de cambiar una instalación existente, conserva una copia de `app.db`. Tras desplegar PostgreSQL y aplicar migraciones, ejecuta manualmente `LEGACY_SQLITE_DATABASE_URL=file:/ruta/app.db npm run db:import-legacy-sqlite`. El proceso es idempotente, invalida sesiones web y crea la cuenta `Cuenta principal`; no copia la sesión de WhatsApp, por lo que debe vincularse de nuevo con QR. Nunca ejecutes esta importación automáticamente ni elimines la copia SQLite hasta validar usuarios, conversaciones y mensajes.

## Fase 7: agenda híbrida

La agenda se almacena en PostgreSQL y está aislada por cuenta de WhatsApp. Combina tres orígenes:

- **Importado**: contactos cargados por un administrador desde CSV UTF-8 o Excel XLSX.
- **Sincronizado**: contactos técnicos que Baileys ya conoce desde WhatsApp Web.
- **Externo**: números nuevos que escriben un mensaje directo y no estaban en la agenda.

Los datos importados son siempre los visibles y no se sobrescriben con `pushName` ni otros metadatos de WhatsApp. Los datos de WhatsApp se conservan solamente para enlazar conversaciones e identidades técnicas.

Un administrador puede descargar la plantilla, crear una vista previa y confirmar la importación desde `/dashboard/administracion/agenda/importar`. La plantilla usa las columnas `nombre`, `telefono`, `apellidos`, `email`, `empresa` y `etiquetas`; solo `nombre` y `telefono` son obligatorios. El archivo no se conserva tras el análisis. El país de normalización se configura por cuenta, inicialmente `ES`.

La acción **Sincronizar contactos ya existentes** reconcilia de forma idempotente los contactos técnicos ya guardados, sin solicitar historial completo a WhatsApp ni realizar comprobaciones masivas de números. `ADMIN` importa y reconcilia; `AGENT` puede consultar y enlazar un contacto existente en sus cuentas; `VIEWER` solo lee.

No subas ni versionas archivos de agenda, `.env`, datos de PostgreSQL, QR o sesiones. La aplicación no conserva el fichero importado en `/data`; ese volumen sigue reservado exclusivamente para `WA_AUTH_DIR=/data/wa-auth` y se mantiene una sola réplica Railway.
