# Chat CORMUDESI

Sistema de chat interno para redes LAN. Basado en Node.js + Express + Socket.IO con almacenamiento en MySQL.

## Requisitos

- Node.js v18 o superior
- npm (incluido con Node.js)
- **MySQL** (o MariaDB) corriendo y accesible desde el servidor
- Red LAN con cable o WiFi
- Puertos **3000** y **3443** abiertos en el firewall del servidor

## Instalación

```bash
# 1. Clonar el repositorio en el servidor
git clone https://github.com/NelsonAraya/chat-global.git
cd chat-global

# 2. Instalar dependencias
npm install

# 3. Configurar la conexión a MySQL (variables de entorno, ver abajo)

# 4. Iniciar el servidor
npm start
```

## Configuración de MySQL

El servidor crea automáticamente la base de datos y las tablas la primera vez que arranca (el usuario de MySQL que uses necesita permiso para crear bases de datos). La configuración va en un archivo **`.env`** en la raíz del proyecto (no se sube a git, cada servidor tiene el suyo):

```bash
# 1. Copia la plantilla
cp .env.example .env

# 2. Edita .env con los datos de tu MySQL
```

Variables disponibles (si no se define alguna, usa el valor por defecto):

| Variable | Default | Descripción |
|---|---|---|
| `DB_HOST` | `localhost` | Host del servidor MySQL |
| `DB_PORT` | `3306` | Puerto de MySQL |
| `DB_USER` | `root` | Usuario de MySQL |
| `DB_PASSWORD` | *(vacío)* | Contraseña de MySQL |
| `DB_NAME` | `chat_cormudesi` | Nombre de la base de datos |
| `DB_POOL_SIZE` | `30` | Conexiones simultáneas a MySQL (opcional) |
| `ALLOWED_EMAIL_DOMAINS` | `cormudesi.cl,gmail.com` | Dominios de correo aceptados al registrarse (separados por comas) |
| `HTTP_PORT` | `3000` | Puerto HTTP (opcional) |
| `HTTPS_PORT` | `3443` | Puerto HTTPS (opcional) |

Con `.env` configurado, `npm start` ya levanta el servidor conectado a esa base — no hace falta pasar nada por línea de comandos.

## Correo (códigos de acceso y Botón de Alerta)

El correo se usa para dos cosas:

- **Código de acceso del doble factor** (ver [Doble factor](#doble-factor-código-por-correo)). **Es necesario configurarlo** para que los usuarios reciban su código al iniciar sesión. Si el SMTP no está configurado o falla, el código se muestra en la consola del servidor para que un administrador se lo entregue al usuario.
- **Botón de alerta:** además de la notificación en pantalla, se manda un correo. Si no se configura `ALERT_EMAIL_TO`, el botón sigue funcionando igual, solo que sin correo.

Se configura en el mismo archivo `.env`:

| Variable | Descripción |
|---|---|
| `SMTP_HOST` | Servidor SMTP de la cuenta que **envía** el correo (ej: `smtp.gmail.com`, `smtp.office365.com`, o el servidor propio de CORMUDESI) |
| `SMTP_PORT` | Puerto SMTP (`587` por defecto) |
| `SMTP_SECURE` | `true` si el puerto usa SSL directo (normalmente el 465); `false` para STARTTLS (normalmente el 587) |
| `SMTP_USER` / `SMTP_PASSWORD` | Credenciales de la cuenta que envía. **Con Gmail y verificación en 2 pasos necesitas una "contraseña de aplicación"**, no la contraseña normal de la cuenta |
| `ALERT_EMAIL_FROM` | Remitente que se ve en los correos (alerta y códigos de acceso). Si se deja vacío, usa `SMTP_USER` |
| `ALERT_EMAIL_TO` | Quién(es) reciben la alerta — se puede poner más de un correo separado por comas |

### Migrar desde una instalación anterior (SQLite)

Si vienes de una versión anterior que usaba `chat.db` (SQLite), migra tus datos una sola vez antes de iniciar el servidor con MySQL:

```bash
npm run migrate
```

Lee `chat.db`, crea la base de datos y las tablas en MySQL, y copia usuarios, salas, mensajes, departamentos y el registro de consentimiento (TyC). `chat.db` no se modifica ni se borra — queda como respaldo. Se puede ejecutar más de una vez sin duplicar datos.

## Acceder desde la LAN

No necesitas configurar nada. La IP se detecta automáticamente.

1. En el servidor corre `npm start`. Verás algo como:

   ```
   ║  →  http://192.168.1.51:3000
   ```

2. Desde **cualquier PC de la red** abre el navegador y ve a esa dirección:

   ```
   http://<IP-DEL-SERVIDOR>:3000
   ```

   Ejemplo: `http://192.168.1.51:3000`

3. El servidor **redirige automáticamente a HTTPS** para que la grabación de audio funcione.

## Instalar certificado de seguridad

Para eliminar la advertencia **"No es seguro"** del navegador (Chrome/Edge) y que aparezca un candado verde:

1. Abre `https://<IP-DEL-SERVIDOR>:3443` en el navegador.
   - Ejemplo: `https://192.168.1.51:3443`
   - La primera vez verás **"Su conexión no es privada"**
   - Haz clic en: **Avanzado → Ir a `<IP>` (sitio no seguro)**

2. En la pantalla de login verás un banner verde con **"Descargar certificado"**.

3. Haz clic en **Descargar certificado** → se descarga `Chat-CORMUDESI-cert.cer`.

4. Abre el archivo descargado y haz clic en **"Instalar certificado"**.

5. Sigue estos pasos:
   - **Máquina local** → **Siguiente**
   - **Colocar todos los certificados en el siguiente almacén** → **Examinar**
   - Selecciona **"Entidades de certificación raíz de confianza"** → **Aceptar**
   - **Siguiente** → **Finalizar**
   - Haz clic en **"Sí"** en el mensaje de seguridad

6. Vuelve a cargar la página `https://<IP-DEL-SERVIDOR>:3443`.
   - La advertencia ya no aparecerá.
   - El candado se mostrará como seguro.

> **Nota:** Si el servidor cambia de IP (ej: se conecta en otra red), el certificado se regenera automáticamente. Deberás descargar e instalar el nuevo certificado en cada PC cliente.

## Grabación de audio

La grabación de audio (micrófono) funciona solo en **HTTPS**. El servidor redirige automáticamente:

```
http://<IP-DEL-SERVIDOR>:3000  →  https://<IP-DEL-SERVIDOR>:3443
```

Solo presiona el botón 🎤 en el área de mensajes para grabar.

## Primer uso

Al iniciar el servidor por primera vez se crea automáticamente:

- **Usuario:** `admin`
- **Contraseña:** `admin`
- **Rol:** Administrador

**Cambia la contraseña del admin inmediatamente después del primer ingreso.** En ese primer ingreso se te pedirá un correo y te llegará un código para activar el doble factor (ver [Doble factor](#doble-factor-código-por-correo)). Usa el panel Admin (ícono ⚙ en la barra lateral) para crear departamentos, aprobar usuarios nuevos y gestionar salas.

> **Importante:** cualquier persona puede crear una cuenta desde "Crear cuenta" (pide usuario, correo y contraseña), pero **no puede entrar al chat hasta que un administrador la apruebe** desde el panel Admin → Usuarios. Ver [Aprobación de cuentas nuevas](#aprobación-de-cuentas-nuevas).

## Puertos personalizados

Si los puertos default (3000 y 3443) están ocupados, puedes cambiarlos:

```bash
HTTP_PORT=3001 HTTPS_PORT=3444 npm start
```

## Firewall

Asegúrate de tener abiertos los puertos 3000 y 3443 en el firewall de Windows:

```
Windows + R → "wf.msc" → Reglas de entrada → Nueva regla → Puerto
→ TCP → puertos: 3000,3443 → Permitir → ...
```

## Comandos

| Comando | Descripción |
|---|---|
| `npm start` | Inicia el servidor |
| `npm run dev` | Inicia con reinicio automático al editar código |
| `npm run migrate` | Migra datos de una instalación anterior con SQLite hacia MySQL (una sola vez) |
| `Ctrl + C` | Detiene el servidor |

## Botón de Alerta

El chat incluye un sistema de alerta (pánico) para pedir asistencia.

### Formas de activar la alerta

| Método | Cómo | Dónde funciona |
|--------|------|----------------|
| **Botón rojo** | Haz clic en **Botón Alerta** en la barra lateral izquierda | En cualquier momento |
| **Triple clic rápido** | 3 clics ≤ 800ms en el área del chat (evitando botones, inputs y modales) | Con el chat abierto |

### Quién la puede enviar

Solo quien está conectado **en un departamento**. A quien no tiene departamento (por ejemplo el administrador general) no le aparece el botón, y el servidor rechaza la alerta si igual se intenta enviar.

### Quién la recibe

La alerta **no le llega a todo el mundo** — queda acotada a quien tiene algo que ver:

- Los usuarios conectados en el **mismo departamento/centro** que la persona que la activó.
- Los **administradores de ese departamento**.
- El **administrador general**, que recibe las de todos los departamentos (para que TI tenga visibilidad centralizada).

Cada receptor ve un modal + sonido indicando quién solicita asistencia, su departamento y su ubicación.

### Otros detalles

- **Ubicación:** Haz clic en el ícono 📍 en el header para asignar tu ubicación actual (ej: "Oficina 302, Edificio Central"). Si no la configuraste, se muestra como "Indeterminada".
- **Espera entre alertas:** cada persona puede enviar una alerta cada **30 segundos** (el botón y el triple clic comparten la espera) para evitar spam. El botón queda deshabilitado con la cuenta regresiva ("Alerta enviada (25s)"). La espera la exige también el servidor, así que recargar la página no la salta. Es por persona: otra persona puede enviar la suya sin esperar.
- **Feedback visual:** Al activarse por triple clic aparece un borde rojo que parpadea y se desvanece.
- El sonido de alerta se puede personalizar reemplazando `public/sounds/alerta.mp3`.
- **Correo de notificación:** además de la alerta en pantalla, el sistema puede mandar un correo (ver [Correo del Botón de Alerta](#correo-del-botón-de-alerta) más arriba) — es opcional, se activa solo si configuras el SMTP en `.env`.
- **Historial:** cada activación queda guardada de forma permanente (quién, departamento, ubicación, fecha y hora) — visible en el panel Admin → pestaña **Alertas**.

## Panel de Administración

Los usuarios con rol **admin** ven un ícono ⚙ adicional en la barra lateral. Al entrar, el panel ocupa toda el área principal del chat (no un sidebar angosto) y se organiza en sub-pestañas: **Resumen**, **Departamentos**, **Usuarios**, **Salas**, **Alertas** y **Errores**.

### Tipos de administrador

| | Administrador general | Administrador de departamento |
|---|---|---|
| Cómo se define | Rol admin **sin departamentos** asignados (la cuenta `admin`) | Rol admin con la casilla **"Admin"** marcada en uno o más de sus departamentos |
| Usuarios, salas, alertas y estadísticas | De todos los departamentos | Solo de los departamentos donde es admin |
| Departamentos, solicitudes de registro y Errores | ✓ | – |
| Crear salas globales | ✓ | – (sí salas de sus departamentos) |
| Enviar alertas | – (no tiene departamento) | ✓ |

- **Admin por departamento:** una persona puede pertenecer a varios departamentos y ser admin solo en algunos. Por ejemplo, admin en CESAM Sur y usuario normal en CESFAM Videla: en Videla solo ve a sus conectados y puede crear salas temporales, como cualquier usuario. En la lista de usuarios aparece como "Admin de CESAM Sur".
- Un admin de departamento **no puede dar administración** de departamentos que no administra, ni administrar cuentas que son admin en otros departamentos o al administrador general.
- **Cuentas compartidas con otros departamentos:** si una cuenta también pertenece a un departamento que el admin no administra, ese admin puede cambiarle el nombre y sus propios departamentos, pero **no** la contraseña ni el correo, ni bloquearla ni eliminarla (eso afectaría su acceso en el otro departamento). Eso queda para el administrador general; el panel oculta esas opciones y lo explica.

### Resumen

Tarjetas con totales: usuarios registrados, conectados ahora, mensajes enviados y salas creadas.

### Departamentos

Crear, buscar y eliminar departamentos/centros (ver [Departamentos y Centros](#departamentos-y-centros)). Al crear uno se genera automáticamente su sala general. Solo se puede eliminar un departamento si no tiene usuarios asignados.

### Usuarios

- **Solicitudes de registro pendientes:** aparece arriba de todo si hay cuentas nuevas esperando aprobación, con botones para aceptar ✓ o rechazar ✗ cada una (ver [Aprobación de cuentas nuevas](#aprobación-de-cuentas-nuevas)).
- **Lista de usuarios:** se carga de a 50 con un botón "Cargar más", y el buscador (por usuario, nombre o correo) busca en el servidor, así el panel no descarga todas las cuentas de una vez. Cada usuario muestra su correo y si tiene el doble factor activo o pendiente (y la etiqueta "Bloqueado" si corresponde). Al hacer clic en ✏ junto a un usuario se abre un modal para:
  - Cambiar nombre visible
  - **Cambiar el correo** del doble factor (si se cambia, el usuario debe verificar el nuevo correo con un código en su próximo ingreso)
  - Cambiar rol (Usuario / Administrador)
  - **Asignar uno o varios departamentos** (checkboxes — un usuario puede pertenecer a más de uno). Con rol Administrador aparece al lado de cada departamento una casilla **"Admin"** para marcar dónde administra (al menos uno); en los demás es usuario normal (ver [Tipos de administrador](#tipos-de-administrador))
  - **Resetear contraseña** (campo opcional — si se deja vacío no se modifica). También quita el bloqueo temporal por intentos fallidos.
  - **Cerrar sus sesiones:** lo desconecta si está conectado y anula sus sesiones recordadas en todos los equipos (ver [Sesiones](#sesiones)).
  - **Bloquear / desbloquear usuario:** al bloquear, si está conectado se le cierra la sesión al instante y no puede volver a ingresar ("Tu cuenta está bloqueada. Contacta a un administrador.") hasta que se desbloquee. No se borra nada: sus mensajes, amigos y grupos se mantienen.
  - **Eliminar usuario** (botón rojo con confirmación)

> Reglas de seguridad: un admin no puede eliminarse ni bloquearse a sí mismo, no puede eliminar ni bloquear al usuario `admin`, y no puede cambiar su propia contraseña desde este panel (debe usar el modal de cambio de contraseña normal).

### Salas

Buscador por nombre. Cada sala fija (no temporal, excepto `#general`) tiene dos botones:
- 🔒/🔓 — Asignar o quitar contraseña de la sala
- 🗑 — Eliminar la sala (solo salas no temporales, excepto `#general`)

Las salas temporales se eliminan automáticamente con sus mensajes y archivos:
- al quedar vacías;
- si nadie entra en los **10 minutos** siguientes a crearlas;
- al reiniciar el servidor (las que quedaron abiertas).

Cada persona puede tener como máximo **3 salas temporales** abiertas a la vez.

Al crear una sala fija, el admin elige a qué departamento pertenece (o "Global" para que la vean todos — ver [Departamentos y Centros](#departamentos-y-centros)).

### Alertas

Historial completo de activaciones del botón de pánico, del más reciente al más antiguo: quién la activó, su departamento, su ubicación y la fecha/hora exacta. Carga de a 50 registros con un botón "Cargar más". El registro es permanente — queda ahí aunque después se elimine la cuenta del usuario.

### Errores

Registro de los errores del sistema, para que los administradores puedan avisar a los desarrolladores qué pasó. La sub-pestaña muestra un contador rojo con los errores pendientes, que se actualiza solo cuando aparece uno nuevo.

**Qué se registra** (tabla `error_log`):
- Errores del servidor: fallas de la base de datos o del correo, eventos que fallan (con el usuario que lo estaba usando), errores en la subida/descarga de archivos.
- Errores en el navegador de los usuarios con sesión (con el usuario y el navegador que usaba). Máximo 10 por usuario por minuto.
- Un error no previsto que termine el proceso del servidor también queda registrado antes de cerrarse.

**Qué puede hacer el administrador** en cada error:
- **Ver detalle** (▾): origen, mensaje, usuario, fechas, cuántas veces ocurrió y el detalle técnico para los desarrolladores.
- **Copiar** (📋): copia ese resumen listo para pegar en un correo o mensaje.
- **Marcar revisado** (✓): queda registrado quién lo revisó. Si el error vuelve a ocurrir, regresa a pendientes.
- El filtro **"Solo pendientes"** (marcado por defecto) se puede quitar para ver también los revisados.

**Para no llenar la base:** el mismo error repetido dentro de 10 minutos suma ocurrencias en una sola fila ("50 veces") en vez de crear filas nuevas, y los errores revisados se borran solos a los 90 días. Si la base de datos no responde, los errores se guardan en memoria y se reintentan cada minuto (siguen apareciendo también en la consola del servidor).

## Aprobación de cuentas nuevas

Desde que se agregó este flujo, **crear una cuenta ya no da acceso inmediato al chat**:

1. Cualquiera puede registrarse desde "Crear cuenta" — pide usuario, **correo** y contraseña (el departamento ya no se elige en el registro). **Solo se aceptan correos `@cormudesi.cl` o `@gmail.com`** (configurable con `ALLOWED_EMAIL_DOMAINS`), con formato estricto, y el correo no puede estar usado por otra cuenta.
2. La cuenta queda en estado **pendiente**. Si intenta entrar antes de ser aprobada, ve el mensaje "Tu cuenta está pendiente de aprobación por un administrador."
3. Si hay un administrador conectado en ese momento, le llega una notificación en vivo (sonido + aviso) y un contador en el ícono de Admin.
4. El administrador entra a **Admin → Usuarios**, **revisa el correo con que se registró** (se muestra en la solicitud) y acepta ✓ o rechaza ✗.
   - **Aceptada:** el usuario ya puede entrar al chat. En su primer ingreso activa el doble factor con un código enviado a ese correo. El admin le asigna su(s) departamento(s) desde el mismo panel (editar usuario → checkboxes de departamentos).
   - **Rechazada:** el usuario no puede entrar ("Tu solicitud de cuenta fue rechazada. Contacta a un administrador."). La cuenta queda marcada como rechazada (no se borra sola); el admin puede eliminarla del todo si quiere.

**Límites para evitar solicitudes falsas:** máximo **30 registros por hora** en total y como máximo **150 solicitudes pendientes**. Pasado cualquiera de los dos, el registro responde "Inténtalo más tarde" hasta que pase la hora o un administrador apruebe/rechace solicitudes.

Las cuentas que ya existían antes de este cambio no se vieron afectadas — quedaron activas automáticamente.

## Departamentos y Centros

Pensado para instituciones con varios centros (ej: distintos CESFAM) que comparten un mismo servidor de chat, pero donde cada uno necesita su propio espacio separado.

- **Salas por departamento:** cada sala pertenece a un departamento específico (solo la ven sus usuarios + los admins) o es **"Global"** (la ve todo el mundo, sin importar su departamento — se identifica con una etiqueta azul "Global" en la sala y en la barra superior). `#general` es global por defecto.
- **Alerta acotada por departamento:** ver [Botón de Alerta](#botón-de-alerta).
- **Directorio de usuarios acotado:** en "Conectados → En el sistema" solo ves a la gente de tu departamento activo (más el administrador general, que es visible para todos). El admin de departamento ve además a los de los departamentos que administra, y el administrador general ve a todos.
- **Canales globales sin lista:** en las salas globales (que pueden tener a todos los conectados) no se muestra ni se envía quién está dentro, para no cargar el navegador ni el servidor. En las salas de departamento sí se ve la lista.
- **Un usuario puede pertenecer a varios departamentos.** El administrador se los asigna desde Admin → Usuarios.
  - Si solo tiene uno, entra directo a ese contexto al iniciar sesión.
  - Si tiene varios, al iniciar sesión se le pide elegir con cuál entrar.
  - Ya conectado, si tiene más de uno asignado, le aparece un botón ⇄ junto a su nombre en el header para **cambiar de departamento activo** sin cerrar sesión — se le actualizan sus salas, su directorio de usuarios y el alcance de sus alertas al instante.
- Las cuentas sin ningún departamento asignado solo ven las salas globales y solo pueden ver/ser vistas por los administradores.

## Sistema de Amigos

Pensado para mantener contacto directo con alguien de otro departamento al que normalmente no verías en tu directorio.

- Pestaña **Amigos** en la barra lateral, con botón **"Agregar amigo"** que abre un buscador — encuentra a cualquier usuario registrado por nombre de usuario o nombre visible, sin importar su departamento.
- Agregar a alguien manda una **solicitud**; la otra persona la ve en su pestaña Amigos y la acepta o rechaza. Si ambos se agregan mutuamente antes de responder, queda aceptado automático.
- La lista de amigos muestra, para cada uno, si está conectado (con su departamento activo) o desconectado — todo en tiempo real.
- Click en un amigo abre el chat privado directo con él. También se puede quitar a alguien de la lista cuando se quiera.

## Doble factor (código por correo)

Además de la contraseña, para entrar se pide un **código temporal de 6 dígitos** enviado al correo de la cuenta.

1. El usuario ingresa usuario y contraseña.
2. Le llega un correo "Tu código de acceso al Chat CORMUDESI" con el código (el código va solo en el cuerpo, no en el asunto).
3. Lo ingresa en la pantalla de verificación. En pantalla se ve la cuenta regresiva.

Reglas:

- **Primer ingreso = activación:** la primera vez, el mismo paso verifica el correo y deja el doble factor activo. Las cuentas antiguas que no tienen correo deben indicar uno en ese momento.
- El código **vence a los 5 minutos** y se anula tras **5 intentos incorrectos**.
- Botón **"Reenviar código"**, con 30 segundos de espera entre envíos y un máximo de **5 códigos cada 15 minutos** por usuario.
- Si el usuario recarga la página o repite el login mientras su código sigue vigente, **se reutiliza el mismo código** (no llega un correo nuevo).
- Los códigos se guardan cifrados y solo en la memoria del servidor (no en la base de datos). Si se reinicia el servidor, hay que pedir uno nuevo.

## Sesiones

Después de ingresar (contraseña + código), el navegador recibe un **token de sesión**. Con él puede recargar la página sin volver a pedir contraseña ni código. **El navegador nunca guarda la contraseña.**

- **Por defecto** la sesión dura mientras la pestaña esté abierta (máximo 12 horas). Al cerrar la pestaña o el navegador, hay que volver a ingresar: si la conexión no se retoma en 60 segundos (lo que tarda de sobra una recarga), el servidor borra la sesión, aunque el navegador restaure la pestaña.
- **"Recordar este equipo por 7 días"** (casilla en la pantalla del código): la sesión sobrevive a cerrar el navegador. No marcarla en computadores compartidos.
- Al reanudar, entra directo al último departamento usado.
- Si se reinicia el servidor o se corta la red, la página se recarga sola al volver la conexión y reingresa con la sesión.
- Abrir el chat en otra pestaña con la misma sesión desactiva la pestaña anterior (con un botón "Usar el chat aquí"). Una sesión de **otro equipo** no puede entrar mientras el usuario esté conectado.
- Las sesiones se cierran:
  - con el botón **Salir**;
  - al **cambiar la propia contraseña** (se cierran las de otros equipos, la actual sigue);
  - cuando el admin **resetea la contraseña**, **bloquea** o **elimina** al usuario;
  - con el botón **"Cerrar sus sesiones"** en Admin → Usuarios → ✏ (útil si alguien perdió o dejó abierto un equipo).
- En la base de datos (tabla `sessions`) se guarda solo el hash del token, no el token. Las sesiones vencidas se borran solas.

## Grupos

Conversaciones privadas entre varias personas elegidas — a diferencia de las salas (abiertas a todo un departamento) y de los privados (1 a 1).

- Pestaña **Grupos** en la barra lateral, con contador de mensajes no leídos + invitaciones pendientes.
- **Cualquier usuario puede crear un grupo:** botón "Crear grupo" → nombre + buscar personas por usuario o nombre.
- **Las personas invitadas deben aceptar:** la invitación aparece arriba en la pestaña Grupos con ✓ (unirse) / ✗ (rechazar). Mientras no acepte, no ve ni puede escribir nada del grupo. Solo se puede invitar a usuarios activos.
- Dentro del grupo funciona todo lo del chat: archivos, audio, responder, reacciones e historial paginado. A la derecha se ven los miembros (clic en uno → chat privado).
- Botón **"Miembros"** en la barra superior del grupo para administrarlo.

| | Creador | Admin del grupo | Miembro |
|---|---|---|---|
| Escribir y leer | ✓ | ✓ | ✓ |
| Invitar, renombrar el grupo | ✓ | ✓ | – |
| Quitar miembros | ✓ (a cualquiera) | solo miembros normales | – |
| Nombrar / quitar admins del grupo | ✓ | – | – |
| Eliminar el grupo (borra todos sus mensajes) | ✓ | – | – |
| Salir del grupo | ✓ | ✓ | ✓ |

- Si el creador sale, el grupo pasa a un admin del grupo (o al miembro más antiguo). Si sale el último miembro, el grupo se elimina.
- Si se elimina una cuenta de usuario, sale automáticamente de todos sus grupos.

## Seguridad

- **Contraseñas** guardadas con **scrypt con sal** (archivo `passwords.js`). Las contraseñas del formato anterior (SHA-256 sin sal) siguen funcionando y se convierten solas al formato nuevo la próxima vez que esa persona inicia sesión (lo mismo para las salas con contraseña).
- **Límite de intentos:**
  - 5 contraseñas incorrectas seguidas bloquean esa cuenta por 15 minutos.
  - 10 contraseñas de sala incorrectas bloquean a ese usuario 15 minutos para entrar a salas con contraseña.
  - Se bloquea la **cuenta**, nunca la IP: detrás de un proxy o de la salida a internet de un centro, todos comparten la misma IP, y bloquearla dejaría a todos sin poder entrar.
  - Cambiar la propia contraseña también queda limitado a 5 intentos fallidos.
  - El login responde siempre "Usuario o contraseña incorrectos", sin revelar qué usuarios existen.
  - Los bloqueos viven en memoria: reiniciar el servidor los borra. El admin puede desbloquear antes a alguien poniéndole una contraseña nueva.
- **Contenido de los mensajes:** el servidor solo acepta archivos subidos a este mismo servidor (`/uploads/...`) y valida respuestas, avatares y largo del texto. La interfaz escapa todo lo que escriben los usuarios (incluidas comillas) antes de mostrarlo.
- **Archivos subidos:** se sirven aislados (`Content-Security-Policy: sandbox`, `nosniff`) para que un `.html` o `.svg` no pueda ejecutar código en el sitio. Solo imágenes, audio, video y PDF se abren en el navegador; el resto se descarga.
  - **Solo con sesión:** al ingresar, el navegador canjea su autorización por una cookie (`HttpOnly`, solo para `/uploads`). Sin sesión, abrir el enlace de un archivo responde "Debes iniciar sesión". La autorización deja de valer al desconectarse, al ser bloqueado o eliminado. El navegador no guarda copia de los archivos (útil en equipos compartidos).
  - **Subida:** la autorización va en la cabecera `X-Upload-Token` y se revisa **antes** de recibir el archivo, así nadie sin sesión puede escribir en el disco del servidor.
  - **Cada archivo es de quien lo subió:** solo esa persona puede adjuntarlo, y a un solo mensaje (o como foto de perfil, si es una imagen). Así nadie puede adjuntar el archivo de otro en una sala propia y hacer que se borre al cerrarla. El nombre, el tamaño y el tipo que se muestran son los que registró el servidor al recibirlo.
  - Lo que se sube y no se envía en 1 hora se borra del disco.
  - Al eliminar una sala (temporal o fija), un grupo o un departamento, sus archivos también se borran del disco.
- **Límite de velocidad por persona:** hasta 8 mensajes seguidos y luego 1 por segundo; las reacciones y el resto de las acciones tienen su propio límite. Pasado el límite, el chat responde "Vas muy rápido" (el texto vuelve al cuadro). Una persona escribiendo normal no lo alcanza; evita que un script inunde el chat. El botón de alerta nunca se frena por este límite.
- **Detrás de un proxy** (p. ej. Nginx en el mismo servidor): la IP real de cada persona se toma de la cabecera `X-Forwarded-For`, solo si la conexión viene del propio equipo (`127.0.0.1`). Se usa para el registro de consentimiento y de sesiones.
- **Datos mal formados:** el servidor valida el tipo de cada dato que recibe, y un error dentro de cualquier evento se registra (ver [Errores](#errores)) sin botar el servidor ni desconectar a los demás.
- **Acceso a salas:** el permiso se revisa en cada mensaje, no solo al entrar. Si a alguien le cambian el departamento (o se cambia él) y ya no puede ver la sala donde está, el servidor lo saca. Al eliminar una sala se saca a todos los que estaban dentro, así nadie recibe los mensajes de otra sala que se cree después con el mismo nombre.
- **Cabeceras de seguridad:** la página se sirve con `Content-Security-Policy` (solo scripts del propio servidor), `X-Frame-Options: DENY` (no se puede mostrar dentro de otra página), `nosniff` y `Referrer-Policy`.
- **Reacciones:** solo se aceptan los emojis que ofrece el selector del chat.
- **Citas (responder un mensaje):** el texto citado lo arma el servidor a partir del mensaje original, y solo si es de la misma conversación. Nadie puede atribuirle a otro un texto que no escribió.
- **Mensajes:** se guardan primero en la base y solo después se envían a los demás. Si la base falla, nadie lo recibe y quien lo envió ve "No se pudo enviar el mensaje" (el texto vuelve al cuadro para no perderlo).

## Notificaciones no leídas

- Cada sala muestra un badge 🔴 con la cantidad de mensajes no leídos. El servidor junta los mensajes nuevos de cada sala y avisa el total cada 1,5 segundos (en una sala global activa, avisar uno por uno serían miles de avisos por mensaje)
- La pestaña **Salas** suma todos los no leídos en un badge general
- Al hacer clic en una sala o al volver a la pestaña del navegador, los contadores se reinician
- Los mensajes privados también muestran badge 🔴 en la pestaña **Privados**
- Los grupos muestran badge 🔴 por grupo y en la pestaña **Grupos** (que además suma las invitaciones pendientes)

## Historial de mensajes

Al entrar a una sala, abrir un privado o abrir un grupo se cargan solo los últimos 50 mensajes (no la conversación completa). Al subir el scroll hasta el tope se piden automáticamente los 50 anteriores, manteniendo la posición sin saltar — igual que WhatsApp o Slack. Cuando llegas al principio real de la conversación aparece el aviso "Inicio de la conversación". Esto evita que una sala con mucho historial sea lenta de cargar.

El servidor tampoco guarda el historial en memoria: cada página de 50 mensajes se pide a MySQL en el momento (con índices por sala, grupo y conversación privada), así el arranque y el uso de memoria no crecen con los años de mensajes. En memoria solo queda el último mensaje de cada grupo, para la lista de grupos. El orden de los mensajes lo da su `id` (marca de tiempo que siempre crece, aunque lleguen dos en el mismo milisegundo).

## Cumplimiento Legal (Chile)

El sistema cumple con la normativa chilena vigente:

- **Ley N° 21.719** — Sobre Protección de Datos Personales (vigente desde diciembre 2026)
- **Ley N° 21.663** — Marco de Ciberseguridad e Infraestructura Crítica de la Información
- **Ley N° 19.628** — Sobre Protección de la Vida Privada

### Términos y Condiciones

Al registrarse, el usuario debe aceptar los Términos y Condiciones mediante un modal con scroll que incluye:

1. Identificación del responsable (CORMUDESI, Unidad de Informática)
2. Datos personales recopilados
3. Finalidad del tratamiento
4. Base legal (consentimiento — Art. 12 Ley 21.719)
5. Destinatarios de los datos
6. Plazo de conservación
7. Derechos ARCOP (Acceso, Rectificación, Cancelación, Oposición, Portabilidad)
8. Medidas de seguridad (conforme a Ley 21.663)
9. Menores de edad
10. Uso aceptable
11. Reporte de incidentes
12. Vigencia y actualizaciones

El checkbox de aceptación **no viene premarcado** y el botón **Aceptar** se habilita solo al marcar la casilla.

### Política de Privacidad

Disponible en `/privacidad.html` con enlace desde:
- Footer del formulario de login
- Banner en el header del chat
- Modal de Términos y Condiciones

### Registro de Consentimiento

Cada aceptación de TyC queda registrada en la base de datos con:
- Usuario
- Versión de los términos aceptados
- Fecha y hora
- Dirección IP del usuario

## Persistencia de datos

- **MySQL**: base de datos (ver "Configuración de MySQL" arriba) con las tablas `users`, `rooms`, `messages`, `conversations`, `departments`, `friends`, `alerts`, `consent_log`, `chat_groups`, `group_members`, `sessions` y `error_log`. Las columnas, tablas e índices nuevos (correo, doble factor y departamentos de administración en `users`, lista de conversaciones privadas, grupos, registro de errores, índices del historial) se agregan solos al iniciar el servidor, sin perder datos. Cada acción (mensaje, reacción, cambio de nombre, etc.) escribe solo la fila que cambió — no se reescribe la base completa en cada operación.
- Los archivos adjuntos se guardan en `uploads/`
- El certificado SSL se guarda en `certs/` (se genera automáticamente al iniciar con la IP actual)
- Si la base de datos está vacía, se crea automáticamente con los datos por defecto (usuario `admin` y sala `general`) al iniciar

## Estructura del proyecto

```
chat-cormudesi/
├── index.js              # Servidor (HTTP redirige a HTTPS)
├── db.js                 # Persistencia MySQL (mysql2)
├── passwords.js          # Hash y verificación de contraseñas (scrypt con sal)
├── socket-handler.js     # Eventos de Socket.IO (login + doble factor, salas, privados, grupos, admin)
├── mailer.js             # Envío de correo: códigos de acceso y botón de alerta (nodemailer)
├── error-log.js          # Registro de errores del sistema en la base (panel Admin → Errores)
├── migrate-to-mysql.js   # Migración única desde una instalación anterior con SQLite
├── .env                  # Configuración de MySQL y correo (no se sube a git)
├── .env.example          # Plantilla de .env
├── package.json
├── certs/                # Certificado SSL (se genera al iniciar con la IP actual)
├── uploads/              # Archivos adjuntos (se crea al iniciar)
├── public/
│   ├── sounds/
│   │   └── alerta.mp3    # Sonido del botón de alerta
│   ├── index.html        # Interfaz de usuario + modal de Términos y Condiciones
│   ├── styles.css        # Estilos
│   ├── app.js            # Lógica del cliente
│   ├── privacidad.html   # Política de Privacidad (Ley 21.719 y 21.663)
│   └── img/
│       ├── logo.png      # Logo de CORMUDESI
│       ├── cert-01-download.png
│       ├── cert-02-open.png
│       ├── cert-03-install.png
│       ├── cert-04-local-machine.png
│       ├── cert-05-browse.png
│       ├── cert-06-trusted-root.png
│       ├── cert-07-finish.png
│       ├── cert-08-security.png
│       └── cert-09-done.png  # Pasos para instalar certificado
```

## Licencia

Desarrollado por Unidad de Informática - CORMUDESI
