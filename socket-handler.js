// Eventos del chat en tiempo real (Socket.IO). Cada parte del chat está en su propio archivo dentro de socket/.
// Todas comparten un mismo contexto (ctx): cada archivo deja ahí lo que usan los demás y puede usar lo que dejaron
// los archivos anteriores de esta lista, por eso el orden importa.
// validation.js y permissions.js no guardan estado: los demás los cargan directamente con require.
const MODULES = [
  'state', 'uploads', 'sessions', 'limits', 'presence', 'messages', 'friends', 'groups', 'rooms', 'private',
  'auth', 'profile', 'admin', 'alerts', 'errors'
].map(name => require('./socket/' + name));

module.exports = (io, db, errorLog) => {
  const ctx = { io, db, data: db.data, errorLog };
  // Cada archivo devuelve (si tiene eventos) la función que los registra en cada conexión.
  const registerEvents = MODULES.map(init => init(ctx)).filter(Boolean);
  const { users, allowEvent, RATE_ERROR, uploadTokens, registerUpload, canUpload, UPLOAD_LIMIT_ERROR } = ctx;

  io.on('connection', (socket) => {
    // Un error en un evento (p. ej. datos mal formados enviados a propósito) no debe botar el servidor:
    // se registra en la consola y, si el navegador espera respuesta, se le responde con un error.
    const on = socket.on.bind(socket);
    socket.on = (event, handler) => on(event, (...args) => {
      const ack = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
      if (!allowEvent(socket, event)) {
        try { ack?.({ ok: false, error: RATE_ERROR }); } catch {}
        return;
      }
      const fail = (err) => {
        const username = users.get(socket.id)?.username || null;
        if (errorLog) errorLog.report(err, { source: 'evento ' + event, username });
        else console.error(`Error en el evento "${event}":`, err);
        try { ack?.({ ok: false, error: 'Solicitud no válida' }); } catch {}
      };
      try {
        const result = handler(...args);
        if (result && typeof result.then === 'function') result.catch(fail);
      } catch (err) {
        fail(err);
      }
    });

    for (const register of registerEvents) register(socket);
  });

  return {
    isValidUploadToken: (token) => uploadTokens.has(token),
    registerUpload,
    canUpload,
    UPLOAD_LIMIT_ERROR
  };
};
