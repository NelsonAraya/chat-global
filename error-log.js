const util = require('util');

// Registro de errores del sistema: todo lo que el servidor escribe con console.error, los errores no
// capturados y los que informa el navegador se guardan en la base (tabla error_log), para que los
// administradores los vean en el panel y puedan avisar a los desarrolladores qué pasó.
//
// - El mismo error repetido (mismo origen y mensaje) dentro de REPEAT_WINDOW_MS no crea filas nuevas:
//   suma una "ocurrencia" a la fila existente, así un problema que se repite no llena la base.
// - Si la base no responde, los errores quedan en memoria (hasta MAX_PENDING) y se reintentan después.
const REPEAT_WINDOW_MS = 10 * 60 * 1000;
const MAX_PENDING = 200;
const RETRY_MS = 60 * 1000;
const MAX_MESSAGE = 2000;
const MAX_STACK = 8000;

module.exports = (db) => {
  const originalConsoleError = console.error.bind(console);
  const recent = new Map(); // origen|mensaje -> { id, at }
  const pending = [];
  const listeners = [];
  let flushing = false;

  const save = async (entry) => {
    const key = entry.source + '|' + entry.message;
    const prev = recent.get(key);
    if (prev && Date.now() - prev.at < REPEAT_WINDOW_MS) {
      prev.at = Date.now();
      await db.bumpErrorLog(prev.id, entry.created_at);
      return { id: prev.id, repeated: true };
    }
    const id = await db.saveErrorLog(entry);
    recent.set(key, { id, at: Date.now() });
    return { id, repeated: false };
  };

  const flush = async () => {
    if (flushing) return;
    flushing = true;
    try {
      while (pending.length > 0) {
        const result = await save(pending[0]);
        const entry = pending.shift();
        listeners.forEach(fn => { try { fn({ ...entry, ...result }); } catch {} });
      }
    } catch (err) {
      // La base sigue sin responder: se vuelve a intentar más tarde.
      setTimeout(flush, RETRY_MS).unref();
    } finally {
      flushing = false;
    }
  };

  // Guarda un error. `source` indica dónde ocurrió (p. ej. 'evento room-message', 'navegador').
  const report = (err, { source = 'servidor', username = null, context = '' } = {}) => {
    const isError = err instanceof Error;
    const base = isError ? err.message : (typeof err === 'string' ? err : util.inspect(err, { depth: 2 }));
    const message = ((context ? context + ' ' : '') + base).slice(0, MAX_MESSAGE);
    const stack = (isError && err.stack ? String(err.stack) : '').slice(0, MAX_STACK) || null;
    if (pending.length >= MAX_PENDING) pending.shift();
    pending.push({ source: String(source).slice(0, 120), message, stack, username, created_at: new Date().toISOString() });
    flush();
  };

  // Todo console.error del servidor también queda registrado (sigue apareciendo en la consola).
  console.error = (...args) => {
    originalConsoleError(...args);
    try {
      const err = args.find(a => a instanceof Error);
      const context = args.filter(a => typeof a === 'string').join(' ').trim();
      const others = args.filter(a => a !== err && typeof a !== 'string');
      const detail = err || (others.length ? others.map(o => util.inspect(o, { depth: 2 })).join(' ') : '');
      report(detail || context, { context: detail ? context : '' });
    } catch {}
  };

  // Promesas rechazadas sin manejar: se registran y el servidor sigue funcionando.
  process.on('unhandledRejection', (reason) => {
    console.error('Promesa rechazada sin manejar:', reason);
  });

  // Error no capturado: se registra y el proceso termina (su estado ya no es confiable). Se da un
  // momento para guardarlo en la base antes de salir.
  process.on('uncaughtException', (err) => {
    originalConsoleError('Error no capturado:', err);
    report(err, { source: 'proceso (error no capturado)' });
    setTimeout(() => process.exit(1), 2000);
  });

  return {
    report,
    onNewError: (fn) => listeners.push(fn)
  };
};
