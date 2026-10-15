const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT || 587;
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;
const ALERT_EMAIL_FROM = process.env.ALERT_EMAIL_FROM || SMTP_USER;
const ALERT_EMAIL_TO = process.env.ALERT_EMAIL_TO;

let transporter = null;
if (SMTP_HOST && SMTP_USER && SMTP_PASSWORD) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD }
  });
}

let warnedMissingConfig = false;

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function sendPanicAlertEmail(payload) {
  if (!transporter || !ALERT_EMAIL_TO) {
    if (!warnedMissingConfig) {
      console.warn('[mailer] Envío de correo de alerta no configurado (faltan SMTP_* / ALERT_EMAIL_TO en .env). Se omite el envío por correo.');
      warnedMissingConfig = true;
    }
    return;
  }

  const dept = payload.departmentDisplayName || 'Global / sin departamento';
  const loc = payload.location && payload.location.trim() ? payload.location : 'Indeterminada';
  const when = new Date(payload.timestamp || Date.now()).toLocaleString('es-CL');
  const who = payload.displayName || payload.username;

  await transporter.sendMail({
    from: ALERT_EMAIL_FROM,
    to: ALERT_EMAIL_TO,
    subject: '🚨 Alerta de pánico - ' + who,
    text:
      'Se activó el botón de alerta en el Chat CORMUDESI.\n\n' +
      'Usuario: ' + who + ' (@' + payload.username + ')\n' +
      'Departamento: ' + dept + '\n' +
      'Ubicación: ' + loc + '\n' +
      'Fecha y hora: ' + when + '\n',
    html:
      '<h2>🚨 Alerta de pánico</h2>' +
      '<p>Se activó el botón de alerta en el Chat CORMUDESI.</p>' +
      '<table cellpadding="6" style="border-collapse:collapse;">' +
      '<tr><td><strong>Usuario</strong></td><td>' + escapeHtml(who) + ' (@' + escapeHtml(payload.username) + ')</td></tr>' +
      '<tr><td><strong>Departamento</strong></td><td>' + escapeHtml(dept) + '</td></tr>' +
      '<tr><td><strong>Ubicación</strong></td><td>' + escapeHtml(loc) + '</td></tr>' +
      '<tr><td><strong>Fecha y hora</strong></td><td>' + escapeHtml(when) + '</td></tr>' +
      '</table>'
  });
}

module.exports = { sendPanicAlertEmail };
