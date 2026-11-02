// Archivos subidos: tokens de subida, de quién es cada archivo y borrado del disco.
const fs = require('fs');
const path = require('path');
const { sanitizeFile } = require('./validation');

module.exports = (ctx) => {
  const { users } = ctx;

  const uploadTokens = new Map(); // token -> socket.id, solo usuarios autenticados pueden subir archivos

  // ===== Archivos subidos: de quién son =====
  // Antes un mensaje aceptaba cualquier /uploads/...: alguien podía adjuntar el archivo de otra persona en una
  // sala temporal suya y, al cerrarse la sala, el archivo se borraba para todos. Ahora el servidor recuerda
  // quién subió cada archivo y solo esa persona puede usarlo, una sola vez (un archivo pertenece a un único
  // mensaje o foto de perfil). Los datos del archivo (nombre, tamaño, tipo) son los que registró el servidor.
  // Lo que se sube y no se usa en UPLOAD_CLAIM_MS se borra del disco.
  const UPLOAD_CLAIM_MS = 60 * 60 * 1000;
  const FILE_ERROR = 'El archivo no es válido o ya se usó. Vuelve a adjuntarlo.';
  const pendingUploads = new Map(); // url -> { username, file, at }
  const registerUpload = (token, fileInfo) => {
    const sid = uploadTokens.get(token);
    const u = sid && users.get(sid);
    const file = sanitizeFile(fileInfo);
    if (!u || !file) return false;
    pendingUploads.set(file.url, { username: u.username, file, at: Date.now() });
    return true;
  };
  // Tope por persona, revisado antes de recibir el archivo: sin esto un script con sesión podía subir archivos de
  // 2 MB sin parar y llenar el disco del servidor. Una persona normal nunca llega a estos números.
  const UPLOAD_MAX_PER_HOUR = 60;
  const UPLOAD_MAX_PENDING = 10; // subidos y aún sin usar en un mensaje o foto
  const UPLOAD_LIMIT_ERROR = 'Subiste demasiados archivos seguidos. Espera un momento e inténtalo de nuevo.';
  const uploadTimes = new Map(); // username -> [horas de subida en la última hora]
  const canUpload = (token) => {
    const sid = uploadTokens.get(token);
    const u = sid && users.get(sid);
    if (!u) return false;
    const now = Date.now();
    const recent = (uploadTimes.get(u.username) || []).filter(t => now - t < 60 * 60 * 1000);
    let pending = 0;
    for (const entry of pendingUploads.values()) if (entry.username === u.username) pending++;
    if (recent.length >= UPLOAD_MAX_PER_HOUR || pending >= UPLOAD_MAX_PENDING) {
      uploadTimes.set(u.username, recent);
      return false;
    }
    recent.push(now);
    uploadTimes.set(u.username, recent);
    return true;
  };
  setInterval(() => {
    const limit = Date.now() - 60 * 60 * 1000;
    for (const [name, list] of uploadTimes) if (!list.some(t => t > limit)) uploadTimes.delete(name);
  }, 10 * 60 * 1000).unref();
  const takeUpload = (url, username) => {
    const entry = typeof url === 'string' ? pendingUploads.get(url) : null;
    if (!entry || entry.username !== username) return null;
    pendingUploads.delete(url);
    return entry;
  };
  const returnUpload = (entry) => { if (entry) pendingUploads.set(entry.file.url, entry); };
  // Adjunto de un mensaje: { upload } (null si no trae archivo) o { error }.
  const claimMessageFile = (fileData, username) => {
    if (!fileData) return { upload: null };
    const upload = takeUpload(fileData?.url, username);
    return upload ? { upload } : { error: FILE_ERROR };
  };
  setInterval(() => {
    const limit = Date.now() - UPLOAD_CLAIM_MS;
    for (const [url, entry] of pendingUploads) {
      if (entry.at < limit) {
        pendingUploads.delete(url);
        deleteUploadedFile(url);
      }
    }
  }, 10 * 60 * 1000).unref();

  // Borra del disco un archivo subido (los mensajes guardan su URL /uploads/<nombre>). En segundo plano:
  // borrarlos de a uno esperando cada uno congelaba el chat de todos al eliminar una sala con muchos archivos.
  const deleteUploadedFile = (url) => {
    if (typeof url !== 'string' || !url.startsWith('/uploads/')) return;
    fs.promises.unlink(path.join(__dirname, '..', 'uploads', path.basename(url))).catch(() => {});
  };

  Object.assign(ctx, { uploadTokens, registerUpload, canUpload, UPLOAD_LIMIT_ERROR, takeUpload, returnUpload, claimMessageFile, deleteUploadedFile });
};
