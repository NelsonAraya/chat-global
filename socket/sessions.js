// Sesiones guardadas del navegador (token) y su cierre al cerrar la pestaña.
const crypto = require('crypto');

module.exports = (ctx) => {
  const { io } = ctx;
  const { deleteSession, deleteExpiredSessions } = ctx.db;

  // ===== Sesiones =====
  // Tras el login (contraseña + código) el navegador recibe un token de sesión; con él puede recargar la
  // página sin volver a ingresar. Sin "Recordar este equipo" dura mientras la pestaña esté abierta (máx. 12 h);
  // con la casilla marcada, 7 días. En la base solo se guarda el hash del token.
  const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
  const SESSION_REMEMBER_MS = 7 * 24 * 60 * 60 * 1000;
  const SESSION_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
  const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

  // Sin "Recordar este equipo", al cortarse la conexión se espera un momento: una recarga vuelve a conectar
  // enseguida con la misma sesión; si nadie la retoma (se cerró la pestaña o la ventana), se borra. Así no
  // sirve que el navegador restaure la pestaña con su sessionStorage.
  const SESSION_CLOSE_GRACE_MS = 60 * 1000;
  // Cada conexión que usa una sesión (conectada o reanudándola, p. ej. eligiendo departamento) está en la sala
  // interna 'session:<hash>'. Saber si una sesión sigue en uso es mirar esa sala, sin recorrer a todos los
  // conectados. Socket.IO la deja sola al desconectarse.
  const sessionRoom = (tokenHash) => 'session:' + tokenHash;
  const setSocketSession = (socket, tokenHash) => {
    if (socket.chatSessionRoom) socket.leave(socket.chatSessionRoom);
    socket.chatSessionRoom = tokenHash ? sessionRoom(tokenHash) : null;
    if (socket.chatSessionRoom) socket.join(socket.chatSessionRoom);
  };
  const isSessionInUse = (tokenHash) => (io.sockets.adapter.rooms.get(sessionRoom(tokenHash))?.size || 0) > 0;
  const scheduleSessionClose = (tokenHash) => {
    setTimeout(() => {
      if (!isSessionInUse(tokenHash)) {
        deleteSession(tokenHash).catch(err => console.error('deleteSession error:', err));
      }
    }, SESSION_CLOSE_GRACE_MS).unref();
  };

  const hourlyCleanup = () => {
    deleteExpiredSessions().catch(err => console.error('deleteExpiredSessions error:', err));
  };
  hourlyCleanup();
  setInterval(hourlyCleanup, 60 * 60 * 1000).unref();

  Object.assign(ctx, { SESSION_TTL_MS, SESSION_REMEMBER_MS, SESSION_TOKEN_RE, hashToken, setSocketSession,
    scheduleSessionClose });
};
