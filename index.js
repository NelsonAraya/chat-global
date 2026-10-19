require('dotenv').config();
// scrypt (contraseñas) corre en el grupo de hilos de Node, que por defecto tiene solo 4: con cientos de ingresos
// a la vez (p. ej. a las 8:00) harían cola. Debe fijarse antes de que se use el primer hilo.
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '16';

const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const multer = require('multer');
const forge = require('node-forge');
const compression = require('compression');

const app = express();
app.disable('x-powered-by');

// Comprime las respuestas (app.js, estilos, HTML): con 2000 equipos entrando a la vez se envía ~4 veces menos.
app.use(compression());

// Cabeceras de seguridad de la página. Los archivos subidos (/uploads) llevan su propia política, más estricta.
const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
  "font-src 'self' https://cdnjs.cloudflare.com data:",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY'); // nadie puede mostrar el chat dentro de otra página
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');
  if (!req.path.startsWith('/uploads/')) res.setHeader('Content-Security-Policy', PAGE_CSP);
  next();
});

// Los navegadores siempre preguntan si hay una versión nueva (ETag): una recarga trae solo lo que cambió.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache')
}));

const UPLOADS_DIR = path.join(__dirname, 'uploads');
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    // Solo letras y números en la extensión: la URL resultante debe ser segura de mostrar en el chat.
    const ext = path.extname(file.originalname).replace(/[^A-Za-z0-9]/g, '').slice(0, 10);
    const name = crypto.randomUUID() + (ext ? '.' + ext.toLowerCase() : '');
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }
});

let socketHandlers = null;

// La autorización se revisa ANTES de recibir el archivo (va en la cabecera X-Upload-Token): así nadie sin
// sesión puede escribir en el disco del servidor.
app.post('/api/upload', (req, res, next) => {
  const token = req.get('X-Upload-Token');
  if (!token || !socketHandlers || !socketHandlers.isValidUploadToken(token)) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'El archivo es demasiado grande (máximo 2 MB)' });
    }
    if (err) return res.status(400).json({ error: 'Error al subir el archivo' });
    next();
  });
}, (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibió archivo' });
  }
  res.json({
    url: '/uploads/' + req.file.filename,
    name: req.file.originalname,
    size: req.file.size,
    type: req.file.mimetype
  });
});

// Los archivos subidos solo los ven usuarios con sesión abierta en el chat. Como <img>, <audio> y los
// enlaces no pueden mandar el token, tras ingresar el navegador lo canjea por una cookie (HttpOnly, solo
// para /uploads). El token deja de valer al desconectarse, al bloquear o al eliminar al usuario.
const FILE_COOKIE = 'chat_files';
const readCookie = (req, name) => {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
};

app.post('/api/file-access', express.json({ limit: '1kb' }), (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  if (!token || !socketHandlers || !socketHandlers.isValidUploadToken(token)) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  res.setHeader('Set-Cookie', `${FILE_COOKIE}=${encodeURIComponent(token)}; Path=/uploads; HttpOnly; Secure; SameSite=Strict`);
  res.json({ ok: true });
});

app.use('/uploads', (req, res, next) => {
  const token = readCookie(req, FILE_COOKIE);
  if (!token || !socketHandlers || !socketHandlers.isValidUploadToken(token)) {
    return res.status(401).send('Debes iniciar sesión en el chat para ver este archivo.');
  }
  res.setHeader('Cache-Control', 'private, no-store');
  next();
});

// Los archivos subidos nunca deben ejecutar código en el sitio (p. ej. un .html o .svg con scripts):
// se sirven en "sandbox", sin que el navegador adivine el tipo, y los que no son imagen/audio/video/PDF se descargan.
const INLINE_UPLOAD_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.mp3', '.wav', '.ogg', '.webm', '.m4a', '.mp4', '.pdf']);
app.use('/uploads', express.static(UPLOADS_DIR, {
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Chrome no muestra PDFs con CSP sandbox; un PDF igual no puede ejecutar código del sitio.
    if (ext !== '.pdf') {
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'");
    }
    if (!INLINE_UPLOAD_EXTS.has(ext)) {
      res.setHeader('Content-Disposition', 'attachment');
    }
  }
}));

app.get('/api/cert', (req, res) => {
  const CERT_PATH = path.join(__dirname, 'certs', 'cert.pem');
  if (fs.existsSync(CERT_PATH)) {
    res.download(CERT_PATH, 'Chat-CORMUDESI-cert.cer');
  } else {
    res.status(404).json({ error: 'Certificado no disponible' });
  }
});

const dbPromise = require('./db');

const HTTP_PORT = process.env.HTTP_PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

const getLocalIP = () => {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
};

const start = async () => {
  const db = await dbPromise;
  // Desde aquí, todo error del sistema queda guardado en la base y se ve en el panel de administración.
  const errorLog = require('./error-log')(db);

  // Errores en las rutas web (subida de archivos, descargas, etc.): se registran y se responde un error genérico.
  app.use((err, req, res, next) => {
    errorLog.report(err, { source: 'web ' + req.method + ' ' + req.path });
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  });

  const CERTS_DIR = path.join(__dirname, 'certs');
  const KEY_PATH = path.join(CERTS_DIR, 'key.pem');
  const CERT_PATH = path.join(CERTS_DIR, 'cert.pem');
  const CERT_IP_PATH = path.join(CERTS_DIR, 'ip.txt');

  const currentIP = getLocalIP();

  let needsRegenerate = false;
  if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) {
    const savedIP = fs.readFileSync(CERT_IP_PATH, 'utf8').trim();
    needsRegenerate = savedIP !== currentIP;
    if (needsRegenerate) {
      console.log(`[HTTPS] IP cambió (${savedIP} → ${currentIP}), regenerando certificado...`);
    }
  } else {
    needsRegenerate = true;
  }

  let httpsOptions;
  if (needsRegenerate) {
    if (!fs.existsSync(CERTS_DIR)) {
      fs.mkdirSync(CERTS_DIR, { recursive: true });
    }
    const pki = forge.pki;
    const keys = pki.rsa.generateKeyPair(2048);
    const cert = pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = Date.now().toString();
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 5);
    cert.setSubject([{ name: 'commonName', value: currentIP }]);
    cert.setIssuer([{ name: 'commonName', value: currentIP }]);
    cert.setExtensions([
      {
        name: 'basicConstraints',
        cA: true
      },
      {
        name: 'keyUsage',
        keyCertSign: true,
        digitalSignature: true,
        keyEncipherment: true
      },
      {
        name: 'extKeyUsage',
        serverAuth: true
      },
      {
        name: 'subjectAltName',
        altNames: [{ type: 7, ip: currentIP }]
      }
    ]);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    fs.writeFileSync(KEY_PATH, pki.privateKeyToPem(keys.privateKey), 'utf8');
    fs.writeFileSync(CERT_PATH, pki.certificateToPem(cert), 'utf8');
    fs.writeFileSync(CERT_IP_PATH, currentIP, 'utf8');
    httpsOptions = { key: pki.privateKeyToPem(keys.privateKey), cert: pki.certificateToPem(cert) };
    console.log(`[HTTPS] Certificado generado para IP: ${currentIP}`);
  } else {
    httpsOptions = {
      key: fs.readFileSync(KEY_PATH, 'utf8'),
      cert: fs.readFileSync(CERT_PATH, 'utf8'),
    };
  }

  // Servidor HTTPS: sirve la app + Socket.IO
  const httpsServer = https.createServer(httpsOptions, app);
  const io = new Server();
  io.attach(httpsServer);

  socketHandlers = require('./socket-handler')(io, db, errorLog);

  // Servidor HTTP: solo redirige a HTTPS
  const httpServer = http.createServer((req, res) => {
    const host = req.headers.host?.split(':')[0] || getLocalIP();
    res.writeHead(301, { Location: `https://${host}:${HTTPS_PORT}${req.url}` });
    res.end();
  });

  httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
    const ip = getLocalIP();
    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║           CHAT CORMUDESI                         ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║  Accede desde cualquier PC de la red:            ║`);
    console.log(`║  →  http://${ip}:${HTTP_PORT}                      ║`);
    console.log(`║                                                 ║`);
    console.log(`║  (redirige automáticamente a HTTPS)             ║`);
    console.log('╠══════════════════════════════════════════════════╣');
    console.log('║  HTTPS necesario para grabar audio              ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');
  });

  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    const ip = getLocalIP();
    console.log(`[HTTPS] Seguro: https://${ip}:${HTTPS_PORT}`);
  });
};

start();
