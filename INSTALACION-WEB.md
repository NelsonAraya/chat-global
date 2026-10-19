# Instalación en el servidor web (aurora.cormudesi.cl)

Paso a paso para publicar el Chat CORMUDESI en internet, en un servidor Linux que **ya tiene otros sistemas** funcionando con Nginx. Ninguno de los pasos modifica los sitios que ya existen: el chat se agrega como un sitio más.

```
Internet ──80/443──▶ Nginx (certificado Let's Encrypt) ──▶ chat en 127.0.0.1:3000 (MODO_WEB=true)
                                                             MySQL en 127.0.0.1:3306
```

> En los ejemplos, el dominio del chat es `aurora.cormudesi.cl` y el chat se instala en `/opt/chat-global`. Si cambia alguno, reemplazarlo en todos los lugares.

---

## 0. Antes de empezar

### Entrar como root con `su -`

```bash
su -
```

Con el guion (`su -`) se carga la ruta completa de root. Con `su` a secas, comandos como `nginx`, `ufw` o `certbot` responden **"orden no encontrada"** aunque estén instalados (viven en `/usr/sbin`). Si pasa, usar la ruta completa: `/usr/sbin/nginx`.

### Revisar qué hay en el servidor

```bash
ss -tlnp                                             # puertos en uso y qué programa usa cada uno
systemctl is-active nginx apache2                    # qué servidor web está corriendo
ls /etc/nginx/sites-enabled                          # sitios que ya tiene Nginx
nginx -T 2>/dev/null | grep -E "server_name|listen|default_server"
node -v                                              # el chat necesita Node 18 o más nuevo
```

Lo que debe cumplirse:

| Revisión | Necesario | Si no se cumple |
|---|---|---|
| Servidor web en el puerto 80 | Nginx | Si es Apache, esta guía no sirve tal cual (pedir la configuración para Apache) |
| Puerto **443** | Libre, o usado por Nginx | Si lo usa otro programa, Nginx no puede servir el chat por HTTPS |
| Puerto **3000** | Libre | Usar otro (p. ej. 3100) en `WEB_PORT` y en los `proxy_pass` de Nginx |
| Node | 18 o más nuevo | Instalar una versión nueva de Node |

### El subdominio

El subdominio debe apuntar a la **IP pública** del servidor:

```bash
dig +short aurora.cormudesi.cl      # debe mostrar la IP pública
curl -s -4 ifconfig.me; echo         # IP pública de este servidor (deben coincidir)
```

---

## 1. MySQL

### Usuario propio para el chat

El chat no debe usar `root` de MySQL. Así no puede tocar las bases de los otros sistemas:

```bash
mysql -u root -p
```

```sql
CREATE USER 'chat'@'localhost' IDENTIFIED BY '<contraseña larga>';
GRANT ALL PRIVILEGES ON chat_cormudesi.* TO 'chat'@'localhost';
FLUSH PRIVILEGES;
```

No hace falta crear la base ni las tablas: el chat las crea solo la primera vez que arranca (paso 4).

### MySQL no debe responder desde internet

Si `ss -tlnp` muestra `0.0.0.0:3306`, MySQL está abierto a todos: con IP pública, **cualquiera en internet puede intentar entrar a la base de todos los sistemas**.

Antes de cerrarlo, revisar que ningún otro sistema se conecte desde otro equipo:

```bash
ss -tnp state established '( sport = :3306 )'      # solo debe aparecer 127.0.0.1
```

Si solo aparece `127.0.0.1`, cerrarlo:

```bash
nano /etc/mysql/mysql.conf.d/mysqld.cnf             # (o /etc/mysql/mariadb.conf.d/50-server.cnf en MariaDB)
#   bind-address = 127.0.0.1
systemctl restart mysql
ss -tlnp | grep 3306                                 # ahora debe decir 127.0.0.1:3306
```

Si aparecen otras IPs, **no cambiarlo**: algún sistema se conecta desde otro equipo. En ese caso se limita con el firewall (paso 6).

---

## 2. Nginx en HTTP y certificado (Let's Encrypt)

Se hace en dos partes: primero el sitio solo en HTTP para que Let's Encrypt valide el dominio, y después se agrega HTTPS (paso 3).

```bash
apt install certbot
mkdir -p /var/www/certbot
nano /etc/nginx/sites-available/chat
```

Contenido:

```nginx
server {
    listen 80;
    server_name aurora.cormudesi.cl;

    location /.well-known/acme-challenge/ { root /var/www/certbot; }   # validación de Let's Encrypt
    location / { return 301 https://$host$request_uri; }
}
```

Activarlo y pedir el certificado:

```bash
ln -s /etc/nginx/sites-available/chat /etc/nginx/sites-enabled/chat
nginx -t && systemctl reload nginx
certbot certonly --webroot -w /var/www/certbot -d aurora.cormudesi.cl \
        --deploy-hook "systemctl reload nginx"
```

Con `--webroot`, Certbot **no modifica ninguna configuración de Nginx** (solo deja un archivo de validación en `/var/www/certbot`), así los otros sitios no se tocan. El certificado se renueva solo; `--deploy-hook` recarga Nginx cada vez que se renueva.

Comprobar:

```bash
certbot certificates           # debe aparecer aurora.cormudesi.cl con su fecha de vencimiento
```

### Si Certbot falla con "reader size limit exceeded" (o "unauthorized")

Let's Encrypt llegó al servidor pero recibió **otra página** en vez del archivo de validación: la petición la respondió otro sitio de Nginx. Revisar:

```bash
grep -n server_name /etc/nginx/sites-enabled/chat        # debe decir aurora.cormudesi.cl
nginx -T 2>/dev/null | grep -n -E "aurora|default_server|server_name"

# Archivo de prueba pedido directo a Nginx: debe responder solo "ok"
mkdir -p /var/www/certbot/.well-known/acme-challenge
echo ok > /var/www/certbot/.well-known/acme-challenge/prueba
curl -s -H "Host: aurora.cormudesi.cl" http://127.0.0.1/.well-known/acme-challenge/prueba
rm /var/www/certbot/.well-known/acme-challenge/prueba
```

Causas habituales: el `server_name` del archivo no es el dominio correcto, el sitio no quedó en `sites-enabled`, o no se recargó Nginx (`nginx -t && systemctl reload nginx`). Corregir y volver a ejecutar el mismo `certbot certonly ...`.

---

## 3. Nginx completo (HTTPS)

Reemplazar el contenido de `/etc/nginx/sites-available/chat` por:

```nginx
# Límite de subidas de archivos por IP. Los usuarios de un mismo centro pueden salir a internet con la misma IP,
# por eso el valor es alto; el chat ya limita por persona. (Nombre único para no chocar con otros sitios.)
limit_req_zone $binary_remote_addr zone=chat_cormudesi_upload:10m rate=10r/s;

server {
    listen 80;
    server_name aurora.cormudesi.cl;

    location /.well-known/acme-challenge/ { root /var/www/certbot; }   # renovación del certificado
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl;
    http2 on;                                    # Nginx 1.25.1 o más nuevo (ver nota abajo)
    server_name aurora.cormudesi.cl;

    ssl_certificate     /etc/letsencrypt/live/aurora.cormudesi.cl/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/aurora.cormudesi.cl/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    add_header Strict-Transport-Security "max-age=31536000" always;   # el navegador ya no intenta HTTP
    client_max_body_size 3m;                                            # archivos de hasta 2 MB + margen

    # X-Forwarded-For lleva la IP real de cada persona (registro de consentimiento y sesiones);
    # el chat solo la acepta si la conexión viene de Nginx en este mismo servidor.
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Conexión en vivo (Socket.IO / WebSocket)
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 120s;                 # mayor que el ping de Socket.IO (25 s)
        proxy_send_timeout 120s;
    }

    location /api/upload {
        limit_req zone=chat_cormudesi_upload burst=20 nodelay;
        proxy_pass http://127.0.0.1:3000;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
    }
}

# Cualquier otro nombre que llegue por HTTPS (p. ej. alguien escribe https:// con la dirección de otro sistema
# del servidor que solo usa HTTP) se corta, en vez de mostrar el chat. Si otro sitio ya usa el 443 como
# default_server, quitar este bloque (nginx -t avisa del choque).
server {
    listen 443 ssl default_server;
    server_name _;
    ssl_certificate     /etc/letsencrypt/live/aurora.cormudesi.cl/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/aurora.cormudesi.cl/privkey.pem;
    return 444;
}
```

```bash
nginx -t && systemctl reload nginx
```

Notas:

- **Aviso `the "listen ... http2" directive is deprecated`**: aparece si se escribe `listen 443 ssl http2;` en un Nginx nuevo. Usar las dos líneas `listen 443 ssl;` + `http2 on;` como arriba. En un Nginx anterior a 1.25.1, al revés: `listen 443 ssl http2;` y sin `http2 on;`.
- Si `WEB_PORT` no es 3000, cambiar el `3000` de los tres `proxy_pass`.
- Hasta que el chat esté corriendo (paso 4), `https://aurora.cormudesi.cl` muestra **502 Bad Gateway**: es normal.

---

## 4. Instalar el chat

```bash
cd /opt
git clone https://github.com/NelsonAraya/chat-global.git
cd chat-global
npm install                    # solo descarga las librerías: todavía NO crea las tablas
cp .env.example .env
nano .env
```

En `.env`:

```ini
# MySQL (usuario del paso 1)
DB_HOST=localhost
DB_PORT=3306
DB_USER=chat
DB_PASSWORD=<contraseña del usuario chat>
DB_NAME=chat_cormudesi

# Web
MODO_WEB=true
DOMINIO=aurora.cormudesi.cl            # igual al server_name de Nginx
WEB_PORT=3000

# Cuenta admin (solo se usa al crearla, la primera vez)
ADMIN_PASSWORD_INICIAL=<contraseña larga, 8 caracteres o más>
ADMIN_EMAIL_INICIAL=<correo del administrador>

# Quién puede registrarse (quitar gmail.com si solo deben ser funcionarios)
ALLOWED_EMAIL_DOMAINS=cormudesi.cl

# Correo (obligatorio en la web: sin él nadie recibe su código de acceso)
SMTP_HOST=...
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=...
SMTP_PASSWORD=...
ALERT_EMAIL_FROM=...
ALERT_EMAIL_TO=...
```

### Primer arranque (crea la base y las tablas)

```bash
npm start
```

Al arrancar, el chat crea la base `DB_NAME`, sus 12 tablas, la cuenta `admin` y la sala `general`. Debe mostrar:

```
[WEB] Chat escuchando en http://127.0.0.1:3000 (publicado por Nginx en https://aurora.cormudesi.cl)
```

En ese momento `https://aurora.cormudesi.cl` ya carga. `npm start` deja la consola ocupada: es solo para probar. Detenerlo con **Ctrl+C** y seguir con el paso 5.

Comprobar las tablas:

```bash
mysql -u chat -p chat_cormudesi -e "SHOW TABLES;"
```

Errores habituales al arrancar:

| Mensaje | Causa | Solución |
|---|---|---|
| `Access denied for user` | Usuario o contraseña de MySQL mal en `.env` | Revisar `DB_USER` / `DB_PASSWORD` |
| `CREATE command denied` / `Access denied ... to database` | El usuario no tiene permiso sobre la base | `GRANT ALL PRIVILEGES ON chat_cormudesi.* TO 'chat'@'localhost';` |
| `ECONNREFUSED` | No encuentra MySQL | `DB_HOST=localhost`, `DB_PORT=3306` |
| `define ADMIN_PASSWORD_INICIAL` | Falta la contraseña inicial de admin | Agregarla en `.env` (8 caracteres o más). Las tablas sí alcanzan a crearse |
| `la cuenta admin todavía tiene la contraseña "admin"` | La base viene de una instalación en red local | Cambiar la contraseña de admin (desde el chat en red local) antes de usar el modo web |
| `EADDRINUSE ... 3000` | Otro programa usa el puerto 3000 | Cambiar `WEB_PORT` y los `proxy_pass` de Nginx |

Si la página carga pero el chat **no conecta**, revisar que `DOMINIO` en `.env` sea igual al `server_name` de Nginx.

---

## 5. Dejarlo corriendo siempre (PM2)

PM2 mantiene el chat en segundo plano, lo reinicia si se cae y lo vuelve a iniciar cuando se reinicia el servidor:

```bash
npm install -g pm2
pm2 start index.js --name chat --cwd /opt/chat-global
pm2 save
pm2 startup                    # si muestra un comando (empieza con "sudo env PATH=..."), copiarlo y ejecutarlo
```

`--cwd` es la carpeta del chat: ahí está el `.env`.

| Comando | Para qué |
|---|---|
| `pm2 status` | Ver si el chat está corriendo (`online`) |
| `pm2 logs chat` | Ver la consola del chat (Ctrl+C solo deja de mostrarla) |
| `pm2 restart chat` | Reiniciarlo (p. ej. después de cambiar `.env`) |
| `pm2 stop chat` | Detenerlo |

Comprobar que vuelve solo después de un reinicio del servidor (en un horario sin uso, porque también reinicia los otros sistemas): `reboot` y luego `pm2 status`.

---

## 6. Firewall

**Antes de activarlo**, abrir también los puertos que usan los otros sistemas hacia internet (ver `ss -tlnp`); si no, quedarían sin acceso.

```bash
apt install ufw
ufw allow OpenSSH
ufw allow 80,443/tcp
ufw allow 8083/tcp                             # ← cada puerto que usen los otros sistemas hacia internet
ufw enable
ufw status
```

Quedan cerrados hacia fuera el 3000 (chat) y el 3306 (MySQL). Si algún sistema se conecta a MySQL desde otro equipo (paso 1), permitir solo esa IP: `ufw allow from <IP> to any port 3306`.

| Puerto | Quién lo usa | Abierto hacia internet |
|---|---|---|
| 443 | Nginx (HTTPS, el chat) | Sí |
| 80 | Nginx (redirige a 443 y renueva el certificado) | Sí |
| 22 | SSH | Sí (idealmente solo desde IPs conocidas) |
| 8083 y otros | Los otros sistemas | Según los usen |
| 3000 | El chat, solo para Nginx | **No** |
| 3306 | MySQL | **No** |

---

## 7. Respaldos

Diarios, guardados **fuera** del servidor, y probar restaurar al menos una vez:

```bash
mysqldump -u chat -p chat_cormudesi | gzip > respaldo-$(date +%F).sql.gz
tar czf uploads-$(date +%F).tar.gz -C /opt/chat-global uploads
```

## 8. Correo

El doble factor depende del SMTP: si falla, nadie puede entrar (en modo web el código nunca queda en la consola; el error aparece en Admin → Errores). Usar una cuenta institucional y configurar **SPF y DKIM** en el dominio para que los códigos no lleguen a spam.

## 9. Actualizar el chat

```bash
cd /opt/chat-global
git pull
npm install
pm2 restart chat
```

---

## Lista antes de abrirlo

- [ ] `pm2 status` muestra `chat` en `online`, y `pm2 logs chat` la línea `[WEB] ...` sin errores.
- [ ] `https://aurora.cormudesi.cl` carga con candado, **sin** el aviso "Descargar certificado".
- [ ] Ingresar como `admin`: llega el código al correo de `ADMIN_EMAIL_INICIAL`. Cambiar la contraseña inicial.
- [ ] Desde fuera del servidor, el puerto 3000 y el 3306 **no** responden.
- [ ] Enviar un mensaje y un archivo; activar la alerta y ver que llega el correo con la hora correcta.
- [ ] Los otros sistemas siguen funcionando igual que antes.
- [ ] Revisar con la unidad legal los Términos y la Política de Privacidad (dónde se alojan los datos).
