const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sendPanicAlertEmail, sendLoginCodeEmail } = require('./mailer');

module.exports = (io, db, errorLog) => {
  const {
    data, hashPassword, verifyPassword, isLegacyHash,
    saveUser, saveUserFields, deleteUser,
    saveRoom, deleteRoom,
    saveMessage, updateMessageReactions, deleteMessagesByRoom,
    getRoomMessages, getPrivateMessages, getGroupMessages, getMessage, getLastPrivateMessages, getLastGroupMessages,
    getRoomFileUrls, getGroupFileUrls, countMessages,
    saveDepartment, deleteDepartment,
    saveConsent,
    saveFriendRequest, updateFriendStatus, deleteFriendRow,
    saveGroup, renameGroup, deleteGroup, saveGroupMember, deleteGroupMember,
    saveSession, getSession, updateSessionDepartment, deleteSession, deleteUserSessions, deleteExpiredSessions,
    saveAlert, getAlertHistory,
    getErrorLog, countPendingErrors, setErrorResolved, deleteOldResolvedErrors
  } = db;
  const TERMS_VERSION = '1.0';
  const users = new Map();
  const roomUsers = new Map();
  const uploadTokens = new Map(); // token -> socket.id, solo usuarios autenticados pueden subir archivos

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

  // La cita de una respuesta se arma en el servidor a partir del mensaje original (el navegador solo indica
  // cuál responde): así nadie puede atribuirle a otro un texto que no escribió. El original debe ser de la
  // misma conversación; si no, la cita se descarta.
  const buildReply = async (reply, belongsHere) => {
    const id = Number(reply?.id);
    if (!Number.isFinite(id)) return null;
    const original = await getMessage(id);
    if (!original || !belongsHere(original)) return null;
    return {
      id: original.id,
      sender: original.sender,
      content: (original.content || (original.file ? '[Archivo]' : '')).slice(0, 500)
    };
  };

  const SEND_ERROR = 'No se pudo enviar el mensaje. Intenta de nuevo.';

  // El id de un mensaje es su marca de tiempo (ms) y define el orden del historial: siempre crece, aunque
  // lleguen dos mensajes en el mismo milisegundo o el reloj del equipo retroceda.
  let lastMessageId = db.maxMessageId || 0;
  const nextMessageId = () => {
    lastMessageId = Math.max(Date.now(), Math.floor(lastMessageId) + 1);
    return lastMessageId;
  };

  const sanitizeContent = (content) => (typeof content === 'string' ? content.trim().slice(0, 5000) : '');

  // Texto recibido del navegador: si no es un string (número, objeto, lista...) se trata como vacío.
  const str = (value) => (typeof value === 'string' ? value : '');

  // Solo se aceptan las reacciones que ofrece el selector del chat (misma lista que REACTION_EMOJIS en app.js).
  const REACTION_EMOJIS = new Set(['👍', '👎', '❤️', '😄', '😮', '😢', '😡', '🎉', '🔥', '✅']);

  // Borra del disco un archivo subido (los mensajes guardan su URL /uploads/<nombre>). En segundo plano:
  // borrarlos de a uno esperando cada uno congelaba el chat de todos al eliminar una sala con muchos archivos.
  const deleteUploadedFile = (url) => {
    if (typeof url !== 'string' || !url.startsWith('/uploads/')) return;
    fs.promises.unlink(path.join(__dirname, 'uploads', path.basename(url))).catch(() => {});
  };

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

  // Cierra todas las sesiones guardadas de un usuario (y su conexión activa, si se indica un motivo).
  const revokeUserSessions = async (username, kickReason) => {
    await deleteUserSessions(username);
    if (kickReason && kickUser(username, kickReason)) {
      notifyFriendsOfStatusChange(username);
    }
  };

  const ERROR_LOG_KEEP_RESOLVED_MS = 90 * 24 * 60 * 60 * 1000;
  const hourlyCleanup = () => {
    deleteExpiredSessions().catch(err => console.error('deleteExpiredSessions error:', err));
    deleteOldResolvedErrors(new Date(Date.now() - ERROR_LOG_KEEP_RESOLVED_MS).toISOString())
      .catch(err => console.error('deleteOldResolvedErrors error:', err));
  };
  hourlyCleanup();
  setInterval(hourlyCleanup, 60 * 60 * 1000).unref();

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

  // ===== Doble factor: código temporal enviado al correo registrado =====
  const OTP_TTL_MINUTES = 5;
  const OTP_TTL_MS = OTP_TTL_MINUTES * 60 * 1000;
  const OTP_MAX_ATTEMPTS = 5;
  const OTP_RESEND_COOLDOWN_MS = 30 * 1000;
  // Máximo de códigos que se envían a un mismo usuario por ventana: limita tanto adivinar
  // códigos (cada uno permite 5 intentos) como llenar de correos a una persona.
  const OTP_MAX_SENDS = 5;
  const OTP_SENDS_WINDOW_MS = 15 * 60 * 1000;
  const loginCodes = new Map(); // username -> { hash, email, expiresAt, attempts, sentAt }

  // Registro: máximo de solicitudes por hora (en total, no por IP: ver arriba) y tope de cuentas esperando
  // aprobación, para que nadie llene el panel del administrador con solicitudes falsas.
  const REGISTER_MAX_PER_HOUR = 30;
  const REGISTER_WINDOW_MS = 60 * 60 * 1000;
  const MAX_PENDING_REGISTRATIONS = 150;
  let registrationTimes = [];
  const recentRegistrationCount = () => {
    const now = Date.now();
    registrationTimes = registrationTimes.filter(t => now - t < REGISTER_WINDOW_MS);
    return registrationTimes.length;
  };

  // IP real de quien se conecta (para registrar el consentimiento y las sesiones, no para bloquear). Detrás
  // de un proxy en el mismo equipo (Nginx), la conexión llega desde 127.0.0.1 y la IP real viene en
  // X-Forwarded-For: se toma la última, que es la que agregó el proxy (las anteriores las puede inventar
  // cualquiera). Si la conexión no viene del propio equipo, la cabecera se ignora.
  const clientIp = (socket) => {
    const addr = socket.handshake.address || '';
    const forwarded = socket.handshake.headers?.['x-forwarded-for'];
    if (forwarded && /^(127\.|::1$|::ffff:127\.)/.test(addr)) {
      const last = String(forwarded).split(',').map(s => s.trim()).filter(Boolean).pop();
      if (last) return last.slice(0, 64);
    }
    return addr;
  };
  const codeSends = new Map(); // username -> [timestamps de envío]

  // Minutos que faltan para poder enviar otro código (0 = se puede).
  const codeSendWaitMinutes = (username) => {
    const now = Date.now();
    const recent = (codeSends.get(username) || []).filter(t => now - t < OTP_SENDS_WINDOW_MS);
    codeSends.set(username, recent);
    if (recent.length < OTP_MAX_SENDS) return 0;
    return Math.ceil((recent[0] + OTP_SENDS_WINDOW_MS - now) / 60000);
  };
  const tooManyCodesError = (minutes) => 'Se enviaron demasiados códigos. Espera ' + minutes + ' minuto' + (minutes === 1 ? '' : 's') + ' para pedir otro.';
  const codeSecondsLeft = (entry) => Math.max(1, Math.round((entry.expiresAt - Date.now()) / 1000));

  // Limpieza periódica de los registros vencidos.
  setInterval(() => {
    const now = Date.now();
    for (const [k, b] of failBuckets) if (b.resetAt <= now && b.lockedUntil <= now) failBuckets.delete(k);
    for (const [k, e] of loginCodes) if (e.expiresAt <= now) loginCodes.delete(k);
    for (const [k, list] of codeSends) if (!list.some(t => now - t < OTP_SENDS_WINDOW_MS)) codeSends.delete(k);
  }, 10 * 60 * 1000).unref();
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
  const hashCode = (code) => crypto.createHash('sha256').update(code).digest('hex');
  const maskEmail = (email) => {
    const [local, domain] = String(email).split('@');
    if (!domain) return email;
    const visible = local.length <= 2 ? local[0] : local.slice(0, 2);
    return visible + '***@' + domain;
  };
  const emailInUse = (email, exceptUsername) =>
    data.users.some(u => u.username !== exceptUsername && u.email && u.email.toLowerCase() === email);

  const issueLoginCode = async (userRecord, email) => {
    const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
    codeSends.set(userRecord.username, [...(codeSends.get(userRecord.username) || []), Date.now()]);
    loginCodes.set(userRecord.username, { hash: hashCode(code), email, expiresAt: Date.now() + OTP_TTL_MS, attempts: 0, sentAt: Date.now() });
    const sent = await sendLoginCodeEmail(email, code, userRecord.displayName || userRecord.username, OTP_TTL_MINUTES);
    if (!sent) {
      // Sin SMTP configurado no hay forma de entregar el código: se deja en la consola del servidor
      // para que el administrador pueda dárselo al usuario.
      console.warn(`[2FA] SMTP no configurado. Código de acceso para ${userRecord.username} (${email}): ${code}`);
    }
  };

  const getOnlineUsers = (roomName) => {
    const sockets = roomUsers.get(roomName);
    if (!sockets) return [];
    return Array.from(sockets)
      .map(sid => users.get(sid))
      .filter(Boolean)
      .map(u => ({ username: u.username, displayName: u.displayName || u.username, avatar: u.avatar || null }));
  };

  const isRoomEmpty = (roomName) => {
    const sockets = roomUsers.get(roomName);
    return !sockets || sockets.size === 0;
  };

  // ===== Índices en memoria =====
  // Buscar una cuenta o las amistades de alguien recorría la lista completa (2000 cuentas, decenas de miles de
  // amistades) en cada ingreso, salida y mensaje. Estos índices se rehacen solos cuando la lista cambia de
  // tamaño o se reemplaza (agregar = push, quitar = filter); los cambios dentro de una fila no los afectan.
  const lazyIndex = (getList, build) => {
    let list = null;
    let length = -1;
    let index = null;
    return () => {
      const current = getList();
      if (current !== list || current.length !== length) {
        list = current;
        length = current.length;
        index = build(current);
      }
      return index;
    };
  };
  const usersIndex = lazyIndex(() => data.users, list => new Map(list.map(u => [u.username, u])));
  const findUser = (username) => (typeof username === 'string' ? usersIndex().get(username) : undefined);

  // Salas por nombre: se buscan varias veces por cada mensaje, entrada o reacción.
  const roomsIndex = lazyIndex(() => data.rooms, list => new Map(list.map(r => [r.name, r])));
  const findRoom = (name) => roomsIndex().get(name);

  const friendsIndex = lazyIndex(() => data.friends, list => {
    const byUser = new Map();
    const add = (username, row) => {
      if (!byUser.has(username)) byUser.set(username, []);
      byUser.get(username).push(row);
    };
    for (const f of list) {
      add(f.requester, f);
      if (f.recipient !== f.requester) add(f.recipient, f);
    }
    return byUser;
  });
  const friendRowsOf = (username) => friendsIndex().get(username) || [];

  // ===== Administradores =====
  // Un admin SIN departamentos asignados es el administrador general: ve y administra todo.
  // Los demás admins lo son solo en los departamentos marcados como tales (adminDepartments); en el resto de
  // sus departamentos son usuarios normales. Solo ven y administran lo de sus departamentos de admin
  // (usuarios, salas, alertas y estadísticas). Las solicitudes de registro, los departamentos y el registro
  // de errores quedan solo para el administrador general.
  const isSuperAdmin = (u) => !!u && u.role === 'admin' && !(u.departments || []).length;
  const adminDeptsOf = (u) => (u && u.role === 'admin' ? (u.adminDepartments || []) : []);
  const isDeptAdmin = (u) => !isSuperAdmin(u) && adminDeptsOf(u).length > 0;

  // Departamentos "en los que está" un usuario conectado: aquellos donde es admin (todos a la vez) más el
  // que eligió al entrar, donde puede ser un usuario normal.
  const deptsOf = (u) => {
    const list = [...adminDeptsOf(u)];
    if (u.department && !list.includes(u.department)) list.push(u.department);
    return list;
  };

  // Departamentos que administra un admin (null = todos).
  const adminScope = (admin) => (isSuperAdmin(admin) ? null : adminDeptsOf(admin));
  const inAdminScope = (admin, department) => isSuperAdmin(admin) || (!!department && adminScope(admin).includes(department));

  // ¿Puede este admin administrar esta cuenta? El general, a todos. El de departamento, a quienes comparten
  // alguno de sus departamentos de admin, siempre que la cuenta no sea admin fuera de ellos; nunca a un
  // administrador general.
  const canManageUser = (admin, target) => {
    if (isSuperAdmin(admin)) return true;
    if (!isDeptAdmin(admin) || isSuperAdmin(target)) return false;
    const scope = adminScope(admin);
    if (adminDeptsOf(target).some(d => !scope.includes(d))) return false;
    return (target.departments || []).some(d => scope.includes(d));
  };

  // Cambiar la contraseña o el correo, bloquear o eliminar una cuenta afecta también a sus otros
  // departamentos: el admin de departamento solo puede hacerlo si todos los departamentos de la cuenta son suyos.
  const FULL_SCOPE_ERROR = 'Ese usuario también pertenece a otros departamentos: solo el administrador general puede hacerlo';
  const canManageUserFully = (admin, target) => canManageUser(admin, target) &&
    (isSuperAdmin(admin) || (target.departments || []).every(d => adminScope(admin).includes(d)));

  // Quién ve a quién en "Conectados": el general ve a todos y todos lo ven a él; el resto, solo a quienes
  // comparten departamento.
  const canViewUser = (target, viewer) => {
    if (isSuperAdmin(viewer) || isSuperAdmin(target)) return true;
    const viewerDepts = deptsOf(viewer);
    return deptsOf(target).some(d => viewerDepts.includes(d));
  };

  // Una sala sin departamento es global (visible por todos). Si tiene departamento, solo la ven quienes
  // están en ese departamento (y el administrador general).
  const canViewRoom = (room, viewer) => {
    if (isSuperAdmin(viewer)) return true;
    return !room.department || deptsOf(viewer).includes(room.department);
  };

  const getAllRooms = (viewer) => (viewer ? data.rooms
    .filter(r => canViewRoom(r, viewer))
    .map(r => ({ name: r.name, hasPassword: !!r.password, temporary: !!r.temporary, department: r.department || null })) : []);

  // Conectados que ve alguien. Antes se revisaba a los 2000 conectados por cada ingreso; ahora solo a los que
  // están en las salas internas de sus departamentos (y a los administradores generales), que Socket.IO ya
  // mantiene al día (ver visibilityRoomsFor). canViewUser se sigue aplicando como control final.
  const getAllUsers = (viewer) => {
    if (!viewer) return [];
    const list = [];
    const add = (u) => { if (u && canViewUser(u, viewer)) list.push({ username: u.username, displayName: u.displayName || u.username, avatar: u.avatar || null }); };
    if (isSuperAdmin(viewer)) {
      for (const [, u] of users) add(u);
      return list;
    }
    const seen = new Set();
    for (const r of [...deptsOf(viewer).map(departmentRoom), ADMIN_ROOM]) {
      for (const sid of io.sockets.adapter.rooms.get(r) || []) {
        if (seen.has(sid)) continue;
        seen.add(sid);
        add(users.get(sid));
      }
    }
    return list;
  };

  // Cada socket conectado vive en "salas" internas de Socket.IO según lo que puede ver: el administrador
  // general en 'role:admin'; el admin de departamento en 'dept:<d>' de cada uno de sus departamentos; el resto
  // en 'dept:<departamento>' (o 'dept:__unassigned__'). Así un aviso se emite una vez por grupo y no una vez
  // por persona. Los nombres llevan ":", que no se permite en los nombres de sala del chat: nadie puede
  // crear una sala que coincida con una de estas.
  const departmentRoom = (department) => 'dept:' + (department || '__unassigned__');
  const ADMIN_ROOM = 'role:admin';
  const AUTH_ROOM = 'role:auth'; // todos los sockets con sesión iniciada

  const visibilityRoomsFor = (u) => {
    if (isSuperAdmin(u)) return [ADMIN_ROOM];
    const depts = deptsOf(u);
    return depts.length ? depts.map(departmentRoom) : [departmentRoom(null)];
  };

  // ===== Presencia: se avisa solo el cambio ("entró", "salió", "cambió su nombre") =====
  // Antes cada ingreso o salida reenviaba la lista completa de conectados a todos (con 1000 usuarios,
  // ~6,5 MB por ingreso). Ahora cada navegador recibe la lista una vez al entrar y luego solo los cambios,
  // y solo quienes pueden ver a esa persona.
  const socketIdByUsername = new Map(); // usuario conectado -> socket.id (evita recorrer a todos los conectados)
  const onlineSid = (username) => socketIdByUsername.get(username) || null;
  const isOnline = (username) => socketIdByUsername.has(username);

  const userEntry = (u) => ({ username: u.username, displayName: u.displayName || u.username, avatar: u.avatar || null });

  // Quiénes ven a un usuario en "Conectados" (misma regla que canViewUser): al administrador general lo ven
  // todos; a los demás, quienes están en sus departamentos y el administrador general.
  const presenceRooms = (u) => {
    if (isSuperAdmin(u)) return [AUTH_ROOM];
    return [...deptsOf(u).map(departmentRoom), ADMIN_ROOM];
  };
  const announceOnline = (u) => io.to(presenceRooms(u)).emit('user-online', userEntry(u));
  const announceOffline = (u) => io.to(presenceRooms(u)).emit('user-offline', { username: u.username });
  // Cambiaron los departamentos (o el rol) de alguien conectado: "salió" solo para quienes dejan de verlo y
  // "entró" solo para quienes empiezan a verlo. Antes se reenviaba la lista completa a todos los departamentos.
  // `prevRooms` = presenceRooms(u) antes del cambio.
  const movePresence = (u, prevRooms) => {
    const nextRooms = presenceRooms(u);
    const gone = prevRooms.filter(r => !nextRooms.includes(r));
    const added = nextRooms.filter(r => !prevRooms.includes(r));
    if (gone.length) io.to(gone).except(nextRooms).emit('user-offline', { username: u.username });
    if (added.length) io.to(added).except(prevRooms.filter(r => nextRooms.includes(r))).emit('user-online', userEntry(u));
  };
  const announceUserUpdate = (u) => {
    const rooms = presenceRooms(u);
    if (u.currentRoom && !isGlobalRoom(u.currentRoom)) rooms.push(u.currentRoom); // quienes lo ven en la sala aunque sean de otro departamento
    io.to(rooms).emit('user-updated', userEntry(u));
  };

  // Quiénes ven una sala: global = todos; de un departamento = ese departamento y los admins.
  const roomViewerRooms = (room) => (room.department ? [departmentRoom(room.department), ADMIN_ROOM] : [AUTH_ROOM]);
  const emitToViewersOfRoom = (room, event, payload) => io.to(roomViewerRooms(room)).emit(event, payload);

  // Las salas globales (p. ej. "general") pueden tener a las 2000 personas conectadas: no se envía ni se muestra
  // quiénes (ni cuántos) están en ellas. Así no viaja una lista de ~200 KB a cada persona que entra, ni se
  // avisa a todos cada entrada y salida.
  const isGlobalRoom = (roomName) => {
    const room = findRoom(roomName);
    return !!room && !room.department;
  };

  const HISTORY_PAGE_SIZE = 50;

  // El historial no se guarda en memoria: cada página (los HISTORY_PAGE_SIZE mensajes anteriores a
  // `beforeId`, o los más recientes) se pide a la base cuando se necesita.
  const getRoomHistory = async (roomName, beforeId) => {
    const page = await getRoomMessages(roomName, beforeId, HISTORY_PAGE_SIZE);
    return { messages: page.messages.map(m => ({ ...m, type: 'room' })), hasMore: page.hasMore };
  };

  const getPrivateHistory = async (userA, userB, beforeId) => {
    const page = await getPrivateMessages(userA, userB, beforeId, HISTORY_PAGE_SIZE);
    return { messages: page.messages.map(m => ({ ...m, type: 'private' })), hasMore: page.hasMore };
  };

  const getConversations = async (username) => {
    const conversations = [];
    for (const msg of await getLastPrivateMessages(username)) {
      const other = msg.sender === username ? msg.recipient : msg.sender;
      const uc = findUser(other);
      conversations.push({
        with: other,
        displayName: uc?.displayName || other,
        avatar: uc?.avatar || null,
        lastMessage: {
          content: msg.content,
          created_at: msg.created_at,
          sender: msg.sender
        }
      });
    }
    return conversations; // ya vienen de la más reciente a la más antigua
  };

  // ===================== AMIGOS =====================

  const userPublicInfo = (username) => {
    const u = findUser(username);
    return { username, displayName: u?.displayName || username, avatar: u?.avatar || null };
  };

  const getFriendRow = (userA, userB) =>
    friendRowsOf(userA).find(f =>
      (f.requester === userA && f.recipient === userB) ||
      (f.requester === userB && f.recipient === userA)
    );

  const getAcceptedFriendUsernames = (username) =>
    friendRowsOf(username)
      .filter(f => f.status === 'accepted')
      .map(f => (f.requester === username ? f.recipient : f.requester));

  // Estado en vivo de un usuario para mostrarlo en la lista de amigos: conectado +
  // departamento activo, o desconectado.
  const getFriendLiveStatus = (username) => {
    const sid = onlineSid(username);
    if (sid) {
      const u = users.get(sid);
      const deptRecord = u.department ? data.departments.find(d => d.name === u.department) : null;
      return { online: true, department: u.department || null, departmentDisplayName: deptRecord?.displayName || u.department || null };
    }
    const record = findUser(username);
    return { online: false, departments: departmentOptions(record?.departments || []) };
  };

  const getFriendsList = (username) =>
    getAcceptedFriendUsernames(username).map(other => ({
      ...userPublicInfo(other),
      ...getFriendLiveStatus(other)
    }));

  const getPendingRequests = (username) => ({
    incoming: friendRowsOf(username)
      .filter(f => f.status === 'pending' && f.recipient === username)
      .map(f => ({ id: f.id, ...userPublicInfo(f.requester) })),
    outgoing: friendRowsOf(username)
      .filter(f => f.status === 'pending' && f.requester === username)
      .map(f => ({ id: f.id, ...userPublicInfo(f.recipient) }))
  });

  // Avisa a los amigos conectados de alguien que su estado (conectado/departamento) cambió.
  const notifyFriendsOfStatusChange = (username) => {
    const friendUsernames = getAcceptedFriendUsernames(username);
    if (friendUsernames.length === 0) return;
    const status = getFriendLiveStatus(username);
    for (const friend of friendUsernames) {
      const sid = onlineSid(friend);
      if (sid) io.to(sid).emit('friend-status-update', { username, ...status });
    }
  };

  const cleanupTemporaryRoom = async (roomName) => {
    const room = findRoom(roomName);
    if (!room || !room.temporary) return false;
    if (!isRoomEmpty(roomName)) return false;

    const fileUrls = await getRoomFileUrls(roomName);
    data.rooms = data.rooms.filter(r => r !== room); // filter (y no splice): el índice de salas se rehace
    await deleteRoom(roomName);
    await deleteMessagesByRoom(roomName);
    fileUrls.forEach(deleteUploadedFile);
    emitToViewersOfRoom(room, 'room-deleted', { name: roomName });
    emptyRoom(roomName);
    return true;
  };

  // Saca a una conexión de la sala donde está. Devuelve el nombre de la sala que dejó (o null).
  const leaveCurrentRoom = (sid, u) => {
    const roomName = u.currentRoom;
    if (!roomName) return null;
    u.currentRoom = null;
    io.sockets.sockets.get(sid)?.leave(roomName);
    const sockets = roomUsers.get(roomName);
    if (sockets) {
      sockets.delete(sid);
      if (sockets.size === 0) roomUsers.delete(roomName);
      else if (!isGlobalRoom(roomName)) io.to(roomName).emit('room-user-left', { room: roomName, username: u.username });
    }
    return roomName;
  };

  // El permiso se revisaba solo al entrar: quien perdía el acceso (le cambiaron el departamento) seguía
  // leyendo y escribiendo en la sala. Esto lo saca si ya no puede verla.
  const leaveRoomIfNoAccess = (sid, u) => {
    if (!u.currentRoom) return;
    const room = findRoom(u.currentRoom);
    if (room && canViewRoom(room, u)) return;
    const left = leaveCurrentRoom(sid, u);
    if (left) cleanupTemporaryRoom(left).catch(err => console.error('cleanupTemporaryRoom error:', err));
  };

  // Sala eliminada: nadie queda "dentro" (si otro departamento crea una sala con el mismo nombre, no
  // recibirían sus mensajes).
  const emptyRoom = (roomName) => {
    for (const sid of [...(roomUsers.get(roomName) || [])]) {
      const u = users.get(sid);
      if (u) leaveCurrentRoom(sid, u);
    }
    io.in(roomName).socketsLeave(roomName);
    roomUsers.delete(roomName);
  };

  // Salas temporales: cada usuario puede tener pocas abiertas a la vez, y una que nadie usa no se queda
  // para siempre (antes solo se borraba al salir la última persona, así que una sala creada y nunca usada
  // quedaba en la lista de todo el departamento).
  // "+N no leídos" para quienes pueden ver una sala y no están en ella (cada navegador lleva su cuenta).
  // En una sala global activa, avisar cada mensaje eran miles de avisos por mensaje: se juntan y se envía
  // uno por sala cada UNREAD_FLUSH_MS con el total.
  const UNREAD_FLUSH_MS = 1500;
  const pendingUnread = new Map(); // sala -> mensajes nuevos aún no avisados
  let unreadFlushTimer = null;
  const flushUnread = () => {
    unreadFlushTimer = null;
    for (const [room, count] of pendingUnread) {
      if (findRoom(room.name) === room) io.to(roomViewerRooms(room)).except(room.name).emit('room-unread-increment', { room: room.name, count });
    }
    pendingUnread.clear();
  };
  const queueUnreadIncrement = (room) => {
    pendingUnread.set(room, (pendingUnread.get(room) || 0) + 1);
    if (!unreadFlushTimer) unreadFlushTimer = setTimeout(flushUnread, UNREAD_FLUSH_MS);
  };

  const PANIC_COOLDOWN_MS = 30 * 1000;
  const lastPanicAt = new Map(); // username -> hora de su última alerta (se borra al pasar la espera)

  const MAX_TEMP_ROOMS_PER_USER = 3;
  const TEMP_ROOM_UNUSED_MS = 10 * 60 * 1000;
  const scheduleUnusedTemporaryRoomCleanup = (room) => {
    setTimeout(() => {
      // Solo si sigue siendo la misma sala (pudo borrarse y crearse otra con el mismo nombre) y está vacía.
      if (findRoom(room.name) !== room) return;
      cleanupTemporaryRoom(room.name).catch(err => console.error('cleanupTemporaryRoom error:', err));
    }, TEMP_ROOM_UNUSED_MS).unref();
  };

  // Al iniciar no hay nadie conectado: las salas temporales que quedaron (el servidor se apagó con gente
  // dentro, o nunca se usaron) se borran con sus mensajes y archivos. Se quitan de la lista de inmediato,
  // antes de que alguien pueda entrar.
  const leftoverTemporaryRooms = data.rooms.filter(r => r.temporary);
  if (leftoverTemporaryRooms.length) {
    data.rooms = data.rooms.filter(r => !r.temporary);
    (async () => {
      for (const room of leftoverTemporaryRooms) {
        const fileUrls = await getRoomFileUrls(room.name);
        await deleteRoom(room.name);
        await deleteMessagesByRoom(room.name);
        fileUrls.forEach(deleteUploadedFile);
      }
      console.log(`[Salas] ${leftoverTemporaryRooms.length} sala(s) temporal(es) sin uso eliminada(s) al iniciar`);
    })().catch(err => console.error('leftover temporary rooms cleanup error:', err));
  }

  // Saca del chat la sesión activa de un usuario (cuenta eliminada o bloqueada). Devuelve true si estaba conectado.
  const kickUser = (username, reason, extra) => {
    const sid = onlineSid(username);
    if (!sid) return false;
    const u = users.get(sid);
    if (u.currentRoom) {
      const sockets = roomUsers.get(u.currentRoom);
      if (sockets) {
        sockets.delete(sid);
        if (sockets.size === 0) roomUsers.delete(u.currentRoom);
        else if (!isGlobalRoom(u.currentRoom)) io.to(u.currentRoom).emit('room-user-left', { room: u.currentRoom, username });
      }
    }
    if (u.uploadToken) uploadTokens.delete(u.uploadToken);
    io.to(sid).emit('force-disconnect', { reason, ...extra });
    users.delete(sid);
    socketIdByUsername.delete(username);
    // La conexión expulsada deja de recibir avisos de inmediato (aunque tarde en cerrarse).
    const kicked = io.sockets.sockets.get(sid);
    if (kicked) {
      kicked.leave(AUTH_ROOM);
      setSocketSession(kicked, null);
      for (const r of visibilityRoomsFor(u)) kicked.leave(r);
      if (u.currentRoom) kicked.leave(u.currentRoom);
    }
    announceOffline(u);
    return true;
  };

  const departmentOptions = (names) => names.map(n => {
    const rec = data.departments.find(d => d.name === n);
    return { name: n, displayName: rec?.displayName || n };
  });

  // Crea la sesión del navegador (o reutiliza la que se reanudó) y deja al usuario conectado.
  const finalizeLogin = async (socket, userRecord, department, callback) => {
    const role = userRecord.role || 'user';
    const assignedDepartments = userRecord.departments || [];

    let sessionHash = socket.resumedSessionHash || null;
    let sessionToken = null;
    let sessionRemember = !!socket.resumedSessionRemember;
    if (sessionHash) {
      updateSessionDepartment(sessionHash, department).catch(err => console.error('updateSessionDepartment error:', err));
    } else {
      sessionRemember = !!socket.loginRemember;
      sessionToken = crypto.randomBytes(32).toString('base64url');
      sessionHash = hashToken(sessionToken);
      try {
        await saveSession({
          tokenHash: sessionHash,
          username: userRecord.username,
          department,
          remember: sessionRemember,
          created_at: new Date().toISOString(),
          expiresAt: Date.now() + (sessionRemember ? SESSION_REMEMBER_MS : SESSION_TTL_MS),
          ip: clientIp(socket),
          userAgent: socket.handshake.headers?.['user-agent']
        });
      } catch (err) {
        // Sin sesión guardada igual puede entrar; solo tendrá que iniciar sesión otra vez al recargar.
        console.error('saveSession error:', err);
        sessionToken = null;
        sessionHash = null;
      }
    }
    socket.resumedSessionHash = null;
    socket.resumedSessionRemember = false;
    socket.loginRemember = false;

    if (isOnline(userRecord.username)) {
      setSocketSession(socket, null);
      return callback?.({ ok: false, error: 'Ese usuario ya está conectado' });
    }
    setSocketSession(socket, sessionHash);

    const uploadToken = crypto.randomUUID();
    uploadTokens.set(uploadToken, socket.id);
    users.set(socket.id, { username: userRecord.username, currentRoom: null, displayName: userRecord.displayName || userRecord.username, avatar: userRecord.avatar || null, location: userRecord.location || '', role, department, departments: assignedDepartments, adminDepartments: adminDeptsOf(userRecord), uploadToken, sessionHash, sessionRemember });
    socketIdByUsername.set(userRecord.username, socket.id);
    socket.username = userRecord.username;
    socket.displayName = userRecord.displayName || userRecord.username;
    socket.avatar = userRecord.avatar || null;
    socket.location = userRecord.location || '';
    socket.department = department;
    socket.pendingUser = null;
    const onlineUser = users.get(socket.id);
    socket.join(visibilityRoomsFor(onlineUser));
    socket.join(AUTH_ROOM);
    announceOnline(onlineUser);
    notifyFriendsOfStatusChange(userRecord.username);
    const deptRecord = department ? data.departments.find(d => d.name === department) : null;
    callback?.({
      ok: true,
      rooms: getAllRooms(onlineUser),
      superAdmin: isSuperAdmin(onlineUser),
      displayName: userRecord.displayName || userRecord.username,
      avatar: userRecord.avatar || null,
      location: userRecord.location || '',
      role,
      department,
      departmentDisplayName: deptRecord?.displayName || department,
      departments: departmentOptions(assignedDepartments),
      adminDepartments: adminDeptsOf(userRecord),
      uploadToken,
      username: userRecord.username,
      sessionToken,
      sessionRemember
    });
  };

  // ===== Grupos: conversaciones privadas entre varios usuarios =====
  // Cualquiera crea un grupo; los invitados deben aceptar. El dueño (owner) administra y puede
  // nombrar administradores (admin), que también agregan/quitan miembros y renombran.
  const GROUP_NAME_MAX = 60;
  const GROUP_MAX_MEMBERS = 100;

  // Índices de grupos y membresías: cada mensaje de grupo buscaba en la lista completa de membresías de todo el
  // sistema (miles de filas) para saber quién es miembro; ahora se miran solo las filas de ese grupo.
  const groupsIndex = lazyIndex(() => data.groups, list => new Map(list.map(g => [g.id, g])));
  const groupMembersIndex = lazyIndex(() => data.groupMembers, list => {
    const byGroup = new Map();
    const byUser = new Map();
    const add = (map, key, row) => {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    };
    for (const m of list) {
      add(byGroup, m.group_id, m);
      add(byUser, m.username, m);
    }
    return { byGroup, byUser };
  });
  const groupRowsOf = (groupId) => groupMembersIndex().byGroup.get(groupId) || [];
  const groupRowsOfUser = (username) => groupMembersIndex().byUser.get(username) || [];

  const findGroup = (id) => groupsIndex().get(id);
  const groupMembership = (groupId, username) => groupRowsOf(groupId).find(m => m.username === username);
  const isGroupMember = (groupId, username) => groupMembership(groupId, username)?.status === 'member';
  const canManageGroup = (groupId, username) => {
    const m = groupMembership(groupId, username);
    return m?.status === 'member' && (m.role === 'owner' || m.role === 'admin');
  };
  const groupMemberUsernames = (groupId) => groupRowsOf(groupId)
    .filter(m => m.status === 'member')
    .map(m => m.username);

  const emitToUsername = (username, event, payload) => {
    const sid = onlineSid(username);
    if (sid) io.to(sid).emit(event, payload);
  };

  const userCard = (username) => {
    const r = findUser(username);
    return { username, displayName: r?.displayName || username, avatar: r?.avatar || null };
  };

  // Último mensaje de cada grupo (para la lista de grupos). Se carga al arrancar y se actualiza al enviar.
  const lastGroupMessages = new Map(); // group_id -> mensaje
  const rememberGroupMessage = (msg) => {
    const prev = lastGroupMessages.get(msg.group_id);
    if (!prev || prev.id <= msg.id) lastGroupMessages.set(msg.group_id, msg);
  };
  getLastGroupMessages()
    .then(rows => rows.forEach(rememberGroupMessage))
    .catch(err => console.error('getLastGroupMessages error:', err));

  const groupLastMessage = (groupId) => {
    const msg = lastGroupMessages.get(groupId);
    return msg ? { ...msg, type: 'group' } : null;
  };

  // Parte común de la vista de un grupo (igual para todos sus miembros).
  const groupBaseView = (group) => {
    const rows = groupRowsOf(group.id);
    return {
      rows,
      view: {
        id: group.id,
        name: group.name,
        created_by: group.created_by,
        created_at: group.created_at,
        members: rows.filter(m => m.status === 'member').map(m => ({ ...userCard(m.username), role: m.role })),
        invited: rows.filter(m => m.status === 'invited').map(m => ({ ...userCard(m.username), invited_by: m.invited_by })),
        lastMessage: groupLastMessage(group.id)
      }
    };
  };

  const groupView = (group, viewer, base = groupBaseView(group)) => {
    const me = base.rows.find(m => m.username === viewer);
    return { ...base.view, myRole: me?.role || null };
  };

  const invitationView = (group, membership) => ({
    id: group.id,
    name: group.name,
    invitedBy: userCard(membership.invited_by),
    memberCount: groupMemberUsernames(group.id).length
  });

  // Cada miembro recibe su propia vista (incluye su rol en el grupo).
  const broadcastGroup = (group) => {
    const base = groupBaseView(group);
    for (const username of groupMemberUsernames(group.id)) {
      if (isOnline(username)) emitToUsername(username, 'group-updated', groupView(group, username, base));
    }
  };

  const getGroupHistory = async (groupId, beforeId) => {
    const page = await getGroupMessages(groupId, beforeId, HISTORY_PAGE_SIZE);
    return { messages: page.messages.map(m => ({ ...m, type: 'group' })), hasMore: page.hasMore };
  };

  const destroyGroup = async (group) => {
    const notify = groupRowsOf(group.id).map(m => m.username);
    const fileUrls = await getGroupFileUrls(group.id);
    data.groupMembers = data.groupMembers.filter(m => m.group_id !== group.id);
    data.groups = data.groups.filter(g => g.id !== group.id);
    lastGroupMessages.delete(group.id);
    await deleteGroup(group.id);
    fileUrls.forEach(deleteUploadedFile);
    for (const username of notify) emitToUsername(username, 'group-removed', { id: group.id, name: group.name, reason: 'deleted' });
  };

  // Quita a alguien del grupo (o cancela su invitación). Si sale el dueño, el grupo pasa a un
  // administrador (o al miembro más antiguo); si no queda nadie, el grupo se elimina.
  const removeGroupMembership = async (group, username) => {
    const m = groupMembership(group.id, username);
    if (!m) return 'none';
    data.groupMembers = data.groupMembers.filter(x => x !== m);
    await deleteGroupMember(group.id, username);
    if (m.status === 'member') {
      const remaining = groupRowsOf(group.id).filter(x => x.status === 'member');
      if (remaining.length === 0) {
        await destroyGroup(group);
        return 'deleted';
      }
      if (m.role === 'owner') {
        const heir = remaining.find(x => x.role === 'admin') || remaining[0];
        heir.role = 'owner';
        await saveGroupMember(heir);
      }
    }
    return 'removed';
  };

  const inviteToGroup = async (group, inviter, usernames) => {
    const invited = [];
    for (const name of [...new Set((usernames || []).map(u => String(u).trim().toLowerCase()))]) {
      if (!name || name === inviter || groupMembership(group.id, name)) continue;
      const target = findUser(name);
      if (!target || target.status !== 'active') continue;
      if (groupRowsOf(group.id).length >= GROUP_MAX_MEMBERS) break;
      const m = { group_id: group.id, username: name, role: 'member', status: 'invited', invited_by: inviter, created_at: new Date().toISOString() };
      data.groupMembers.push(m);
      try {
        await saveGroupMember(m);
      } catch (err) {
        data.groupMembers = data.groupMembers.filter(x => x !== m);
        throw err;
      }
      invited.push(m);
    }
    for (const m of invited) emitToUsername(m.username, 'group-invitation', invitationView(group, m));
    return invited.map(m => m.username);
  };

  const cleanGroupName = (name) => String(name || '').trim().replace(/\s+/g, ' ').slice(0, GROUP_NAME_MAX);

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

  // Quién puede ver (y reaccionar a) un mensaje.
  const canSeeMessage = (msg, user) => {
    if (msg.room_name) {
      const room = findRoom(msg.room_name);
      return !!room && canViewRoom(room, user);
    }
    if (msg.group_id) return isGroupMember(msg.group_id, user.username);
    if (msg.recipient) return user.username === msg.sender || user.username === msg.recipient;
    return false;
  };

  // Cada usuario tiene a lo más una reacción por mensaje: la misma la quita, otra la reemplaza.
  const toggleReaction = (msg, username, emoji) => {
    if (!msg.reactions || typeof msg.reactions !== 'object') msg.reactions = {};
    let prevEmoji = null;
    for (const [e, list] of Object.entries(msg.reactions)) {
      if (Array.isArray(list) && list.includes(username)) { prevEmoji = e; break; }
    }
    if (prevEmoji) {
      msg.reactions[prevEmoji] = msg.reactions[prevEmoji].filter(u => u !== username);
      if (msg.reactions[prevEmoji].length === 0) delete msg.reactions[prevEmoji];
    }
    if (prevEmoji !== emoji) msg.reactions[emoji] = [...(msg.reactions[emoji] || []), username];
  };

  const messageLocks = new Map(); // id de mensaje -> promesa de la última operación en curso
  const withMessageLock = async (id, fn) => {
    const prev = messageLocks.get(id) || Promise.resolve();
    let release;
    const turn = new Promise(r => { release = r; });
    const chain = prev.then(() => turn);
    messageLocks.set(id, chain);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (messageLocks.get(id) === chain) messageLocks.delete(id);
    }
  };

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

    socket.on('register', async (data_, callback) => {
      const username = str(data_?.username);
      const password = str(data_?.password);
      const terms_version = data_?.terms_version;
      const email = normalizeEmail(str(data_?.email));
      if (!username.trim()) {
        return callback?.({ ok: false, error: 'Nombre de usuario requerido' });
      }
      if (!password || password.length < 3) {
        return callback?.({ ok: false, error: 'Contraseña debe tener al menos 3 caracteres' });
      }
      const name = username.trim().toLowerCase();
      if (!/^[a-z0-9áéíóúüñ]+$/.test(name)) {
        return callback?.({ ok: false, error: 'Solo letras, números (sin espacios)' });
      }
      if (findUser(name)) {
        return callback?.({ ok: false, error: 'Ese usuario ya existe' });
      }
      const regEmailError = emailError(email);
      if (regEmailError) {
        return callback?.({ ok: false, error: regEmailError });
      }
      if (emailInUse(email)) {
        return callback?.({ ok: false, error: 'Ese correo ya está registrado en otra cuenta' });
      }
      if (!terms_version) {
        return callback?.({ ok: false, error: 'Debes aceptar los Términos y Condiciones' });
      }
      if (recentRegistrationCount() >= REGISTER_MAX_PER_HOUR) {
        return callback?.({ ok: false, error: 'Hay muchas solicitudes de registro en este momento. Inténtalo más tarde.' });
      }
      if (data.users.filter(u => u.status === 'pending').length >= MAX_PENDING_REGISTRATIONS) {
        return callback?.({ ok: false, error: 'Hay muchas solicitudes en revisión. Inténtalo más tarde.' });
      }

      const newUser = {
        username: name,
        password: await hashPassword(password),
        displayName: name,
        avatar: null,
        departments: [],
        adminDepartments: [],
        status: 'pending',
        email,
        twoFactorEnabled: false,
        created_at: new Date().toISOString()
      };
      // Mientras se calculaba la contraseña pudo registrarse alguien con el mismo nombre o correo.
      if (findUser(name)) return callback?.({ ok: false, error: 'Ese usuario ya existe' });
      if (emailInUse(email)) return callback?.({ ok: false, error: 'Ese correo ya está registrado en otra cuenta' });
      data.users.push(newUser);
      try {
        await saveUser(newUser);
        await saveConsent(name, terms_version, new Date().toISOString(), clientIp(socket));
      } catch (err) {
        console.error('register error:', err);
        data.users = data.users.filter(u => u !== newUser);
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }
      registrationTimes.push(Date.now());

      io.to(ADMIN_ROOM).emit('registration-pending', { username: name, displayName: name, email, created_at: newUser.created_at });

      callback?.({ ok: true, pending: true });
    });

    socket.on('get-email-domains', (callback) => {
      callback?.(ALLOWED_EMAIL_DOMAINS);
    });

    socket.on('get-departments', (callback) => {
      callback?.(data.departments.map(d => ({ name: d.name, displayName: d.displayName })));
    });

    socket.on('get-all-users', (callback) => {
      const user = users.get(socket.id);
      callback?.(getAllUsers(user));
    });

    socket.on('login', async (data_, callback) => {
      const username = str(data_?.username);
      const password = str(data_?.password);
      if (!username.trim()) {
        return callback?.({ ok: false, error: 'Nombre de usuario requerido' });
      }
      if (!password) {
        return callback?.({ ok: false, error: 'Contraseña requerida' });
      }
      const name = username.trim().toLowerCase();
      const userKey = 'login-user:' + name;
      const lockedFor = lockMinutesLeft(userKey);
      if (lockedFor > 0) {
        return callback?.({ ok: false, error: lockedError(lockedFor) });
      }

      // Mismo mensaje si el usuario no existe o la contraseña es incorrecta: no revela qué cuentas existen.
      const userRecord = findUser(name);
      if (!userRecord || !(await verifyPassword(String(password), userRecord.password))) {
        registerFailure(userKey, LOGIN_MAX_FAILS_PER_USER);
        const nowLocked = lockMinutesLeft(userKey);
        return callback?.({ ok: false, error: nowLocked > 0 ? lockedError(nowLocked) : 'Usuario o contraseña incorrectos' });
      }
      clearFailures(userKey);
      if (isLegacyHash(userRecord.password)) {
        // Actualiza la contraseña al formato seguro ahora que la conocemos.
        try {
          userRecord.password = await hashPassword(String(password));
          await saveUserFields(userRecord, ['password']);
        } catch (err) {
          console.error('password upgrade error:', err);
        }
      }
      if (userRecord.status === 'pending') {
        return callback?.({ ok: false, error: 'Tu cuenta está pendiente de aprobación por un administrador.' });
      }
      if (userRecord.status === 'rejected') {
        return callback?.({ ok: false, error: 'Tu solicitud de cuenta fue rechazada. Contacta a un administrador.' });
      }
      if (userRecord.status === 'blocked') {
        return callback?.({ ok: false, error: 'Tu cuenta está bloqueada. Contacta a un administrador.' });
      }
      if (isOnline(name)) {
        return callback?.({ ok: false, error: 'Ese usuario ya está conectado' });
      }

      // La contraseña es correcta: ahora se exige el código enviado al correo.
      // La primera vez (doble factor aún no activado) este mismo paso lo activa.
      socket.pendingUser = null;
      socket.resumedSessionHash = null;
      setSocketSession(socket, null);
      const setup = !userRecord.twoFactorEnabled;
      if (!userRecord.email) {
        // Cuentas antiguas sin correo: el usuario debe indicar uno antes de recibir el código.
        socket.twoFactor = { username: name, email: null, setup: true };
        return callback?.({ ok: true, requireTwoFactor: true, setup: true, needEmail: true });
      }

      socket.twoFactor = { username: name, email: userRecord.email, setup };
      // Si ya hay un código vigente (p. ej. recargó la página), se reutiliza en vez de enviar otro:
      // así repetir el login no da intentos nuevos para adivinar ni manda más correos.
      const existing = loginCodes.get(name);
      if (existing && existing.email === userRecord.email && existing.expiresAt > Date.now()) {
        return callback?.({ ok: true, requireTwoFactor: true, setup, maskedEmail: maskEmail(userRecord.email), expiresInSeconds: codeSecondsLeft(existing), reused: true });
      }
      const wait = codeSendWaitMinutes(name);
      if (wait > 0) {
        socket.twoFactor = null;
        return callback?.({ ok: false, error: tooManyCodesError(wait) });
      }
      try {
        await issueLoginCode(userRecord, userRecord.email);
      } catch (err) {
        console.error('issueLoginCode error:', err);
        socket.twoFactor = null;
        return callback?.({ ok: false, error: 'No se pudo enviar el código a tu correo. Intenta de nuevo o contacta a un administrador.' });
      }
      callback?.({ ok: true, requireTwoFactor: true, setup, maskedEmail: maskEmail(userRecord.email), expiresInSeconds: OTP_TTL_MINUTES * 60 });
    });

    socket.on('two-factor-set-email', async (data_, callback) => {
      const pending = socket.twoFactor;
      if (!pending || !pending.setup) return callback?.({ ok: false, error: 'No hay una sesión pendiente' });
      const userRecord = findUser(pending.username);
      if (!userRecord) return callback?.({ ok: false, error: 'Usuario no encontrado' });
      if (userRecord.email) return callback?.({ ok: false, error: 'Tu cuenta ya tiene un correo registrado' });

      const email = normalizeEmail(str(data_?.email));
      const setEmailError = emailError(email);
      if (setEmailError) return callback?.({ ok: false, error: setEmailError });
      if (emailInUse(email, userRecord.username)) return callback?.({ ok: false, error: 'Ese correo ya está registrado en otra cuenta' });

      const prev = loginCodes.get(userRecord.username);
      if (prev && Date.now() - prev.sentAt < OTP_RESEND_COOLDOWN_MS) {
        return callback?.({ ok: false, error: 'Espera unos segundos antes de pedir otro código' });
      }
      const wait = codeSendWaitMinutes(userRecord.username);
      if (wait > 0) return callback?.({ ok: false, error: tooManyCodesError(wait) });
      pending.email = email;
      try {
        await issueLoginCode(userRecord, email);
      } catch (err) {
        console.error('issueLoginCode error:', err);
        return callback?.({ ok: false, error: 'No se pudo enviar el código a ese correo' });
      }
      callback?.({ ok: true, maskedEmail: maskEmail(email), expiresInSeconds: OTP_TTL_MINUTES * 60 });
    });

    socket.on('two-factor-resend', async (callback) => {
      const pending = socket.twoFactor;
      if (!pending || !pending.email) return callback?.({ ok: false, error: 'No hay una sesión pendiente' });
      const userRecord = findUser(pending.username);
      if (!userRecord) return callback?.({ ok: false, error: 'Usuario no encontrado' });

      const prev = loginCodes.get(userRecord.username);
      if (prev && Date.now() - prev.sentAt < OTP_RESEND_COOLDOWN_MS) {
        return callback?.({ ok: false, error: 'Espera unos segundos antes de pedir otro código' });
      }
      const wait = codeSendWaitMinutes(userRecord.username);
      if (wait > 0) return callback?.({ ok: false, error: tooManyCodesError(wait) });
      try {
        await issueLoginCode(userRecord, pending.email);
      } catch (err) {
        console.error('issueLoginCode error:', err);
        return callback?.({ ok: false, error: 'No se pudo reenviar el código' });
      }
      callback?.({ ok: true, maskedEmail: maskEmail(pending.email), expiresInSeconds: OTP_TTL_MINUTES * 60 });
    });

    socket.on('two-factor-verify', async (data_, callback) => {
      const pending = socket.twoFactor;
      if (!pending || !pending.email) return callback?.({ ok: false, error: 'No hay una sesión pendiente' });
      const userRecord = findUser(pending.username);
      if (!userRecord || userRecord.status !== 'active') {
        socket.twoFactor = null;
        return callback?.({ ok: false, error: 'Tu cuenta no está habilitada', restart: true });
      }

      const entry = loginCodes.get(userRecord.username);
      if (!entry || entry.email !== pending.email) {
        return callback?.({ ok: false, error: 'Solicita un código nuevo' });
      }
      if (Date.now() > entry.expiresAt) {
        loginCodes.delete(userRecord.username);
        return callback?.({ ok: false, error: 'El código venció. Solicita uno nuevo.' });
      }
      const code = str(data_?.code).trim();
      const match = /^\d{6}$/.test(code) &&
        crypto.timingSafeEqual(Buffer.from(hashCode(code), 'hex'), Buffer.from(entry.hash, 'hex'));
      if (!match) {
        entry.attempts++;
        if (entry.attempts >= OTP_MAX_ATTEMPTS) {
          loginCodes.delete(userRecord.username);
          return callback?.({ ok: false, error: 'Demasiados intentos. Solicita un código nuevo.' });
        }
        return callback?.({ ok: false, error: 'Código incorrecto' });
      }
      loginCodes.delete(userRecord.username);
      socket.loginRemember = !!data_?.remember;

      if (pending.setup) {
        if (!userRecord.email && emailInUse(pending.email, userRecord.username)) {
          socket.twoFactor = null;
          return callback?.({ ok: false, error: 'Ese correo ya está registrado en otra cuenta', restart: true });
        }
        const prevEmail = userRecord.email;
        const prevEnabled = userRecord.twoFactorEnabled;
        userRecord.email = pending.email;
        userRecord.twoFactorEnabled = true;
        try {
          await saveUserFields(userRecord, ['email', 'twoFactorEnabled']);
        } catch (err) {
          console.error('saveUser error:', err);
          userRecord.email = prevEmail;
          userRecord.twoFactorEnabled = prevEnabled;
          return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
        }
      }
      socket.twoFactor = null;

      if (isOnline(userRecord.username)) {
        return callback?.({ ok: false, error: 'Ese usuario ya está conectado', restart: true });
      }

      const assignedDepartments = userRecord.departments || [];
      if (assignedDepartments.length > 1) {
        socket.pendingUser = { username: userRecord.username };
        return callback?.({
          ok: true,
          twoFactorActivated: pending.setup,
          requireDepartment: true,
          departments: departmentOptions(assignedDepartments)
        });
      }

      finalizeLogin(socket, userRecord, assignedDepartments[0] || null, (res) => {
        callback?.({ ...res, twoFactorActivated: pending.setup });
      });
    });

    // Reanuda una sesión con el token guardado en el navegador (recarga de página, reapertura del navegador
    // con "Recordar este equipo", o reconexión tras reiniciar el servidor). No pide contraseña ni código.
    socket.on('resume-session', async (data_, callback) => {
      const token = typeof data_?.token === 'string' ? data_.token : '';
      if (!SESSION_TOKEN_RE.test(token)) return callback?.({ ok: false, expired: true });
      const tokenHash = hashToken(token);

      let session;
      try {
        session = await getSession(tokenHash);
      } catch (err) {
        console.error('getSession error:', err);
        return callback?.({ ok: false, error: 'Error al consultar la base de datos' });
      }
      if (!session || session.expiresAt <= Date.now()) {
        if (session) deleteSession(tokenHash).catch(() => {});
        return callback?.({ ok: false, expired: true });
      }

      const userRecord = findUser(session.username);
      if (!userRecord || userRecord.status !== 'active') {
        deleteSession(tokenHash).catch(() => {});
        return callback?.({ ok: false, expired: true });
      }

      const existingSid = onlineSid(userRecord.username);
      if (existingSid) {
        if (users.get(existingSid).sessionHash !== tokenHash) {
          return callback?.({ ok: false, error: 'Ese usuario ya está conectado en otro equipo' });
        }
        // Misma sesión abierta en otra pestaña (o la conexión vieja de una recarga): se reemplaza.
        kickUser(userRecord.username, 'Abriste el chat en otra pestaña o ventana.', { replaced: true });
      }

      socket.twoFactor = null;
      socket.resumedSessionHash = tokenHash;
      setSocketSession(socket, tokenHash);
      socket.resumedSessionRemember = session.remember;
      const assignedDepartments = userRecord.departments || [];
      if (session.department && assignedDepartments.includes(session.department)) {
        return finalizeLogin(socket, userRecord, session.department, callback);
      }
      if (assignedDepartments.length > 1) {
        socket.pendingUser = { username: userRecord.username };
        return callback?.({ ok: true, username: userRecord.username, requireDepartment: true, departments: departmentOptions(assignedDepartments) });
      }
      finalizeLogin(socket, userRecord, assignedDepartments[0] || null, callback);
    });

    socket.on('logout', async (callback) => {
      const user = users.get(socket.id);
      if (user?.sessionHash) {
        try {
          await deleteSession(user.sessionHash);
        } catch (err) {
          console.error('deleteSession error:', err);
        }
      }
      callback?.({ ok: true });
    });

    socket.on('select-department', (data_, callback) => {
      if (!socket.pendingUser) return callback?.({ ok: false, error: 'No hay una sesión pendiente' });

      const { department } = data_ || {};
      const userRecord = findUser(socket.pendingUser.username);
      if (!userRecord) return callback?.({ ok: false, error: 'Usuario no encontrado' });
      if (userRecord.status !== 'active') {
        socket.pendingUser = null;
        return callback?.({ ok: false, error: 'Tu cuenta no está habilitada' });
      }

      const assignedDepartments = userRecord.departments || [];
      if (!department || !assignedDepartments.includes(department)) {
        return callback?.({ ok: false, error: 'Departamento no válido' });
      }
      if (isOnline(userRecord.username)) {
        return callback?.({ ok: false, error: 'Ese usuario ya está conectado' });
      }

      finalizeLogin(socket, userRecord, department, callback);
    });

    socket.on('switch-department', (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.({ ok: false, error: 'No autenticado' });

      const { department } = data_ || {};
      if (!department || !(user.departments || []).includes(department)) {
        return callback?.({ ok: false, error: 'No tienes acceso a ese departamento' });
      }
      if (department === user.department) {
        return callback?.({ ok: false, error: 'Ya estás en ese departamento' });
      }

      // Sale de la vista del departamento anterior y aparece en la del nuevo; recibe la lista del nuevo.
      // (Los departamentos donde es admin los sigue viendo siempre.)
      const prevRooms = visibilityRoomsFor(user);
      const prevPresence = presenceRooms(user);
      user.department = department;
      const newRooms = visibilityRoomsFor(user);
      for (const r of prevRooms) if (!newRooms.includes(r)) socket.leave(r);
      socket.join(newRooms);
      movePresence(user, prevPresence);
      io.to(socket.id).emit('all-users', { users: getAllUsers(user) });
      leaveRoomIfNoAccess(socket.id, user);
      socket.department = department;
      if (user.sessionHash) {
        updateSessionDepartment(user.sessionHash, department).catch(err => console.error('updateSessionDepartment error:', err));
      }
      notifyFriendsOfStatusChange(user.username);

      const deptRecord = data.departments.find(d => d.name === department);
      io.to(socket.id).emit('profile-updated', {
        role: user.role,
        superAdmin: isSuperAdmin(user),
        department: user.department,
        departmentDisplayName: deptRecord?.displayName || department,
        departments: departmentOptions(user.departments || []),
        adminDepartments: adminDeptsOf(user),
        rooms: getAllRooms(user)
      });

      callback?.({ ok: true });
    });

    socket.on('join-room', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return;

      const roomName = typeof data_ === 'string' ? data_ : data_?.name;
      const password = typeof data_ === 'object' ? data_?.password : undefined;

      if (!roomName) return;

      const room = findRoom(roomName);
      if (!room) return callback?.({ ok: false, error: 'La sala no existe' });

      if (!canViewRoom(room, user)) {
        return callback?.({ ok: false, error: 'No tienes acceso a esta sala' });
      }

      if (room.password) {
        if (!password) {
          return callback?.({ ok: false, requirePassword: true });
        }
        const roomUserKey = 'room-user:' + user.username;
        const roomLocked = lockMinutesLeft(roomUserKey);
        if (roomLocked > 0) return callback?.({ ok: false, error: lockedError(roomLocked) });
        if (!(await verifyPassword(String(password), room.password))) {
          registerFailure(roomUserKey, ROOM_MAX_FAILS_PER_USER);
          return callback?.({ ok: false, error: 'Contraseña incorrecta' });
        }
        if (isLegacyHash(room.password)) {
          room.password = await hashPassword(String(password));
          saveRoom(room).catch(err => console.error('saveRoom error:', err));
        }
      }

      const prevRoom = leaveCurrentRoom(socket.id, user);
      if (prevRoom && isRoomEmpty(prevRoom)) {
        cleanupTemporaryRoom(prevRoom).catch(err => console.error('cleanupTemporaryRoom error:', err));
      }

      user.currentRoom = roomName;
      socket.join(roomName);

      if (!roomUsers.has(roomName)) {
        roomUsers.set(roomName, new Set());
      }
      roomUsers.get(roomName).add(socket.id);

      // Quienes ya estaban reciben solo "entró X"; quien entra recibe la lista completa en la respuesta.
      // En las salas globales no hay lista (ver isGlobalRoom).
      const listsUsers = !!room.department;
      if (listsUsers) socket.to(roomName).emit('room-user-joined', { room: roomName, user: userEntry(user) });
      io.to(socket.id).emit('room-unread-update', { room: roomName, count: 0 });

      const historyPage = await getRoomHistory(roomName);
      callback?.({
        ok: true,
        history: historyPage.messages,
        hasMoreHistory: historyPage.hasMore,
        room: roomName,
        hasPassword: !!room.password,
        temporary: !!room.temporary,
        department: room.department || null,
        hideUsers: !listsUsers,
        users: listsUsers ? getOnlineUsers(roomName) : []
      });
    });

    socket.on('room-message', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user?.currentRoom) return;
      const roomName = user.currentRoom;
      // El permiso se vuelve a revisar en cada mensaje, no solo al entrar.
      const room = findRoom(roomName);
      if (!room || !canViewRoom(room, user)) {
        leaveRoomIfNoAccess(socket.id, user);
        return callback?.({ ok: false, error: 'Ya no tienes acceso a esta sala' });
      }

      const content = sanitizeContent(data_?.content);
      if (!content && !data_?.file) return; // antes de consultar la base por la cita
      const reply = await buildReply(data_?.reply, m => m.room_name === roomName && !m.recipient);
      const claim = claimMessageFile(data_?.file, user.username);
      if (claim.error) return callback?.({ ok: false, error: claim.error });
      const file = claim.upload?.file || null;

      const msg = {
        id: nextMessageId(),
        room_name: roomName,
        sender: user.username,
        displayName: user.displayName || user.username,
        avatar: user.avatar || null,
        content: content || '',
        file: file || null,
        reply: reply || null,
        reactions: {},
        created_at: new Date().toISOString(),
        type: 'room'
      };

      // Primero se guarda: si la base falla, nadie lo recibe y quien lo envió recibe el aviso.
      try {
        await saveMessage(msg);
      } catch (err) {
        console.error('saveMessage error:', err);
        returnUpload(claim.upload); // puede volver a intentarlo con el mismo archivo
        return callback?.({ ok: false, error: SEND_ERROR });
      }
      io.to(roomName).emit('room-message', msg);

      queueUnreadIncrement(room);

      callback?.({ ok: true });
    });

    socket.on('private-message', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return;

      const recipient = data_?.recipient;
      const content = sanitizeContent(data_?.content);
      if (typeof recipient !== 'string' || !findUser(recipient) || (!content && !data_?.file)) return; // antes de consultar la base por la cita
      const reply = await buildReply(data_?.reply, m => !!m.recipient &&
        ((m.sender === user.username && m.recipient === recipient) || (m.sender === recipient && m.recipient === user.username)));
      const claim = claimMessageFile(data_?.file, user.username);
      if (claim.error) return callback?.({ ok: false, error: claim.error });
      const file = claim.upload?.file || null;

      const msg = {
        id: nextMessageId(),
        sender: user.username,
        displayName: user.displayName || user.username,
        avatar: user.avatar || null,
        recipient,
        content,
        file: file || null,
        reply: reply || null,
        reactions: {},
        created_at: new Date().toISOString(),
        type: 'private'
      };

      try {
        await saveMessage(msg);
      } catch (err) {
        console.error('saveMessage error:', err);
        returnUpload(claim.upload);
        return callback?.({ ok: false, error: SEND_ERROR });
      }
      emitToUsername(recipient, 'private-message', msg);

      socket.emit('private-message', msg);
      callback?.({ ok: true });
    });

    socket.on('add-reaction', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.({ ok: false });

      const { messageId, emoji } = data_ || {};
      if (!messageId || !REACTION_EMOJIS.has(emoji)) return callback?.({ ok: false, error: 'Reacción no válida' });

      // Dos reacciones simultáneas al mismo mensaje no deben pisarse: cada una lee, cambia y guarda por turno.
      const msg = await withMessageLock(messageId, async () => {
        const m = await getMessage(messageId);
        if (!m || !canSeeMessage(m, user)) return null;
        toggleReaction(m, user.username, emoji);
        await updateMessageReactions(m.id, m.reactions);
        return m;
      });
      if (!msg) return callback?.({ ok: false, error: 'Mensaje no encontrado' });

      // Se avisa a todos los que pueden ver el mensaje
      if (msg.room_name) {
        io.to(msg.room_name).emit('reaction-updated', msg);
      } else if (msg.group_id) {
        if (lastGroupMessages.get(msg.group_id)?.id === msg.id) lastGroupMessages.set(msg.group_id, msg);
        for (const username of groupMemberUsernames(msg.group_id)) {
          emitToUsername(username, 'reaction-updated', msg);
        }
      } else if (msg.recipient) {
        emitToUsername(msg.sender, 'reaction-updated', msg);
        if (msg.recipient !== msg.sender) emitToUsername(msg.recipient, 'reaction-updated', msg);
      }

      callback?.({ ok: true, reactions: msg.reactions });
    });

    socket.on('update-display-name', (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.({ ok: false, error: 'No autenticado' });

      const displayName = str(data_?.displayName).trim();
      if (!displayName) return callback?.({ ok: false, error: 'Nombre requerido' });
      if (displayName.length > 40) return callback?.({ ok: false, error: 'Maximo 40 caracteres' });

      user.displayName = displayName;
      const record = findUser(user.username);
      if (record) {
        record.displayName = displayName;
        saveUserFields(record, ['displayName']).catch(err => console.error('saveUser error:', err));
      }
      socket.displayName = displayName;
      announceUserUpdate(user);
      callback?.({ ok: true, displayName });
    });

    socket.on('update-avatar', (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.({ ok: false, error: 'No autenticado' });

      const avatar = data_?.avatar || null;
      // La foto debe ser una imagen que subió esta misma persona (ver "Archivos subidos").
      if (avatar !== null && avatar !== user.avatar) {
        const upload = takeUpload(avatar, user.username);
        if (!upload || !upload.file.type.startsWith('image/')) {
          returnUpload(upload);
          return callback?.({ ok: false, error: 'Imagen no válida' });
        }
      }
      user.avatar = avatar;
      const record = findUser(user.username);
      if (record) {
        record.avatar = avatar;
        saveUserFields(record, ['avatar']).catch(err => console.error('saveUser error:', err));
      }
      socket.avatar = avatar;
      announceUserUpdate(user);
      callback?.({ ok: true, avatar });
    });

    socket.on('change-password', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.({ ok: false, error: 'No autenticado' });

      const currentPassword = str(data_?.currentPassword);
      const newPassword = str(data_?.newPassword);
      if (!currentPassword) return callback?.({ ok: false, error: 'Contraseña actual requerida' });
      if (!newPassword || newPassword.length < 3) return callback?.({ ok: false, error: 'Mínimo 3 caracteres' });

      const record = findUser(user.username);
      if (!record) return callback?.({ ok: false, error: 'Usuario no encontrado' });
      const pwdKey = 'change-pwd:' + user.username;
      const pwdLocked = lockMinutesLeft(pwdKey);
      if (pwdLocked > 0) return callback?.({ ok: false, error: lockedError(pwdLocked) });
      if (!(await verifyPassword(String(currentPassword), record.password))) {
        registerFailure(pwdKey, LOGIN_MAX_FAILS_PER_USER);
        return callback?.({ ok: false, error: 'Contraseña actual incorrecta' });
      }
      clearFailures(pwdKey);

      const previousPassword = record.password;
      record.password = await hashPassword(String(newPassword));
      try {
        await saveUserFields(record, ['password']);
      } catch (err) {
        console.error('saveUser error:', err);
        record.password = previousPassword;
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }
      // Cierra las sesiones recordadas en otros equipos; la actual sigue abierta.
      deleteUserSessions(user.username, user.sessionHash).catch(err => console.error('deleteUserSessions error:', err));
      callback?.({ ok: true });
    });

    socket.on('create-room', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return;

      const name = str(data_?.name).trim().toLowerCase().replace(/\s+/g, '-');
      if (!name) return callback?.({ ok: false, error: 'Nombre requerido' });

      if (!/^[a-z0-9-áéíóúüñ]+$/.test(name)) {
        return callback?.({ ok: false, error: 'Solo letras, números y guiones' });
      }

      if (findRoom(name)) {
        return callback?.({ ok: false, error: 'Esa sala ya existe' });
      }

      const password = str(data_?.password).trim() || null;
      const temporary = !!data_?.temporary;

      if (!temporary && user.role !== 'admin') {
        return callback?.({ ok: false, error: 'Solo administradores pueden crear salas fijas' });
      }
      if (temporary && data.rooms.filter(r => r.temporary && r.created_by === user.username).length >= MAX_TEMP_ROOMS_PER_USER) {
        return callback?.({ ok: false, error: 'Ya tienes ' + MAX_TEMP_ROOMS_PER_USER + ' salas temporales abiertas. Espera a que se cierre alguna para crear otra.' });
      }

      let department;
      if (user.role === 'admin') {
        department = str(data_?.department) || null;
        if (department && !data.departments.find(d => d.name === department)) {
          return callback?.({ ok: false, error: 'Departamento no válido' });
        }
        // El admin de departamento crea salas en los departamentos que administra; en el que está como
        // usuario, solo temporales (como cualquier usuario). Las globales, solo el general.
        if (!inAdminScope(user, department) && !(temporary && department && department === user.department)) {
          return callback?.({ ok: false, error: 'Solo puedes crear salas en tus departamentos' });
        }
      } else {
        if (!user.department) {
          return callback?.({ ok: false, error: 'Tu cuenta no tiene un departamento/centro asignado. Contacta al administrador.' });
        }
        department = user.department;
      }

      const newRoom = {
        name,
        created_by: user.username,
        created_at: new Date().toISOString(),
        password: password ? await hashPassword(String(password)) : null,
        temporary,
        department
      };
      data.rooms.push(newRoom);
      try {
        await saveRoom(newRoom);
      } catch (err) {
        console.error('saveRoom error:', err);
        data.rooms = data.rooms.filter(r => r !== newRoom);
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }

      emitToViewersOfRoom(newRoom, 'room-created', {
        name,
        hasPassword: !!password,
        temporary,
        department
      });
      if (temporary) scheduleUnusedTemporaryRoomCleanup(newRoom);
      callback?.({ ok: true, name });
    });

    socket.on('get-rooms', (callback) => {
      const user = users.get(socket.id);
      callback?.(getAllRooms(user));
    });

    socket.on('get-conversations', async (callback) => {
      const user = users.get(socket.id);
      if (!user) return;
      callback?.(await getConversations(user.username));
    });

    socket.on('search-users', (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.([]);

      const query = str(data_?.query).trim().toLowerCase();
      if (query.length < 2) return callback?.([]);

      // Solo un administrador puede encontrar cuentas pendientes, rechazadas o bloqueadas (y solo si lo pide).
      const onlyActive = user.role !== 'admin' || !!data_?.activeOnly;
      const results = data.users
        .filter(u => u.username !== user.username && (u.username.includes(query) || (u.displayName || '').toLowerCase().includes(query)))
        .filter(u => !onlyActive || u.status === 'active')
        .slice(0, 20)
        .map(u => {
          const row = getFriendRow(user.username, u.username);
          let friendStatus = 'none';
          if (row) {
            if (row.status === 'accepted') friendStatus = 'friends';
            else friendStatus = row.requester === user.username ? 'pending_sent' : 'pending_received';
          }
          return { username: u.username, displayName: u.displayName || u.username, avatar: u.avatar || null, friendStatus };
        });

      callback?.(results);
    });

    socket.on('send-friend-request', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.({ ok: false, error: 'No autenticado' });

      const target = data_?.username;
      if (!target || target === user.username) return callback?.({ ok: false, error: 'Usuario no válido' });

      const targetRecord = findUser(target);
      if (!targetRecord) return callback?.({ ok: false, error: 'Usuario no encontrado' });

      const existing = getFriendRow(user.username, target);
      if (existing) {
        if (existing.status === 'accepted') return callback?.({ ok: false, error: 'Ya son amigos' });
        if (existing.requester === user.username) return callback?.({ ok: false, error: 'Ya le enviaste una solicitud' });

        // La otra persona ya te había mandado una solicitud: se acepta directo.
        const respondedAt = new Date().toISOString();
        try {
          await updateFriendStatus(existing.id, 'accepted', respondedAt);
        } catch (err) {
          console.error('updateFriendStatus error:', err);
          return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
        }
        existing.status = 'accepted';
        existing.responded_at = respondedAt;

        emitToUsername(existing.requester, 'friend-request-accepted', userPublicInfo(user.username));
        return callback?.({ ok: true, autoAccepted: true });
      }

      const newRequest = { requester: user.username, recipient: target, status: 'pending', created_at: new Date().toISOString() };
      try {
        await saveFriendRequest(newRequest);
      } catch (err) {
        console.error('saveFriendRequest error:', err);
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }
      data.friends.push(newRequest);

      emitToUsername(target, 'friend-request-received', { id: newRequest.id, ...userPublicInfo(user.username) });

      callback?.({ ok: true });
    });

    socket.on('respond-friend-request', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.({ ok: false, error: 'No autenticado' });

      const { requestId, accept } = data_ || {};
      const request = friendRowsOf(user.username).find(f => f.id === requestId && f.recipient === user.username && f.status === 'pending');
      if (!request) return callback?.({ ok: false, error: 'Solicitud no encontrada' });

      try {
        if (accept) {
          const respondedAt = new Date().toISOString();
          await updateFriendStatus(request.id, 'accepted', respondedAt);
          request.status = 'accepted';
          request.responded_at = respondedAt;
        } else {
          await deleteFriendRow(request.id);
          data.friends = data.friends.filter(f => f.id !== request.id);
        }
      } catch (err) {
        console.error('respond-friend-request error:', err);
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }

      emitToUsername(request.requester, accept ? 'friend-request-accepted' : 'friend-request-rejected', userPublicInfo(user.username));

      callback?.({ ok: true });
    });

    socket.on('remove-friend', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.({ ok: false, error: 'No autenticado' });

      const other = data_?.username;
      const row = getFriendRow(user.username, other);
      if (!row || row.status !== 'accepted') return callback?.({ ok: false, error: 'No son amigos' });

      try {
        await deleteFriendRow(row.id);
      } catch (err) {
        console.error('remove-friend error:', err);
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }
      data.friends = data.friends.filter(f => f.id !== row.id);

      emitToUsername(other, 'friend-removed', { username: user.username });

      callback?.({ ok: true });
    });

    socket.on('get-friends', (callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.([]);
      callback?.(getFriendsList(user.username));
    });

    socket.on('get-pending-friend-requests', (callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.({ incoming: [], outgoing: [] });
      callback?.(getPendingRequests(user.username));
    });

    // Los no leídos los cuenta cada navegador desde que entra (se mantiene por compatibilidad).
    socket.on('get-room-unreads', (callback) => {
      callback?.({});
    });

    // Lista de cuentas del panel, de a ADMIN_USERS_PAGE_SIZE y con búsqueda en el servidor: antes se enviaban
    // las 2000 cuentas con sus correos cada vez que se abría el panel. Las pendientes van en su propia lista.
    const ADMIN_USERS_PAGE_SIZE = 50;
    socket.on('get-all-registered-users', (data_, callback) => {
      if (typeof data_ === 'function') { callback = data_; data_ = {}; }
      if (typeof callback !== 'function') return;
      const user = users.get(socket.id);
      if (!user || user.role !== 'admin') return callback({ users: [], total: 0, hasMore: false });
      const query = str(data_?.query).trim().toLowerCase().slice(0, 100);
      const offset = Math.max(0, Math.floor(Number(data_?.offset) || 0));
      const matches = (u) => !query || u.username.includes(query) ||
        (u.displayName || '').toLowerCase().includes(query) || (u.email || '').includes(query);
      // El admin de departamento ve solo las cuentas que puede administrar.
      const found = data.users.filter(u => u.status !== 'pending' && matches(u) && (isSuperAdmin(user) || canManageUser(user, u)));
      found.sort((a, b) => (a.username < b.username ? -1 : a.username > b.username ? 1 : 0));
      callback({
        users: found.slice(offset, offset + ADMIN_USERS_PAGE_SIZE).map(u => ({
          username: u.username,
          displayName: u.displayName || u.username,
          role: u.role || 'user',
          departments: u.departments || [],
          adminDepartments: adminDeptsOf(u),
          fullyManaged: canManageUserFully(user, u), // puede cambiar contraseña/correo, bloquear o eliminar
          status: u.status || 'active',
          email: u.email || null,
          twoFactorEnabled: !!u.twoFactorEnabled,
          created_at: u.created_at
        })),
        total: found.length,
        hasMore: offset + ADMIN_USERS_PAGE_SIZE < found.length
      });
    });

    // Las solicitudes de registro llegan sin departamento: solo las revisa el administrador general.
    socket.on('get-pending-registrations', (callback) => {
      const user = users.get(socket.id);
      if (!isSuperAdmin(user)) return callback?.([]);
      callback?.(data.users.filter(u => u.status === 'pending').map(u => ({
        username: u.username,
        displayName: u.displayName || u.username,
        email: u.email || null,
        created_at: u.created_at
      })));
    });

    socket.on('admin-approve-registration', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!isSuperAdmin(user)) return callback?.({ ok: false, error: 'No autorizado' });

      const target = findUser(data_?.username);
      if (!target) return callback?.({ ok: false, error: 'Usuario no encontrado' });
      if (target.status !== 'pending') return callback?.({ ok: false, error: 'Esa cuenta no está pendiente' });

      target.status = 'active';
      try {
        await saveUserFields(target, ['status']);
      } catch (err) {
        console.error('admin-approve-registration error:', err);
        target.status = 'pending';
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }
      callback?.({ ok: true });
    });

    socket.on('admin-reject-registration', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!isSuperAdmin(user)) return callback?.({ ok: false, error: 'No autorizado' });

      const target = findUser(data_?.username);
      if (!target) return callback?.({ ok: false, error: 'Usuario no encontrado' });
      if (target.status !== 'pending') return callback?.({ ok: false, error: 'Esa cuenta no está pendiente' });

      target.status = 'rejected';
      try {
        await saveUserFields(target, ['status']);
      } catch (err) {
        console.error('admin-reject-registration error:', err);
        target.status = 'pending';
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }
      callback?.({ ok: true });
    });

    socket.on('update-user', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user || user.role !== 'admin') return callback?.({ ok: false, error: 'No autorizado' });

      const { username, displayName, role, departments, adminDepartments, email } = data_ || {};
      if (!username) return callback?.({ ok: false, error: 'Usuario requerido' });

      const target = findUser(username);
      if (!target) return callback?.({ ok: false, error: 'Usuario no encontrado' });
      if (!canManageUser(user, target)) return callback?.({ ok: false, error: 'Ese usuario no pertenece a tus departamentos' });

      let newEmail;
      if (email !== undefined) {
        newEmail = normalizeEmail(email) || null;
        const emailChanges = newEmail !== (target.email || null);
        // El código de ingreso llega al correo: cambiarlo da acceso a la cuenta en todos sus departamentos.
        if (emailChanges && !canManageUserFully(user, target)) return callback?.({ ok: false, error: FULL_SCOPE_ERROR });
        const editEmailError = newEmail && emailChanges ? emailError(newEmail) : null;
        if (editEmailError) return callback?.({ ok: false, error: editEmailError });
        if (newEmail && emailInUse(newEmail, target.username)) return callback?.({ ok: false, error: 'Ese correo ya está registrado en otra cuenta' });
      }

      // Se valida todo antes de cambiar nada.
      let cleanName;
      if (displayName !== undefined) {
        cleanName = str(displayName).trim().slice(0, 40);
        if (!cleanName) return callback?.({ ok: false, error: 'Nombre requerido' });
      }
      const newRole = role === 'admin' || role === 'user' ? role : target.role;
      // Lista de departamentos enviada por el navegador: sin repetidos y solo departamentos que existen.
      const readDeptList = (value) => {
        const list = [...new Set((Array.isArray(value) ? value : []).filter(d => typeof d === 'string' && d))];
        const unknown = list.find(d => !data.departments.find(x => x.name === d));
        return unknown ? { error: 'Departamento no válido: ' + unknown } : { list };
      };
      // El admin de departamento solo asigna o quita sus propios departamentos; los demás se conservan.
      const scope = adminScope(user);
      const mergeInScope = (current, requested) => (scope ? [...current.filter(d => !scope.includes(d)), ...requested] : requested);

      let newDepartments = target.departments || [];
      if (departments !== undefined) {
        const parsed = readDeptList(departments);
        if (parsed.error) return callback?.({ ok: false, error: parsed.error });
        if (scope && parsed.list.some(d => !scope.includes(d))) return callback?.({ ok: false, error: 'Solo puedes asignar tus departamentos' });
        newDepartments = mergeInScope(target.departments || [], parsed.list);
      }

      // Departamentos donde es administrador: en los demás de sus departamentos es un usuario normal.
      let newAdminDepartments = [];
      if (newRole === 'admin') {
        if (adminDepartments !== undefined) {
          const parsed = readDeptList(adminDepartments);
          if (parsed.error) return callback?.({ ok: false, error: parsed.error });
          if (scope && parsed.list.some(d => !scope.includes(d))) return callback?.({ ok: false, error: 'Solo puedes dar administración de tus departamentos' });
          newAdminDepartments = mergeInScope(adminDeptsOf(target), parsed.list);
        } else {
          // Sin indicarlo: conserva los que ya tenía o, si recién pasa a admin, todos los que este admin puede dar.
          newAdminDepartments = target.role === 'admin' ? adminDeptsOf(target) : newDepartments.filter(d => !scope || scope.includes(d));
        }
        newAdminDepartments = newAdminDepartments.filter(d => newDepartments.includes(d));
        if (newDepartments.length > 0 && newAdminDepartments.length === 0) {
          return callback?.({ ok: false, error: 'Marca al menos un departamento donde sea administrador' });
        }
      }
      if (!isSuperAdmin(user)) {
        const sameList = (a, b) => a.length === b.length && a.every(d => b.includes(d));
        const unchanged = newRole === target.role && sameList(newDepartments, target.departments || []) &&
          sameList(newAdminDepartments, adminDeptsOf(target));
        if (target.username === user.username && !unchanged) {
          return callback?.({ ok: false, error: 'No puedes cambiar tu propio rol ni tus departamentos' });
        }
        // Un admin sin departamentos sería administrador general: eso solo lo decide el general.
        if (newRole === 'admin' && newDepartments.length === 0) {
          return callback?.({ ok: false, error: 'Un administrador debe tener al menos un departamento' });
        }
      }

      if (cleanName !== undefined) target.displayName = cleanName;
      target.role = newRole;
      target.departments = newDepartments;
      target.adminDepartments = newAdminDepartments;
      if (newEmail !== undefined && newEmail !== (target.email || null)) {
        // Correo nuevo = hay que volver a verificarlo: el doble factor se reactiva en el próximo ingreso.
        target.email = newEmail;
        target.twoFactorEnabled = false;
        loginCodes.delete(target.username);
      }
      try {
        await saveUserFields(target, ['displayName', 'role', 'departments', 'adminDepartments', 'email', 'twoFactorEnabled']);
      } catch (err) {
        console.error('saveUser error:', err);
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }

      {
        const sid = onlineSid(username);
        const u = sid && users.get(sid);
        if (u) {
          const prevRooms = visibilityRoomsFor(u);
          const prevPresence = presenceRooms(u);
          u.role = target.role;
          u.departments = target.departments;
          u.adminDepartments = target.adminDepartments;
          if (u.department && !u.departments.includes(u.department)) {
            u.department = u.departments[0] || null;
          }
          const newRooms = visibilityRoomsFor(u);
          const targetSocket = io.sockets.sockets.get(sid);
          if (targetSocket) {
            for (const r of prevRooms) if (!newRooms.includes(r)) targetSocket.leave(r);
            targetSocket.join(newRooms);
          }
          // Quién lo ve cambió: solo se avisa a quienes empiezan o dejan de verlo, y él recibe su lista nueva.
          movePresence(u, prevPresence);
          io.to(sid).emit('all-users', { users: getAllUsers(u) });
          leaveRoomIfNoAccess(sid, u);
          const deptRecord = u.department ? data.departments.find(d => d.name === u.department) : null;
          io.to(sid).emit('profile-updated', {
            role: u.role,
            superAdmin: isSuperAdmin(u),
            department: u.department,
            departmentDisplayName: deptRecord?.displayName || u.department,
            departments: departmentOptions(u.departments || []),
            adminDepartments: adminDeptsOf(u),
            rooms: getAllRooms(u)
          });
        }
      }

      const onlineTarget = onlineSid(username) && users.get(onlineSid(username));
      if (onlineTarget) onlineTarget.displayName = target.displayName || username;
      io.to(presenceRooms(onlineTarget || { role: target.role, department: (target.departments || [])[0] || null, departments: target.departments || [], adminDepartments: target.adminDepartments || [] }))
        .emit('user-updated', { username, displayName: target.displayName || username, avatar: target.avatar || null });

      callback?.({ ok: true });
    });

    socket.on('delete-room', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user || user.role !== 'admin') return callback?.({ ok: false, error: 'No autorizado' });

      const roomName = data_?.name;
      if (!roomName) return callback?.({ ok: false, error: 'Nombre requerido' });

      const room = findRoom(roomName);
      if (!room) return callback?.({ ok: false, error: 'Sala no existe' });
      if (roomName === 'general') return callback?.({ ok: false, error: 'No puedes eliminar la sala general' });

      if (!inAdminScope(user, room.department)) return callback?.({ ok: false, error: 'Esa sala no pertenece a tus departamentos' });
      try {
        const fileUrls = await getRoomFileUrls(roomName);
        await deleteRoom(roomName);
        await deleteMessagesByRoom(roomName);
        fileUrls.forEach(deleteUploadedFile);
      } catch (err) {
        console.error('delete-room error:', err);
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }
      data.rooms = data.rooms.filter(r => r !== room);

      emitToViewersOfRoom(room, 'room-deleted', { name: roomName });
      emptyRoom(roomName);
      callback?.({ ok: true });
    });

    socket.on('admin-set-room-password', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user || user.role !== 'admin') return callback?.({ ok: false, error: 'No autorizado' });

      const { name, password } = data_ || {};
      if (!name) return callback?.({ ok: false, error: 'Nombre requerido' });
      if (name === 'general') return callback?.({ ok: false, error: 'No puedes cambiar la contraseña de la sala general' });

      const room = findRoom(name);
      if (!room) return callback?.({ ok: false, error: 'Sala no existe' });
      if (!inAdminScope(user, room.department)) return callback?.({ ok: false, error: 'Esa sala no pertenece a tus departamentos' });

      room.password = str(password) ? await hashPassword(str(password)) : null;
      try {
        await saveRoom(room);
      } catch (err) {
        console.error('saveRoom error:', err);
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }

      emitToViewersOfRoom(room, 'room-password-changed', { name, hasPassword: !!room.password });
      callback?.({ ok: true });
    });

    socket.on('get-stats', async (callback) => {
      const user = users.get(socket.id);
      if (!user || user.role !== 'admin') return;
      // Una sola pasada por cuentas, conectados y salas (antes se recorrían todas por cada departamento).
      const scope = adminScope(user);
      const visibleDepts = scope ? data.departments.filter(d => scope.includes(d.name)) : data.departments;
      const counts = new Map(visibleDepts.map(d => [d.name, { users: 0, online: 0, rooms: 0 }]));
      for (const u of data.users) for (const d of u.departments || []) if (counts.has(d)) counts.get(d).users++;
      for (const [, u] of users) if (counts.has(u.department)) counts.get(u.department).online++;
      for (const r of data.rooms) if (counts.has(r.department)) counts.get(r.department).rooms++;
      const byDepartment = visibleDepts.map(d => ({ name: d.name, displayName: d.displayName, ...counts.get(d.name) }));
      if (!scope) {
        return callback?.({
          totalUsers: data.users.length,
          connectedUsers: users.size,
          totalMessages: await countMessages(),
          totalRooms: data.rooms.length,
          departments: byDepartment
        });
      }
      // Admin de departamento: solo sus departamentos (el total de mensajes no se calcula por departamento).
      let connected = 0;
      for (const [, u] of users) if (canManageUser(user, u) || u.username === user.username) connected++;
      callback?.({
        totalUsers: data.users.filter(u => canManageUser(user, u)).length,
        connectedUsers: connected,
        totalMessages: null,
        totalRooms: data.rooms.filter(r => r.department && scope.includes(r.department)).length,
        departments: byDepartment
      });
    });

    socket.on('admin-reset-password', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user || user.role !== 'admin') return callback?.({ ok: false, error: 'No autorizado' });

      const username = data_?.username;
      const newPassword = str(data_?.newPassword);
      if (!username) return callback?.({ ok: false, error: 'Usuario requerido' });
      if (username === user.username) return callback?.({ ok: false, error: 'No puedes cambiar tu propia contraseña aquí' });
      if (!newPassword || newPassword.length < 3) return callback?.({ ok: false, error: 'Mínimo 3 caracteres' });

      const target = findUser(username);
      if (!target) return callback?.({ ok: false, error: 'Usuario no encontrado' });
      if (!canManageUser(user, target)) return callback?.({ ok: false, error: 'Ese usuario no pertenece a tus departamentos' });
      if (!canManageUserFully(user, target)) return callback?.({ ok: false, error: FULL_SCOPE_ERROR });

      target.password = await hashPassword(String(newPassword));
      clearFailures('login-user:' + target.username); // el admin le da una contraseña nueva: se quita el bloqueo por intentos
      try {
        await saveUserFields(target, ['password']);
      } catch (err) {
        console.error('saveUser error:', err);
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }
      try {
        await revokeUserSessions(target.username, 'Un administrador cambió tu contraseña. Vuelve a ingresar.');
      } catch (err) {
        console.error('revokeUserSessions error:', err);
      }
      callback?.({ ok: true });
    });

    socket.on('admin-delete-user', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user || user.role !== 'admin') return callback?.({ ok: false, error: 'No autorizado' });

      const delUsername = data_?.username;
      if (!delUsername) return callback?.({ ok: false, error: 'Usuario requerido' });
      if (delUsername === user.username) return callback?.({ ok: false, error: 'No puedes eliminarte a ti mismo' });
      if (delUsername === 'admin') return callback?.({ ok: false, error: 'No puedes eliminar al usuario admin' });

      const target = findUser(delUsername);
      if (!target) return callback?.({ ok: false, error: 'Usuario no encontrado' });
      if (!canManageUser(user, target)) return callback?.({ ok: false, error: 'Ese usuario no pertenece a tus departamentos' });
      if (!canManageUserFully(user, target)) return callback?.({ ok: false, error: FULL_SCOPE_ERROR });

      try {
        await deleteUser(delUsername);
      } catch (err) {
        console.error('deleteUser error:', err);
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }
      // filter (y no splice): el índice de cuentas se rehace al cambiar la lista.
      data.users = data.users.filter(u => u !== target);
      const removedFriendUsernames = getAcceptedFriendUsernames(delUsername);
      data.friends = data.friends.filter(f => f.requester !== delUsername && f.recipient !== delUsername);
      for (const friend of removedFriendUsernames) emitToUsername(friend, 'friend-removed', { username: delUsername });

      for (const m of [...groupRowsOfUser(delUsername)]) {
        const group = findGroup(m.group_id);
        if (!group) continue;
        try {
          if (await removeGroupMembership(group, delUsername) !== 'deleted') broadcastGroup(group);
        } catch (err) {
          console.error('removeGroupMembership error:', err);
        }
      }

      kickUser(delUsername, 'Tu cuenta ha sido eliminada por un administrador');
      callback?.({ ok: true });
    });

    socket.on('admin-block-user', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user || user.role !== 'admin') return callback?.({ ok: false, error: 'No autorizado' });

      const { username, blocked } = data_ || {};
      if (!username) return callback?.({ ok: false, error: 'Usuario requerido' });
      if (username === user.username) return callback?.({ ok: false, error: 'No puedes bloquearte a ti mismo' });
      if (username === 'admin') return callback?.({ ok: false, error: 'No puedes bloquear al usuario admin' });

      const target = findUser(username);
      if (!target) return callback?.({ ok: false, error: 'Usuario no encontrado' });
      if (!canManageUser(user, target)) return callback?.({ ok: false, error: 'Ese usuario no pertenece a tus departamentos' });
      if (!canManageUserFully(user, target)) return callback?.({ ok: false, error: FULL_SCOPE_ERROR });
      if (blocked && target.status !== 'active') return callback?.({ ok: false, error: 'Solo se pueden bloquear cuentas activas' });
      if (!blocked && target.status !== 'blocked') return callback?.({ ok: false, error: 'Esa cuenta no está bloqueada' });

      const prevStatus = target.status;
      target.status = blocked ? 'blocked' : 'active';
      try {
        await saveUserFields(target, ['status']);
      } catch (err) {
        console.error('admin-block-user error:', err);
        target.status = prevStatus;
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }

      if (blocked) {
        loginCodes.delete(username);
        try {
          await revokeUserSessions(username, 'Tu cuenta ha sido bloqueada por un administrador');
        } catch (err) {
          console.error('revokeUserSessions error:', err);
        }
      }
      callback?.({ ok: true });
    });

    socket.on('admin-revoke-sessions', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user || user.role !== 'admin') return callback?.({ ok: false, error: 'No autorizado' });
      const username = data_?.username;
      const target = findUser(username);
      if (!target) return callback?.({ ok: false, error: 'Usuario no encontrado' });
      if (!canManageUser(user, target)) return callback?.({ ok: false, error: 'Ese usuario no pertenece a tus departamentos' });
      if (username === user.username) return callback?.({ ok: false, error: 'Para cerrar tu propia sesión usa el botón Salir' });
      try {
        await revokeUserSessions(username, 'Un administrador cerró tu sesión. Vuelve a ingresar.');
      } catch (err) {
        console.error('admin-revoke-sessions error:', err);
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }
      callback?.({ ok: true });
    });

    socket.on('admin-create-department', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!isSuperAdmin(user)) return callback?.({ ok: false, error: 'No autorizado' });

      const name = str(data_?.name).trim().toLowerCase().replace(/\s+/g, '-');
      const displayName = str(data_?.displayName).trim() || name;
      if (!name) return callback?.({ ok: false, error: 'Nombre requerido' });
      if (!/^[a-z0-9-áéíóúüñ]+$/.test(name)) {
        return callback?.({ ok: false, error: 'Solo letras, números y guiones' });
      }
      if (data.departments.find(d => d.name === name)) {
        return callback?.({ ok: false, error: 'Ese departamento ya existe' });
      }

      const newDept = { name, displayName, created_at: new Date().toISOString() };
      data.departments.push(newDept);

      let roomName = 'general-' + name;
      if (findRoom(roomName)) {
        roomName = roomName + '-' + Date.now();
      }
      const defaultRoom = {
        name: roomName,
        created_by: user.username,
        created_at: new Date().toISOString(),
        password: null,
        temporary: false,
        department: name
      };
      data.rooms.push(defaultRoom);

      try {
        await saveDepartment(newDept);
        await saveRoom(defaultRoom);
      } catch (err) {
        console.error('admin-create-department error:', err);
        data.departments = data.departments.filter(d => d !== newDept);
        data.rooms = data.rooms.filter(r => r !== defaultRoom);
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }

      io.emit('department-created', { name, displayName });
      emitToViewersOfRoom(defaultRoom, 'room-created', {
        name: roomName,
        hasPassword: false,
        temporary: false,
        department: name
      });

      callback?.({ ok: true, name, displayName, defaultRoom: roomName });
    });

    socket.on('admin-delete-department', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!isSuperAdmin(user)) return callback?.({ ok: false, error: 'No autorizado' });

      const name = data_?.name;
      if (!name) return callback?.({ ok: false, error: 'Nombre requerido' });

      const idx = data.departments.findIndex(d => d.name === name);
      if (idx === -1) return callback?.({ ok: false, error: 'Departamento no existe' });

      const usersAssigned = data.users.filter(u => (u.departments || []).includes(name)).length;
      if (usersAssigned > 0) {
        return callback?.({ ok: false, error: `Hay ${usersAssigned} usuario(s) asignados a este departamento. Reasígnalos antes de eliminarlo.` });
      }

      const deptRooms = data.rooms.filter(r => r.department === name);
      const deptFileUrls = [];
      try {
        for (const room of deptRooms) deptFileUrls.push(...await getRoomFileUrls(room.name));
      } catch (err) {
        console.error('admin-delete-department error:', err);
        return callback?.({ ok: false, error: 'Error al consultar la base de datos' });
      }
      for (const room of deptRooms) {
        emitToViewersOfRoom(room, 'room-deleted', { name: room.name });
        emptyRoom(room.name);
      }
      data.rooms = data.rooms.filter(r => r.department !== name);
      data.departments = data.departments.filter(d => d.name !== name);

      try {
        for (const room of deptRooms) {
          await deleteMessagesByRoom(room.name);
          await deleteRoom(room.name);
        }
        await deleteDepartment(name);
        deptFileUrls.forEach(deleteUploadedFile);
      } catch (err) {
        console.error('admin-delete-department error:', err);
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }

      io.emit('department-deleted', { name });
      callback?.({ ok: true });
    });

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

    socket.on('update-location', (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return;

      const location = str(data_?.location).trim();
      if (location.length > 100) {
        return callback?.({ ok: false, error: 'Máximo 100 caracteres' });
      }

      user.location = location;
      const record = findUser(user.username);
      if (record) {
        record.location = location || null;
        saveUserFields(record, ['location']).catch(err => console.error('saveUser error:', err));
      }
      callback?.({ ok: true, location });
    });

    // ===== Grupos =====

    socket.on('get-groups', (callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.({ groups: [], invitations: [] });
      const mine = groupRowsOfUser(user.username);
      const groups = mine.filter(m => m.status === 'member')
        .map(m => findGroup(m.group_id)).filter(Boolean)
        .map(g => groupView(g, user.username));
      const invitations = mine.filter(m => m.status === 'invited')
        .map(m => { const g = findGroup(m.group_id); return g ? invitationView(g, m) : null; })
        .filter(Boolean);
      callback?.({ groups, invitations });
    });

    socket.on('create-group', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.({ ok: false, error: 'No autenticado' });
      const name = cleanGroupName(data_?.name);
      if (!name) return callback?.({ ok: false, error: 'El grupo necesita un nombre' });
      const members = Array.isArray(data_?.members) ? data_.members : [];

      const group = { name, created_by: user.username, created_at: new Date().toISOString() };
      try {
        await saveGroup(group);
        data.groups.push(group);
        const owner = { group_id: group.id, username: user.username, role: 'owner', status: 'member', invited_by: null, created_at: group.created_at };
        data.groupMembers.push(owner);
        await saveGroupMember(owner);
        await inviteToGroup(group, user.username, members);
      } catch (err) {
        console.error('create-group error:', err);
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }
      callback?.({ ok: true, group: groupView(group, user.username) });
    });

    socket.on('group-invite', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.({ ok: false, error: 'No autenticado' });
      const group = findGroup(data_?.groupId);
      if (!group || !canManageGroup(group.id, user.username)) return callback?.({ ok: false, error: 'No puedes invitar a este grupo' });
      let invited;
      try {
        invited = await inviteToGroup(group, user.username, data_?.usernames);
      } catch (err) {
        console.error('group-invite error:', err);
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }
      if (invited.length === 0) return callback?.({ ok: false, error: 'Ese usuario ya está en el grupo o no está disponible' });
      broadcastGroup(group);
      callback?.({ ok: true, invited });
    });

    socket.on('group-respond-invite', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.({ ok: false, error: 'No autenticado' });
      const group = findGroup(data_?.groupId);
      const m = group && groupMembership(group.id, user.username);
      if (!m || m.status !== 'invited') return callback?.({ ok: false, error: 'La invitación ya no existe' });
      try {
        if (data_?.accept) {
          m.status = 'member';
          try {
            await saveGroupMember(m);
          } catch (err) {
            m.status = 'invited';
            throw err;
          }
        } else {
          await removeGroupMembership(group, user.username);
        }
      } catch (err) {
        console.error('group-respond-invite error:', err);
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }
      broadcastGroup(group);
      callback?.({ ok: true, group: data_?.accept ? groupView(group, user.username) : null });
    });

    socket.on('group-remove-member', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.({ ok: false, error: 'No autenticado' });
      const group = findGroup(data_?.groupId);
      if (!group || !canManageGroup(group.id, user.username)) return callback?.({ ok: false, error: 'No puedes administrar este grupo' });
      const targetName = data_?.username;
      if (targetName === user.username) return callback?.({ ok: false, error: 'Para salir usa "Salir del grupo"' });
      const target = groupMembership(group.id, targetName);
      if (!target) return callback?.({ ok: false, error: 'Ese usuario no está en el grupo' });
      if (target.role === 'owner') return callback?.({ ok: false, error: 'No se puede quitar al creador del grupo' });
      const actor = groupMembership(group.id, user.username);
      if (target.role === 'admin' && actor.role !== 'owner') return callback?.({ ok: false, error: 'Solo el creador puede quitar a un administrador' });

      try {
        await removeGroupMembership(group, targetName);
      } catch (err) {
        console.error('group-remove-member error:', err);
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }
      emitToUsername(targetName, 'group-removed', { id: group.id, name: group.name, reason: target.status === 'invited' ? 'invitation-cancelled' : 'removed' });
      broadcastGroup(group);
      callback?.({ ok: true });
    });

    socket.on('group-leave', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.({ ok: false, error: 'No autenticado' });
      const group = findGroup(data_?.groupId);
      if (!group || !isGroupMember(group.id, user.username)) return callback?.({ ok: false, error: 'No perteneces a este grupo' });
      let result;
      try {
        result = await removeGroupMembership(group, user.username);
      } catch (err) {
        console.error('group-leave error:', err);
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }
      if (result !== 'deleted') broadcastGroup(group);
      callback?.({ ok: true });
    });

    socket.on('group-rename', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.({ ok: false, error: 'No autenticado' });
      const group = findGroup(data_?.groupId);
      if (!group || !canManageGroup(group.id, user.username)) return callback?.({ ok: false, error: 'No puedes administrar este grupo' });
      const name = cleanGroupName(data_?.name);
      if (!name) return callback?.({ ok: false, error: 'El grupo necesita un nombre' });
      const prev = group.name;
      group.name = name;
      try {
        await renameGroup(group.id, name);
      } catch (err) {
        console.error('group-rename error:', err);
        group.name = prev;
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }
      broadcastGroup(group);
      callback?.({ ok: true });
    });

    socket.on('group-set-admin', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.({ ok: false, error: 'No autenticado' });
      const group = findGroup(data_?.groupId);
      if (!group || groupMembership(group.id, user.username)?.role !== 'owner') {
        return callback?.({ ok: false, error: 'Solo el creador puede nombrar administradores' });
      }
      const target = groupMembership(group.id, data_?.username);
      if (!target || target.status !== 'member' || target.role === 'owner') return callback?.({ ok: false, error: 'Usuario no válido' });
      const prev = target.role;
      target.role = data_?.admin ? 'admin' : 'member';
      try {
        await saveGroupMember(target);
      } catch (err) {
        console.error('group-set-admin error:', err);
        target.role = prev;
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }
      broadcastGroup(group);
      callback?.({ ok: true });
    });

    socket.on('group-delete', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.({ ok: false, error: 'No autenticado' });
      const group = findGroup(data_?.groupId);
      if (!group || groupMembership(group.id, user.username)?.role !== 'owner') {
        return callback?.({ ok: false, error: 'Solo el creador puede eliminar el grupo' });
      }
      try {
        await destroyGroup(group);
      } catch (err) {
        console.error('group-delete error:', err);
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }
      callback?.({ ok: true });
    });

    socket.on('group-message', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return;
      const group = findGroup(data_?.groupId);
      if (!group || !isGroupMember(group.id, user.username)) return callback?.({ ok: false, error: 'No perteneces a este grupo' });

      const content = sanitizeContent(data_?.content);
      if (!content && !data_?.file) return; // antes de consultar la base por la cita
      const reply = await buildReply(data_?.reply, m => m.group_id === group.id);
      const claim = claimMessageFile(data_?.file, user.username);
      if (claim.error) return callback?.({ ok: false, error: claim.error });
      const file = claim.upload?.file || null;

      const msg = {
        id: nextMessageId(),
        group_id: group.id,
        sender: user.username,
        displayName: user.displayName || user.username,
        avatar: user.avatar || null,
        content: content || '',
        file: file || null,
        reply: reply || null,
        reactions: {},
        created_at: new Date().toISOString(),
        type: 'group'
      };

      try {
        await saveMessage(msg);
      } catch (err) {
        console.error('saveMessage error:', err);
        returnUpload(claim.upload);
        return callback?.({ ok: false, error: SEND_ERROR });
      }
      rememberGroupMessage(msg);
      for (const username of groupMemberUsernames(group.id)) {
        emitToUsername(username, 'group-message', msg);
      }
      callback?.({ ok: true });
    });

    socket.on('get-group-history', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return;
      const groupId = data_?.groupId;
      if (!isGroupMember(groupId, user.username)) return callback?.({ ok: false, error: 'No perteneces a este grupo' });
      const page = await getGroupHistory(groupId);
      callback?.({ ok: true, history: page.messages, hasMoreHistory: page.hasMore });
    });

    socket.on('get-private-history', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return;

      const other = data_?.with;
      if (!other) return;

      const page = await getPrivateHistory(user.username, other);
      callback?.({ history: page.messages, hasMoreHistory: page.hasMore });
    });

    socket.on('get-more-messages', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.({ messages: [], hasMore: false });

      const { room, with: withUser, group: groupId, beforeId } = data_ || {};
      if (groupId) {
        if (!isGroupMember(groupId, user.username)) return callback?.({ messages: [], hasMore: false });
        const page = await getGroupHistory(groupId, beforeId);
        return callback?.({ messages: page.messages, hasMore: page.hasMore });
      }
      if (room) {
        const roomRecord = findRoom(room);
        if (room !== user.currentRoom || !roomRecord || !canViewRoom(roomRecord, user)) {
          return callback?.({ messages: [], hasMore: false });
        }
        const page = await getRoomHistory(room, beforeId);
        return callback?.({ messages: page.messages, hasMore: page.hasMore });
      }
      if (withUser) {
        const page = await getPrivateHistory(user.username, withUser, beforeId);
        return callback?.({ messages: page.messages, hasMore: page.hasMore });
      }
      callback?.({ messages: [], hasMore: false });
    });

    socket.on('disconnect', () => {
      const user = users.get(socket.id);
      if (!user) return;

      if (user.uploadToken) uploadTokens.delete(user.uploadToken);
      const oldRoom = user.currentRoom;

      const sockets = oldRoom && roomUsers.get(oldRoom);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) roomUsers.delete(oldRoom);
        else if (!isGlobalRoom(oldRoom)) io.to(oldRoom).emit('room-user-left', { room: oldRoom, username: user.username });
      }

      users.delete(socket.id);
      if (socketIdByUsername.get(user.username) === socket.id) socketIdByUsername.delete(user.username);
      announceOffline(user);
      notifyFriendsOfStatusChange(user.username);

      if (user.sessionHash && !user.sessionRemember) scheduleSessionClose(user.sessionHash);

      if (oldRoom) {
        cleanupTemporaryRoom(oldRoom).catch(err => console.error('cleanupTemporaryRoom error:', err));
      }
    });
  });

  return {
    isValidUploadToken: (token) => uploadTokens.has(token),
    registerUpload
  };
};
