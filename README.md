# WhatsAppBusiness

Panel privado para gestionar una cuenta de WhatsApp. Incluye una bandeja web y agenda de contactos sobre sincronización periódica de WhatsApp.

## Contenido de la Fase 1

- Next.js con TypeScript y una interfaz mínima.
- Usuarios con roles `ADMIN`, `AGENT` y `VIEWER`.
- Inicio y cierre de sesión mediante tokens aleatorios, cookies `HttpOnly`, `SameSite=Lax` y almacenamiento del hash de sesión en SQLite.
- Contraseñas protegidas con Argon2id.
- Auditoría de creación del administrador inicial, inicio y cierre de sesión.
- Prisma, migración inicial, pruebas, Docker y configuración de Railway.
- Worker de sincronización periódica para vincular WhatsApp por QR e importar contactos y mensajes nuevos.
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

Requiere Node.js 22 o superior.

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
| `DATABASE_URL` | URL de PostgreSQL. En Railway: `${{Postgres.DATABASE_URL}}`. |
| `AUTH_SECRET` | Secreto aleatorio de, al menos, 32 caracteres para proteger los hashes de sesión. |
| `INITIAL_ADMIN_EMAIL` | Correo del primer administrador. |
| `INITIAL_ADMIN_PASSWORD` | Contraseña inicial; nunca se registra ni se guarda en texto plano. |
| `INITIAL_ADMIN_NAME` | Nombre del primer administrador. |
| `NODE_ENV` | `development` o `production`. |
| `PORT` | Puerto proporcionado por Railway; la aplicación lo usa automáticamente. |
| `WA_AUTH_DIR` | Ruta de la sesión vinculada. En Railway: `/data/wa-auth`. |
| `LOG_LEVEL` | Nivel de log técnico. Con `info` se registran eventos operativos de conexión y salida; con `debug`, también esperas de cola. Nunca se registran mensajes, QR, números completos, JID, tokens ni URLs. |
| `WA_CONNECTION_MODE` | `continuous` (predeterminado) mantiene el socket vinculado para recepción en tiempo real, con presencia `unavailable` cuando está inactivo. `periodic` abre ventanas y no garantiza recuperar mensajes llegados fuera de ellas. |
| `WA_SYNC_INTERVAL_SECONDS` | Frecuencia de las ventanas de sincronización. Predeterminado: `300` (5 minutos). Debe ser de 60 a 86.400. |
| `WA_SYNC_WINDOW_SECONDS` | Tiempo adicional de procesamiento después de que Baileys haya confirmado la conexión y las notificaciones pendientes. Predeterminado: `45`. |
| `WA_SYNC_CONNECT_TIMEOUT_SECONDS` | Tiempo máximo reservado para abrir la conexión y recibir las notificaciones pendientes. Predeterminado: `45`. La suma con la ventana no puede superar el intervalo. |
| `WA_ACCOUNT_CHECK_SECONDS` | Frecuencia con que el worker detecta una solicitud explícita de QR o una cuenta desactivada, sin abrir sockets normales. Predeterminado: `15`. |
| `WA_LINK_WINDOW_SECONDS` | Tiempo máximo reservado a un QR solicitado explícitamente. Predeterminado: `120`. |

## Conexión de WhatsApp

La configuración predeterminada es `WA_CONNECTION_MODE=continuous`. El worker mantiene un socket por cuenta activa para recibir mensajes nuevos en tiempo real, pero usa `markOnlineOnConnect: false` y presencia `unavailable` mientras no está procesando un mensaje o un envío manual. Así se evita que la cuenta se anuncie como disponible de forma continua sin sacrificar la recepción.

El modo `periodic` es opcional y reduce el tiempo de conexión abriendo ventanas programadas. WhatsApp no garantiza que reenvíe a un dispositivo vinculado los mensajes que llegaron mientras estaba desconectado; por ello este modo no es apropiado cuando la prioridad es no perder mensajes.

## Modo periódico de WhatsApp

Para reducir consumo de recursos y no mantener dispositivos vinculados abiertos de forma permanente, el worker abre cada cuenta ya vinculada solo durante una ventana de sincronización. Con la configuración predeterminada, reserva hasta 45 segundos para conectar y recibir las notificaciones pendientes de WhatsApp; solo entonces inicia hasta 45 segundos adicionales de procesamiento. Entre ventanas no conserva sockets de WhatsApp abiertos.

Esto implica que un mensaje entrante, un envío manual, una descarga de medio o un recibo de lectura puede tardar hasta el siguiente ciclo. Las acciones se mantienen en PostgreSQL como solicitudes pendientes; no se descartan porque el socket esté cerrado. Una solicitud explícita de QR es la única excepción: el worker abre una ventana temporal inmediata para mostrarlo y escanearlo.

El estado `CONNECTED` en la interfaz significa que la cuenta sigue vinculada y preparada para el siguiente ciclo; no significa que exista un WebSocket abierto en ese instante. No configures un intervalo inferior a un minuto ni una suma de espera de conexión y ventana superior al intervalo.

## Despliegue en Railway

1. Crea un proyecto Railway desde este repositorio privado y selecciona la rama `main` cuando la fase se integre.
2. Railway detectará el `Dockerfile` y construirá la aplicación.
3. Añade un volumen y móntalo en `/data`. Usa una sola réplica: la sesión vinculada y la cola de envíos no admiten varios workers simultáneos.
4. Añade un servicio PostgreSQL y configura `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `WA_AUTH_DIR=/data/wa-auth` y el resto de variables de entorno requeridas.
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

## Gestión de cuentas y vinculación desde la web

El menú principal muestra las rutas disponibles para cada rol. Solo un `ADMIN` puede acceder a **Cuentas**, crear cuentas nuevas, conceder o retirar membresías y gestionar su vinculación desde el navegador.

Desde `/dashboard/administracion/cuentas` se crea una cuenta indicando un nombre y un identificador corto. La acción **Desactivar** es recuperable: detiene la conexión operativa de esa cuenta, la oculta del trabajo diario y elimina únicamente el QR temporal. Conserva los datos, mensajes, agenda y sesión de WhatsApp en `/data/wa-auth/<accountId>`. Al reactivarla, el worker vuelve a iniciarla; no existe borrado físico de cuentas ni de sus sesiones desde la interfaz.

Para vincular un número, abre **Vinculación**, selecciona la cuenta y pulsa **Solicitar vinculación**. Cuando aparezca el QR, en el teléfono abre WhatsApp, ve a **Dispositivos vinculados** y escanéalo. El QR solo se sirve a administradores autenticados, no se incorpora a URLs públicas ni se escribe en los registros de la aplicación.

Si una sesión queda desvinculada, un administrador puede solicitar una **nueva vinculación**. Esta acción reinicia únicamente las credenciales persistentes de esa cuenta y pide un nuevo escaneo; una desconexión transitoria no borra por sí misma ninguna sesión.

## Worker Baileys v7 y diagnostico de envios

El worker usa `@whiskeysockets/baileys` **7.0.0-rc13**, fijado sin rangos de versiones. La migracion sustituye la ejecucion anterior con `tsx worker.mts`, que en Railway fallaba al resolver `whatsapp-rust-bridge` como CommonJS, por un artefacto ESM compilado que se inicia con `node dist/worker/worker.js`.

Comprobaciones del worker:

```bash
npm run worker:build
npm run worker:verify
```

`worker:verify` importa exactamente el artefacto ESM de produccion sin conectar con WhatsApp ni PostgreSQL y debe escribir `worker-runtime-ok`. El Dockerfile ejecuta la misma comprobacion durante el build; CI tambien construye la imagen y vuelve a ejecutarla dentro del contenedor.

Baileys v7 conserva el JID de una conversacion existente y usa sus mecanismos internos de mapeo LID/PN; la aplicacion nunca inventa un numero a partir de un LID. El worker registra solo referencias hasheadas, el tipo de destino y las fases de entrega. Un acuse local no marca una solicitud como enviada: queda `SENDING` hasta recibir un acuse de servidor. Un rechazo se marca como fallido y no genera reintentos agresivos.

### Despliegue controlado

1. Prueba primero la rama en un servicio Railway aislado, con PostgreSQL, volumen `/data` y cuenta de WhatsApp de prueba propios.
2. No ejecutes v6 y v7 a la vez sobre una misma sesion ni compartas el volumen entre ambos servicios.
3. Comprueba vinculacion, recepcion, envio a conversaciones PN y LID, estados de cola y logs redactados.
4. Antes de produccion, realiza una copia de PostgreSQL y conserva el volumen `/data/wa-auth` intacto.
5. Despliega con una sola replica. Si el worker no llega a conectar o los rechazos son sistematicos, restaura la imagen anterior sin borrar la sesion.

Baileys v7 mejora compatibilidad tecnica, pero no garantiza que WhatsApp acepte un envio ni elimina restricciones aplicadas por WhatsApp. No versiones QR, numeros, mensajes, credenciales ni sesiones.

## Fase 8: medios entrantes privados

La aplicación guarda únicamente los medios **nuevos** recibidos tras desplegar esta fase: imágenes, audios o notas de voz y vídeos. Los medios se descargan desde el worker de WhatsApp y se muestran en el hilo correspondiente. Una imagen puede verse en línea; audios y vídeos usan los controles nativos del navegador. Nunca se reproducen automáticamente.

No se guardan documentos, stickers, GIFs, ubicaciones, estados, llamadas, medios enviados desde la web, mensajes de “ver una vez” ni mensajes efímeros. Todavía no se permite enviar adjuntos desde la interfaz.

Los archivos no se almacenan en PostgreSQL ni en el volumen Railway. PostgreSQL contiene solo metadatos y estados; el archivo se guarda en un bucket privado Cloudflare R2. El volumen `/data` continúa reservado solo para `WA_AUTH_DIR=/data/wa-auth`.

### Configurar Cloudflare R2

1. Crea un bucket privado Standard, por ejemplo `whatsimages`.
2. No habilites `r2.dev`, un dominio público ni listado público de objetos.
3. Crea una credencial R2 **Object Read & Write** limitada exclusivamente a ese bucket.
4. Si la interfaz usa URLs firmadas directamente, configura CORS con el origen exacto de la aplicación, los métodos `GET` y `HEAD`, y sin comodines.
5. Guarda las credenciales exclusivamente como variables de Railway.

| Variable | Uso |
| --- | --- |
| `MEDIA_STORAGE` | Debe ser `r2`. |
| `R2_BUCKET` | Nombre del bucket privado, por ejemplo `whatsimages`. |
| `R2_ACCOUNT_ID` | Identificador de la cuenta Cloudflare. |
| `R2_ENDPOINT` | `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`. |
| `R2_REGION` | `auto`. |
| `R2_ACCESS_KEY_ID` | Credencial R2 limitada al bucket. |
| `R2_SECRET_ACCESS_KEY` | Secreto R2; nunca se versiona ni registra. |
| `MEDIA_ENCRYPTION_KEY` | 32 bytes en Base64 para cifrar temporalmente los descriptores de recuperación. Generar con `openssl rand -base64 32`. |
| `MEDIA_MAX_IMAGE_BYTES` | Límite de imágenes, por defecto 20 MB. |
| `MEDIA_MAX_AUDIO_BYTES` | Límite de audio, por defecto 50 MB. |
| `MEDIA_MAX_VIDEO_BYTES` | Límite de vídeo, por defecto 250 MB. |

El worker procesa los adjuntos de forma secuencial por cuenta, conserva un descriptor cifrado solo mientras una descarga está pendiente y lo elimina al completar la subida. Los enlaces de lectura son temporales, se emiten únicamente tras comprobar sesión y permiso sobre la cuenta, y no se guardan en la base de datos. Una descarga que no pueda recuperarse tras los reintentos se muestra como archivo no disponible.

Mantén una sola réplica Railway. Para un mantenimiento futuro, elimina primero el objeto privado de R2 y después su metadato en PostgreSQL.

## Sincronización de lecturas con WhatsApp

Al abrir una conversación, un `ADMIN` o `AGENT` marca sus mensajes entrantes como leídos en la bandeja y crea una solicitud persistente para sincronizar esa lectura con WhatsApp. El worker Baileys, que es el único proceso con sockets activos, envía el recibo de lectura de cada mensaje de forma secuencial por cuenta.

No se crean solicitudes al listar, buscar o actualizar conversaciones en segundo plano; solo al abrir un hilo que todavía tiene mensajes sin leer. Si una cuenta está desconectada, la solicitud queda pendiente y se reintenta al recuperar la conexión. Los reintentos agotados se registran con un error seguro y sin contenido de mensajes ni identificadores técnicos.

WhatsApp aplica finalmente la configuración de privacidad de recibos de lectura del teléfono vinculado. Mantén una sola réplica Railway para que el worker y su cola persistente sigan teniendo un único consumidor.

## Endurecimiento operativo de WhatsApp

La aplicación conserva el uso exclusivamente manual de la bandeja y añade límites preventivos por cuenta. No son una forma de evitar las decisiones de WhatsApp: reducen picos accidentales y dejan clara la situación cuando el servidor de WhatsApp limita una cuenta.

| Variable | Valor predeterminado | Uso |
| --- | --- | --- |
| `WA_OUTBOUND_MAX_PENDING` | `20` | Máximo de solicitudes manuales pendientes o en proceso por cuenta. |
| `WA_OUTBOUND_MAX_PER_MINUTE` | `6` | Máximo preventivo de envíos manuales por minuto y cuenta. |
| `WA_OUTBOUND_MIN_INTERVAL_SECONDS` | `5` | Separación mínima entre intentos de envío de una cuenta. |
| `WA_OUTBOUND_MAX_NEW_CHATS_PER_DAY` | `10` | Máximo diario preventivo de conversaciones directas iniciadas desde la bandeja. |

Cuando Baileys informa de una restricción `463` o de un Reachout Timelock, la cola de salida de esa cuenta queda pausada de forma persistente. La recepción continúa funcionando; la interfaz de vinculación avisa al administrador y no se realizan reintentos inmediatos. Si WhatsApp comunica una fecha de finalización, la pausa se libera al llegar ese momento; también se libera cuando WhatsApp comunica que la restricción ya no está activa.

El worker mantiene una caché por cuenta de los metadatos de grupos. Antes de un envío manual a un grupo recupera esos metadatos una sola vez y los reutiliza durante cinco minutos, evitando consultas repetidas de participantes durante el cifrado. Si no puede obtenerlos, el envío falla de forma segura en vez de provocar consultas recurrentes. Las solicitudes, contactos, notas, etiquetas y asignaciones verifican además que el usuario tenga acceso a la cuenta implicada.

Los mensajes manuales conservan un contador persistente con un máximo de tres intentos. La aplicación no reintenta automáticamente un resultado de entrega ambiguo, una aceptación local sin acuse final ni un rechazo de WhatsApp: los cancela para evitar duplicados. Tras 15 minutos sin confirmación, un envío en proceso se marca como **Cancelado**; el hilo muestra `Enviando`, `Enviado` o `Cancelado` junto al mensaje saliente.
