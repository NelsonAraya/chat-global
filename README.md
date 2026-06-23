# Chat CORMUDESI

Sistema de chat interno para redes LAN. Basado en Node.js + Express + Socket.IO con almacenamiento en SQLite.

## Requisitos

- Node.js v18 o superior
- npm (incluido con Node.js)
- Red LAN con cable o WiFi
- Puertos **3000** y **3443** abiertos en el firewall del servidor

## Instalación

```bash
# 1. Clonar el repositorio en el servidor
git clone https://github.com/NelsonAraya/chat.git
cd chat

# 2. Instalar dependencias
npm install

# 3. Iniciar el servidor
npm start
```

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

Cambia la contraseña del admin después del primer ingreso. Usa el panel Admin (⚙) para crear usuarios y gestionar salas.

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
| `Ctrl + C` | Detiene el servidor |

## Botón de Alerta

El chat incluye un sistema de alerta (pánico) que notifica a todos los usuarios conectados.

### Formas de activar la alerta

| Método | Cómo | Dónde funciona |
|--------|------|----------------|
| **Botón rojo** | Haz clic en **Botón Alerta** en la barra lateral izquierda | En cualquier momento |
| **Triple clic rápido** | 3 clics ≤ 800ms en el área del chat (evitando botones, inputs y modales) | Con el chat abierto |
| **Comando** | Escribe `Ctrl+Shift+E` (Emergencia) en cualquier parte del chat | Con el chat abierto y activo |

- **Qué hace al activarse:** Todos los usuarios conectados reciben un modal + sonido indicando quién solicita asistencia y su ubicación
- **Ubicación:** Haz clic en el ícono 📍 en el header para asignar tu ubicación actual (ej: "Oficina 302, Edificio Central")
- Si no has configurado ubicación se mostrará como "Indeterminada"
- **Cooldown:** 30 segundos entre activaciones para evitar spam
- **Feedback visual:** Al activarse por triple clic aparece un borde rojo que parpadea y se desvanece
- El sonido de alerta se puede personalizar reemplazando `public/sounds/alerta.mp3`

## Panel de Administración

Los usuarios con rol **admin** ven una tercera pestaña ⚙ en la barra lateral con las siguientes capacidades:

### Estadísticas

Cuatro tarjetas en la parte superior del panel con:
- **Usuarios:** total de cuentas registradas
- **Conectados:** usuarios online en este momento
- **Mensajes:** total de mensajes enviados
- **Salas:** total de salas creadas

### Gestión de usuarios

Al hacer clic en ✏ junto a un usuario se abre un modal para:
- Cambiar nombre visible
- Cambiar rol (Usuario / Administrador)
- **Resetear contraseña** (campo opcional — si se deja vacío no se modifica)
- **Eliminar usuario** (botón rojo con confirmación)

> Reglas de seguridad: un admin no puede eliminarse a sí mismo, no puede eliminar al usuario `admin`, y no puede cambiar su propia contraseña desde este panel (debe usar el modal de cambio de contraseña normal).

### Gestión de salas

Cada sala fija (no temporal, excepto `#general`) tiene dos botones:
- 🔒/🔓 — Asignar o quitar contraseña de la sala
- 🗑 — Eliminar la sala (solo salas no temporales, excepto `#general`)

Las salas temporales se eliminan automáticamente al quedar vacías.

## Notificaciones no leídas

- Cada sala muestra un badge 🔴 con la cantidad de mensajes no leídos
- La pestaña **Salas** suma todos los no leídos en un badge general
- Al hacer clic en una sala o al volver a la pestaña del navegador, los contadores se reinician
- Los mensajes privados también muestran badge 🔴 en la pestaña **Privados**

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

- **SQLite** (`chat.db`): base de datos única que contiene usuarios, salas, mensajes y registro de consentimiento
- Los archivos adjuntos se guardan en `uploads/`
- El certificado SSL se guarda en `certs/` (se genera automáticamente al iniciar con la IP actual)
- Si eliminas `chat.db` se regenera automáticamente al reiniciar con los datos por defecto (usuario `admin` y sala `general`)

## Estructura del proyecto

```
chat-cormudesi/
├── index.js              # Servidor (HTTP redirige a HTTPS)
├── db.js                 # Persistencia SQLite (sql.js) + hash de contraseñas
├── socket-handler.js     # Eventos de Socket.IO
├── chat.db               # Base de datos SQLite (se crea al iniciar)
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
