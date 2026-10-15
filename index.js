require('dotenv').config();

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

const app = express();

app.use(express.static(path.join(__dirname, 'public')));

const UPLOADS_DIR = path.join(__dirname, 'uploads');
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = crypto.randomUUID() + ext;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }
});

let socketHandlers = null;

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibió archivo' });
  }
  const token = req.body?.token;
  if (!token || !socketHandlers || !socketHandlers.isValidUploadToken(token)) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(401).json({ error: 'No autorizado' });
  }
  res.json({
    url: '/uploads/' + req.file.filename,
    name: req.file.originalname,
    size: req.file.size,
    type: req.file.mimetype
  });
});

app.use('/uploads', express.static(UPLOADS_DIR));

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

  socketHandlers = require('./socket-handler')(io, db);

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
