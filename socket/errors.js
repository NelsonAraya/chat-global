// Registro de errores del sistema (panel del administrador general) y errores enviados por el navegador.
const { isSuperAdmin } = require('./permissions');
const { str } = require('./validation');

module.exports = (ctx) => {
  const { errorLog, io, ADMIN_ROOM, users } = ctx;
  const { deleteOldResolvedErrors, getErrorLog, countPendingErrors, setErrorResolved } = ctx.db;

  const ERROR_LOG_KEEP_RESOLVED_MS = 90 * 24 * 60 * 60 * 1000;
  const deleteOldErrors = () => {
    deleteOldResolvedErrors(new Date(Date.now() - ERROR_LOG_KEEP_RESOLVED_MS).toISOString())
      .catch(err => console.error('deleteOldResolvedErrors error:', err));
  };
  deleteOldErrors();
  setInterval(deleteOldErrors, 60 * 60 * 1000).unref();

  // ===== Registro de errores (panel de administración) =====
  const ERROR_LOG_PAGE_SIZE = 50;
  let errorNoticeTimer = null;
  if (errorLog) {
    errorLog.onNewError(() => {
      if (errorNoticeTimer) return;
      errorNoticeTimer = setTimeout(() => {
        errorNoticeTimer = null;
        io.to(ADMIN_ROOM).emit('error-logged');
      }, 5000);
      errorNoticeTimer.unref();
    });
  }
  // Errores del navegador: solo de usuarios con sesión y con límite, para que nadie llene el registro.
  const CLIENT_ERROR_MAX_PER_MIN = 10;

  return (socket) => {
    socket.on('get-error-log', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!isSuperAdmin(user)) return callback?.({ ok: false, errors: [], hasMore: false, pendingCount: 0 });
      const offset = Math.max(0, Math.floor(Number(data_?.offset) || 0));
      const rows = await getErrorLog(ERROR_LOG_PAGE_SIZE + 1, offset, !!data_?.onlyPending);
      callback?.({
        ok: true,
        errors: rows.slice(0, ERROR_LOG_PAGE_SIZE),
        hasMore: rows.length > ERROR_LOG_PAGE_SIZE,
        pendingCount: await countPendingErrors()
      });
    });

    socket.on('get-error-count', async (callback) => {
      const user = users.get(socket.id);
      if (!isSuperAdmin(user)) return callback?.({ pendingCount: 0 });
      callback?.({ pendingCount: await countPendingErrors() });
    });

    socket.on('admin-resolve-error', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!isSuperAdmin(user)) return callback?.({ ok: false, error: 'No autorizado' });
      const id = Number(data_?.id);
      if (!Number.isInteger(id)) return callback?.({ ok: false, error: 'Error no válido' });
      await setErrorResolved(id, !!data_?.resolved, user.username);
      callback?.({ ok: true, pendingCount: await countPendingErrors() });
    });

    socket.on('client-error', (data_) => {
      const user = users.get(socket.id);
      if (!user || !errorLog) return;
      const now = Date.now();
      socket.clientErrorTimes = (socket.clientErrorTimes || []).filter(t => now - t < 60000);
      if (socket.clientErrorTimes.length >= CLIENT_ERROR_MAX_PER_MIN) return;
      socket.clientErrorTimes.push(now);
      const message = str(data_?.message).slice(0, 1000) || 'Error desconocido';
      const where = str(data_?.where).slice(0, 300);
      const err = new Error(message);
      err.stack = [str(data_?.stack).slice(0, 4000), where && 'en ' + where, 'Navegador: ' + str(socket.handshake.headers?.['user-agent']).slice(0, 200)]
        .filter(Boolean).join('\n');
      errorLog.report(err, { source: 'navegador', username: user.username });
    });
  };
};
