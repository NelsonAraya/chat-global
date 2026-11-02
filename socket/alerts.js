// Botón de alerta e historial de alertas.
const { sendPanicAlertEmail } = require('../mailer');
const { adminScope } = require('./permissions');

module.exports = (ctx) => {
  const { users, data, departmentRoom, ADMIN_ROOM } = ctx;
  const { saveAlert, getAlertHistory } = ctx.db;

  const PANIC_COOLDOWN_MS = 30 * 1000;
  const lastPanicAt = new Map(); // username -> hora de su última alerta (se borra al pasar la espera)

  return (socket) => {
    socket.on('panic-alert', (callback) => {
      const user = users.get(socket.id);
      if (!user) return;
      if (typeof callback !== 'function') callback = null;
      // La alerta es para un departamento: sin uno (p. ej. el administrador general) no se puede enviar.
      if (!user.department) return callback?.({ ok: false, error: 'Debes pertenecer a un departamento para enviar una alerta' });

      // Una alerta cada 30 segundos por persona: la primera ya avisó, repetirla solo hace ruido (spam).
      const last = lastPanicAt.get(user.username) || 0;
      const waitMs = PANIC_COOLDOWN_MS - (Date.now() - last);
      if (waitMs > 0) return callback?.({ ok: false, waitSeconds: Math.ceil(waitMs / 1000) });
      lastPanicAt.set(user.username, Date.now());
      setTimeout(() => lastPanicAt.delete(user.username), PANIC_COOLDOWN_MS).unref();

      const deptRecord = user.department ? data.departments.find(d => d.name === user.department) : null;
      const timestamp = new Date().toISOString();
      const payload = {
        username: user.username,
        displayName: user.displayName || user.username,
        location: user.location || '',
        department: user.department || null,
        departmentDisplayName: deptRecord?.displayName || user.department || null,
        timestamp
      };

      // Le llega a su departamento y a los administradores generales (menos a quien la envía).
      socket.to([departmentRoom(user.department), ADMIN_ROOM]).emit('panic-alert', payload);

      saveAlert({
        username: user.username,
        displayName: user.displayName || user.username,
        department: user.department || null,
        departmentDisplayName: deptRecord?.displayName || user.department || null,
        location: user.location || '',
        created_at: timestamp
      }).catch(err => console.error('saveAlert error:', err));

      sendPanicAlertEmail(payload).catch(err => console.error('sendPanicAlertEmail error:', err));
      callback?.({ ok: true, waitSeconds: PANIC_COOLDOWN_MS / 1000 });
    });

    socket.on('get-alert-history', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user || user.role !== 'admin') return callback?.({ alerts: [], hasMore: false });

      const limit = 50;
      const offset = Math.max(0, Math.floor(Number(data_?.offset) || 0));
      try {
        // El admin de departamento ve solo las alertas de sus departamentos.
        const rows = await getAlertHistory(limit + 1, offset, adminScope(user));
        const hasMore = rows.length > limit;
        callback?.({ alerts: rows.slice(0, limit), hasMore });
      } catch (err) {
        console.error('get-alert-history error:', err);
        callback?.({ alerts: [], hasMore: false });
      }
    });
  };
};
