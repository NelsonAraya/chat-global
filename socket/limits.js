// Límites contra abuso: bloqueo por intentos fallidos y límite de velocidad de eventos por persona.

module.exports = (ctx) => {
  const { users } = ctx;

  // ===== Límite de intentos fallidos (en memoria) =====
  // Frena la fuerza bruta: tras varios fallos, esa cuenta queda bloqueada un rato. Se bloquea la cuenta y no
  // la IP: detrás de un proxy (o de la salida a internet de un centro) todos comparten la misma IP, y unos
  // pocos errores de cualquiera dejaban a todos sin poder entrar.
  const LOGIN_FAIL_WINDOW_MS = 15 * 60 * 1000;
  const LOGIN_LOCK_MS = 15 * 60 * 1000;
  const LOGIN_MAX_FAILS_PER_USER = 5;
  const ROOM_MAX_FAILS_PER_USER = 10;
  const failBuckets = new Map(); // clave -> { count, resetAt, lockedUntil }

  const lockMinutesLeft = (key) => {
    const b = failBuckets.get(key);
    if (!b || b.lockedUntil <= Date.now()) return 0;
    return Math.ceil((b.lockedUntil - Date.now()) / 60000);
  };
  const registerFailure = (key, max) => {
    const now = Date.now();
    let b = failBuckets.get(key);
    if (!b || (b.resetAt <= now && b.lockedUntil <= now)) b = { count: 0, resetAt: now + LOGIN_FAIL_WINDOW_MS, lockedUntil: 0 };
    b.count++;
    if (b.count >= max) {
      b.lockedUntil = now + LOGIN_LOCK_MS;
      b.count = 0;
      b.resetAt = b.lockedUntil;
    }
    failBuckets.set(key, b);
  };
  const clearFailures = (key) => failBuckets.delete(key);
  const lockedError = (minutes) => 'Demasiados intentos fallidos. Intenta de nuevo en ' + minutes + ' minuto' + (minutes === 1 ? '' : 's') + '.';

  // Limpieza periódica de los registros vencidos.
  setInterval(() => {
    const now = Date.now();
    for (const [k, b] of failBuckets) if (b.resetAt <= now && b.lockedUntil <= now) failBuckets.delete(k);
  }, 10 * 60 * 1000).unref();

  // ===== Límite de velocidad por persona =====
  // Sin esto, un script podía mandar cientos de mensajes por segundo (cada uno se guarda y llega a todos los
  // de la sala). Cada persona (o cada conexión, antes de iniciar sesión) tiene una "cubeta" por tipo de
  // acción: puede hacer `burst` seguidas y recupera `perSecond` por segundo. Una persona escribiendo normal
  // nunca llega al límite. La alerta tiene su propia espera y nunca se frena aquí.
  const RATE_LIMITS = {
    message: { burst: 8, perSecond: 1 },   // mensajes de sala, privados y de grupo
    reaction: { burst: 10, perSecond: 2 },
    other: { burst: 40, perSecond: 4 }     // todo lo demás (al entrar el navegador pide varias cosas a la vez)
  };
  const RATE_CATEGORY = { 'room-message': 'message', 'private-message': 'message', 'group-message': 'message', 'add-reaction': 'reaction' };
  const RATE_EXEMPT = new Set(['disconnect', 'disconnecting', 'panic-alert', 'client-error']);
  const RATE_ERROR = 'Vas muy rápido. Espera un momento e inténtalo de nuevo.';
  const rateBuckets = new Map(); // "persona|tipo" -> { tokens, at }
  const allowEvent = (socket, event) => {
    if (RATE_EXEMPT.has(event)) return true;
    const category = RATE_CATEGORY[event] || 'other';
    const { burst, perSecond } = RATE_LIMITS[category];
    const key = (users.get(socket.id)?.username || 'sid:' + socket.id) + '|' + category;
    const now = Date.now();
    const b = rateBuckets.get(key) || { tokens: burst, at: now };
    b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * perSecond);
    b.at = now;
    rateBuckets.set(key, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  };
  setInterval(() => {
    const idle = Date.now() - 60 * 1000; // en un minuto sin uso cualquier cubeta ya está llena
    for (const [key, b] of rateBuckets) if (b.at < idle) rateBuckets.delete(key);
  }, 5 * 60 * 1000).unref();

  // Contraseñas nuevas de cuentas (registro, cambio y restablecimiento). Las actuales más cortas siguen sirviendo.
  const MIN_PASSWORD_LENGTH = 8;
  const PASSWORD_LENGTH_ERROR = 'La contraseña debe tener al menos ' + MIN_PASSWORD_LENGTH + ' caracteres';

  Object.assign(ctx, { LOGIN_MAX_FAILS_PER_USER, MIN_PASSWORD_LENGTH, PASSWORD_LENGTH_ERROR, ROOM_MAX_FAILS_PER_USER, lockMinutesLeft, registerFailure,
    clearFailures, lockedError, RATE_ERROR, allowEvent });
};
