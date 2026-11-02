// Validación de los datos que llegan del navegador (textos, archivos, correos) y la IP real de quien se conecta.

// ===== Validación de datos que llegan del navegador =====
// Los archivos solo pueden apuntar a /uploads/ (lo que generó /api/upload); cualquier otra URL se descarta
// para evitar inyección de código al mostrar el mensaje.
const UPLOAD_URL_RE = /^\/uploads\/[A-Za-z0-9._-]+$/;
const MIME_RE = /^[\w.+-]+\/[\w.+-]+$/;

const sanitizeFile = (file) => {
  if (!file || typeof file !== 'object') return null;
  if (typeof file.url !== 'string' || !UPLOAD_URL_RE.test(file.url) || file.url.includes('..')) return null;
  const size = Number(file.size);
  return {
    url: file.url,
    name: String(file.name || 'archivo').slice(0, 255),
    size: Number.isFinite(size) && size >= 0 ? Math.round(size) : 0,
    type: typeof file.type === 'string' && MIME_RE.test(file.type) ? file.type.slice(0, 100) : 'application/octet-stream'
  };
};

const sanitizeContent = (content) => (typeof content === 'string' ? content.trim().slice(0, 5000) : '');

// Texto recibido del navegador: si no es un string (número, objeto, lista...) se trata como vacío.
const str = (value) => (typeof value === 'string' ? value : '');

// IP real de quien se conecta (para registrar el consentimiento y las sesiones, no para bloquear). Detrás
// de un proxy en el mismo equipo (Nginx), la conexión llega desde 127.0.0.1 y la IP real viene en
// X-Forwarded-For: se toma la última, que es la que agregó el proxy (las anteriores las puede inventar
// cualquiera). Si la conexión no viene del propio equipo, la cabecera se ignora.
// Si el proxy está en otro equipo, su IP va en PROXY_IPS (.env, separadas por comas).
const TRUSTED_PROXY_IPS = (process.env.PROXY_IPS || '').split(',').map(s => s.trim()).filter(Boolean);
const clientIp = (socket) => {
  const addr = socket.handshake.address || '';
  const forwarded = socket.handshake.headers?.['x-forwarded-for'];
  const fromProxy = /^(127\.|::1$|::ffff:127\.)/.test(addr) || TRUSTED_PROXY_IPS.includes(addr.replace(/^::ffff:/, ''));
  if (forwarded && fromProxy) {
    const last = String(forwarded).split(',').map(s => s.trim()).filter(Boolean).pop();
    if (last) return last.slice(0, 64);
  }
  return addr;
};

// Solo correos institucionales o Gmail, con formato estricto: letras, números y . _ % + - antes de la @,
// sin puntos al inicio/fin ni seguidos. Se configura con ALLOWED_EMAIL_DOMAINS en .env.
const ALLOWED_EMAIL_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS || 'cormudesi.cl,gmail.com')
  .split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
const EMAIL_LOCAL_RE = /^[a-z0-9_%+-]+(\.[a-z0-9_%+-]+)*$/;
const allowedDomainsText = ALLOWED_EMAIL_DOMAINS.map(d => '@' + d).join(' o ');

// Devuelve null si el correo es válido, o el mensaje de error para mostrar.
const emailError = (email) => {
  const at = email.lastIndexOf('@');
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (at <= 0 || email.length > 254 || local.length > 64 || !EMAIL_LOCAL_RE.test(local)) return 'Correo no válido';
  if (!ALLOWED_EMAIL_DOMAINS.includes(domain)) return 'Solo se aceptan correos ' + allowedDomainsText;
  return null;
};

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const maskEmail = (email) => {
  const [local, domain] = String(email).split('@');
  if (!domain) return email;
  const visible = local.length <= 2 ? local[0] : local.slice(0, 2);
  return visible + '***@' + domain;
};

module.exports = { sanitizeFile, sanitizeContent, str, clientIp, ALLOWED_EMAIL_DOMAINS, emailError, normalizeEmail,
  maskEmail };
