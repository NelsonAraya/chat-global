const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sendPanicAlertEmail, sendLoginCodeEmail } = require('./mailer');

module.exports = (io, db) => {
  const {
    data, hashPassword, verifyPassword, isLegacyHash,
    saveUser, deleteUser,
    saveRoom, deleteRoom,
    saveMessage, updateMessageReactions, deleteMessagesByRoom,
    saveDepartment, deleteDepartment,
    saveConsent,
    saveFriendRequest, updateFriendStatus, deleteFriendRow,
    saveGroup, renameGroup, deleteGroup, saveGroupMember, deleteGroupMember,
    saveSession, getSession, updateSessionDepartment, deleteSession, deleteUserSessions, deleteExpiredSessions,
    saveAlert, getAlertHistory
  } = db;
  const TERMS_VERSION = '1.0';
  const users = new Map();
  const roomUsers = new Map();
  const roomUnreads = {};
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

  const sanitizeReply = (reply) => {
    if (!reply || typeof reply !== 'object') return null;
    const id = Number(reply.id);
    return {
      id: Number.isFinite(id) ? id : null,
      sender: String(reply.sender || '').slice(0, 64),
      content: String(reply.content || '').slice(0, 500)
    };
  };

  const sanitizeContent = (content) => (typeof content === 'string' ? content.trim().slice(0, 5000) : '');

  // ===== Sesiones =====
  // Tras el login (contraseña + código) el navegador recibe un token de sesión; con él puede recargar la
  // página sin volver a ingresar. Sin "Recordar este equipo" dura mientras la pestaña esté abierta (máx. 12 h);
  // con la casilla marcada, 7 días. En la base solo se guarda el hash del token.
  const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
  const SESSION_REMEMBER_MS = 7 * 24 * 60 * 60 * 1000;
  const SESSION_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
  const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

  // Cierra todas las sesiones guardadas de un usuario (y su conexión activa, si se indica un motivo).
  const revokeUserSessions = async (username, kickReason) => {
    await deleteUserSessions(username);
    if (kickReason && kickUser(username, kickReason)) {
      broadcastAllUsers();
      notifyFriendsOfStatusChange(username);
    }
  };

  deleteExpiredSessions().catch(err => console.error('deleteExpiredSessions error:', err));
  setInterval(() => {
    deleteExpiredSessions().catch(err => console.error('deleteExpiredSessions error:', err));
  }, 60 * 60 * 1000).unref();

  // ===== Límite de intentos fallidos (en memoria) =====
  // Frena la fuerza bruta: tras varios fallos, esa cuenta / esa IP queda bloqueada un rato.
  const LOGIN_FAIL_WINDOW_MS = 15 * 60 * 1000;
  const LOGIN_LOCK_MS = 15 * 60 * 1000;
  const LOGIN_MAX_FAILS_PER_USER = 5;
  const LOGIN_MAX_FAILS_PER_IP = 20;
  const ROOM_MAX_FAILS_PER_IP = 10;
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

  // Un usuario "target" (dept propio) es visible para un visor admin, para cualquiera si target es admin,
  // o solo para quienes comparten su mismo departamento.
  const canViewUser = (target, viewerDept, viewerRole) => {
    if (viewerRole === 'admin') return true;
    if (target.role === 'admin') return true;
    return !!target.department && target.department === viewerDept;
  };

  // Una sala sin departamento es global (visible por todos). Si tiene departamento, solo
  // la ven los admins y los usuarios de ese mismo departamento.
  const canViewRoom = (room, viewerDept, viewerRole) => {
    if (viewerRole === 'admin') return true;
    return !room.department || room.department === viewerDept;
  };

  const getAllRooms = (viewerDept, viewerRole) => data.rooms
    .filter(r => canViewRoom(r, viewerDept, viewerRole))
    .map(r => ({ name: r.name, hasPassword: !!r.password, temporary: !!r.temporary, department: r.department || null }));

  const getAllUsers = (viewerDept, viewerRole) => {
    const seen = new Map();
    for (const [, u] of users) {
      if (!canViewUser(u, viewerDept, viewerRole)) continue;
      if (!seen.has(u.username)) {
        seen.set(u.username, { username: u.username, displayName: u.displayName || u.username, avatar: u.avatar || null });
      }
    }
    return Array.from(seen.values());
  };

  // Cada socket conectado vive en una "sala" interna de Socket.IO según su
  // contexto de visibilidad: los admins en 'role:admin' (ven a todos), el resto
  // en 'dept:<departamento>' (o 'dept:__unassigned__' si no tiene ninguno
  // asignado). Esto permite calcular y emitir la lista de usuarios una sola vez
  // por grupo en vez de una vez por cada persona conectada.
  const departmentRoom = (department) => 'dept:' + (department || '__unassigned__');
  const ADMIN_ROOM = 'role:admin';

  const visibilityRoomFor = (u) => (u.role === 'admin' ? ADMIN_ROOM : departmentRoom(u.department));

  // La lista de "todos los usuarios" es distinta según el departamento del visor
  // (y los admins ven a todos). Se calcula una vez por grupo, no una vez por
  // persona conectada, y se emite con un solo io.to(sala).emit(...) por grupo.
  const broadcastAllUsers = () => {
    const adminEntries = [];
    const deptGroups = new Map();
    const allEntries = [];

    for (const [, u] of users) {
      const entry = { username: u.username, displayName: u.displayName || u.username, avatar: u.avatar || null };
      allEntries.push(entry);
      if (u.role === 'admin') {
        adminEntries.push(entry);
      } else {
        const key = u.department || '';
        if (!deptGroups.has(key)) deptGroups.set(key, []);
        deptGroups.get(key).push(entry);
      }
    }

    for (const [deptKey, entries] of deptGroups) {
      io.to(departmentRoom(deptKey || null)).emit('all-users', { users: adminEntries.concat(entries) });
    }

    io.to(ADMIN_ROOM).emit('all-users', { users: allEntries });
  };

  const emitToViewersOf = (targetUserLike, event, payload) => {
    for (const [sid, u] of users) {
      if (canViewUser(targetUserLike, u.department, u.role)) {
        io.to(sid).emit(event, payload);
      }
    }
  };

  const emitToViewersOfRoom = (room, event, payload) => {
    for (const [sid, u] of users) {
      if (canViewRoom(room, u.department, u.role)) {
        io.to(sid).emit(event, payload);
      }
    }
  };

  const HISTORY_PAGE_SIZE = 50;

  // Devuelve una página de mensajes: los HISTORY_PAGE_SIZE anteriores a `beforeId`
  // (o los más recientes si no se pasa beforeId), en orden cronológico, junto con
  // si quedan más mensajes más viejos por cargar.
  const paginate = (msgs, beforeId) => {
    let endIdx = msgs.length;
    if (beforeId !== undefined && beforeId !== null) {
      const idx = msgs.findIndex(m => m.id === beforeId);
      if (idx !== -1) endIdx = idx;
    }
    const startIdx = Math.max(0, endIdx - HISTORY_PAGE_SIZE);
    return {
      messages: msgs.slice(startIdx, endIdx),
      hasMore: startIdx > 0
    };
  };

  const getRoomHistory = (roomName, beforeId) => {
    const msgs = data.messages.filter(m => m.room_name === roomName && !m.recipient);
    const page = paginate(msgs, beforeId);
    return { messages: page.messages.map(m => ({ ...m, type: 'room' })), hasMore: page.hasMore };
  };

  const getPrivateHistory = (userA, userB, beforeId) => {
    const msgs = data.messages.filter(m =>
      m.recipient &&
      ((m.sender === userA && m.recipient === userB) ||
       (m.sender === userB && m.recipient === userA))
    );
    const page = paginate(msgs, beforeId);
    return { messages: page.messages.map(m => ({ ...m, type: 'private' })), hasMore: page.hasMore };
  };

  const getConversations = (username) => {
    const convMap = new Map();
    const msgs = data.messages.filter(m =>
      m.recipient && (m.sender === username || m.recipient === username)
    );
    for (const m of msgs) {
      const other = m.sender === username ? m.recipient : m.sender;
      const existing = convMap.get(other);
      if (!existing || new Date(m.created_at) > new Date(existing.created_at)) {
        convMap.set(other, m);
      }
    }
    const conversations = [];
    for (const [other, msg] of convMap) {
      const uc = data.users.find(u => u.username === other);
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
    conversations.sort((a, b) =>
      new Date(b.lastMessage.created_at) - new Date(a.lastMessage.created_at)
    );
    return conversations;
  };

  // ===================== AMIGOS =====================

  const userPublicInfo = (username) => {
    const u = data.users.find(x => x.username === username);
    return { username, displayName: u?.displayName || username, avatar: u?.avatar || null };
  };

  const getFriendRow = (userA, userB) =>
    data.friends.find(f =>
      (f.requester === userA && f.recipient === userB) ||
      (f.requester === userB && f.recipient === userA)
    );

  const getAcceptedFriendUsernames = (username) =>
    data.friends
      .filter(f => f.status === 'accepted' && (f.requester === username || f.recipient === username))
      .map(f => (f.requester === username ? f.recipient : f.requester));

  // Estado en vivo de un usuario para mostrarlo en la lista de amigos: conectado +
  // departamento activo, o desconectado.
  const getFriendLiveStatus = (username) => {
    for (const [, u] of users) {
      if (u.username === username) {
        const deptRecord = u.department ? data.departments.find(d => d.name === u.department) : null;
        return { online: true, department: u.department || null, departmentDisplayName: deptRecord?.displayName || u.department || null };
      }
    }
    const record = data.users.find(x => x.username === username);
    return { online: false, departments: departmentOptions(record?.departments || []) };
  };

  const getFriendsList = (username) =>
    getAcceptedFriendUsernames(username).map(other => ({
      ...userPublicInfo(other),
      ...getFriendLiveStatus(other)
    }));

  const getPendingRequests = (username) => ({
    incoming: data.friends
      .filter(f => f.status === 'pending' && f.recipient === username)
      .map(f => ({ id: f.id, ...userPublicInfo(f.requester) })),
    outgoing: data.friends
      .filter(f => f.status === 'pending' && f.requester === username)
      .map(f => ({ id: f.id, ...userPublicInfo(f.recipient) }))
  });

  // Avisa a los amigos conectados de alguien que su estado (conectado/departamento) cambió.
  const notifyFriendsOfStatusChange = (username) => {
    const friendUsernames = getAcceptedFriendUsernames(username);
    if (friendUsernames.length === 0) return;
    const status = getFriendLiveStatus(username);
    for (const [sid, u] of users) {
      if (friendUsernames.includes(u.username)) {
        io.to(sid).emit('friend-status-update', { username, ...status });
      }
    }
  };

  const cleanupTemporaryRoom = async (roomName) => {
    const room = data.rooms.find(r => r.name === roomName);
    if (!room || !room.temporary) return false;
    if (!isRoomEmpty(roomName)) return false;

    const roomMessages = data.messages.filter(m => m.room_name === roomName);
    for (const m of roomMessages) {
      if (m.file?.url && m.file.url.startsWith('/uploads/')) {
        const filename = path.basename(m.file.url);
        const filePath = path.join(__dirname, 'uploads', filename);
        try { fs.unlinkSync(filePath); } catch {}
      }
    }

    const idx = data.rooms.findIndex(r => r.name === roomName);
    if (idx !== -1) {
      data.rooms.splice(idx, 1);
    }
    data.messages = data.messages.filter(m => m.room_name !== roomName);
    await deleteRoom(roomName);
    await deleteMessagesByRoom(roomName);
    emitToViewersOfRoom(room, 'room-deleted', { name: roomName });
    roomUsers.delete(roomName);
    return true;
  };

  // Saca del chat la sesión activa de un usuario (cuenta eliminada o bloqueada). Devuelve true si estaba conectado.
  const kickUser = (username, reason, extra) => {
    for (const [sid, u] of users) {
      if (u.username === username) {
        for (const [roomName, sockets] of roomUsers) {
          if (sockets.has(sid)) {
            sockets.delete(sid);
            if (sockets.size === 0) roomUsers.delete(roomName);
            break;
          }
        }
        if (roomUnreads[username]) {
          delete roomUnreads[username];
        }
        if (u.uploadToken) uploadTokens.delete(u.uploadToken);
        io.to(sid).emit('force-disconnect', { reason, ...extra });
        users.delete(sid);
        return true;
      }
    }
    return false;
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
          ip: socket.handshake.address,
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

    for (const [, u] of users) {
      if (u.username === userRecord.username) {
        return callback?.({ ok: false, error: 'Ese usuario ya está conectado' });
      }
    }

    const uploadToken = crypto.randomUUID();
    uploadTokens.set(uploadToken, socket.id);
    users.set(socket.id, { username: userRecord.username, currentRoom: null, displayName: userRecord.displayName || userRecord.username, avatar: userRecord.avatar || null, location: userRecord.location || '', role, department, departments: assignedDepartments, uploadToken, sessionHash });
    socket.username = userRecord.username;
    socket.displayName = userRecord.displayName || userRecord.username;
    socket.avatar = userRecord.avatar || null;
    socket.location = userRecord.location || '';
    socket.department = department;
    socket.pendingUser = null;
    socket.join(role === 'admin' ? ADMIN_ROOM : departmentRoom(department));
    broadcastAllUsers();
    notifyFriendsOfStatusChange(userRecord.username);
    const deptRecord = department ? data.departments.find(d => d.name === department) : null;
    callback?.({
      ok: true,
      rooms: getAllRooms(department, role),
      displayName: userRecord.displayName || userRecord.username,
      avatar: userRecord.avatar || null,
      location: userRecord.location || '',
      role,
      department,
      departmentDisplayName: deptRecord?.displayName || department,
      departments: departmentOptions(assignedDepartments),
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

  const findGroup = (id) => data.groups.find(g => g.id === id);
  const groupMembership = (groupId, username) => data.groupMembers.find(m => m.group_id === groupId && m.username === username);
  const isGroupMember = (groupId, username) => groupMembership(groupId, username)?.status === 'member';
  const canManageGroup = (groupId, username) => {
    const m = groupMembership(groupId, username);
    return m?.status === 'member' && (m.role === 'owner' || m.role === 'admin');
  };
  const groupMemberUsernames = (groupId) => data.groupMembers
    .filter(m => m.group_id === groupId && m.status === 'member')
    .map(m => m.username);

  const emitToUsername = (username, event, payload) => {
    for (const [sid, u] of users) {
      if (u.username === username) io.to(sid).emit(event, payload);
    }
  };

  const userCard = (username) => {
    const r = data.users.find(u => u.username === username);
    return { username, displayName: r?.displayName || username, avatar: r?.avatar || null };
  };

  const groupLastMessage = (groupId) => {
    for (let i = data.messages.length - 1; i >= 0; i--) {
      if (data.messages[i].group_id === groupId) return { ...data.messages[i], type: 'group' };
    }
    return null;
  };

  const groupView = (group, viewer) => {
    const rows = data.groupMembers.filter(m => m.group_id === group.id);
    const me = rows.find(m => m.username === viewer);
    return {
      id: group.id,
      name: group.name,
      created_by: group.created_by,
      created_at: group.created_at,
      myRole: me?.role || null,
      members: rows.filter(m => m.status === 'member').map(m => ({ ...userCard(m.username), role: m.role })),
      invited: rows.filter(m => m.status === 'invited').map(m => ({ ...userCard(m.username), invited_by: m.invited_by })),
      lastMessage: groupLastMessage(group.id)
    };
  };

  const invitationView = (group, membership) => ({
    id: group.id,
    name: group.name,
    invitedBy: userCard(membership.invited_by),
    memberCount: groupMemberUsernames(group.id).length
  });

  // Cada miembro recibe su propia vista (incluye su rol en el grupo).
  const broadcastGroup = (group) => {
    for (const username of groupMemberUsernames(group.id)) {
      emitToUsername(username, 'group-updated', groupView(group, username));
    }
  };

  const getGroupHistory = (groupId, beforeId) => {
    const page = paginate(data.messages.filter(m => m.group_id === groupId), beforeId);
    return { messages: page.messages.map(m => ({ ...m, type: 'group' })), hasMore: page.hasMore };
  };

  const destroyGroup = async (group) => {
    const notify = data.groupMembers.filter(m => m.group_id === group.id).map(m => m.username);
    for (const m of data.messages) {
      if (m.group_id === group.id && m.file?.url && m.file.url.startsWith('/uploads/')) {
        try { fs.unlinkSync(path.join(__dirname, 'uploads', path.basename(m.file.url))); } catch {}
      }
    }
    data.messages = data.messages.filter(m => m.group_id !== group.id);
    data.groupMembers = data.groupMembers.filter(m => m.group_id !== group.id);
    data.groups = data.groups.filter(g => g.id !== group.id);
    await deleteGroup(group.id);
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
      const remaining = data.groupMembers.filter(x => x.group_id === group.id && x.status === 'member');
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
      const target = data.users.find(u => u.username === name);
      if (!target || target.status !== 'active') continue;
      if (data.groupMembers.filter(m => m.group_id === group.id).length >= GROUP_MAX_MEMBERS) break;
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

  io.on('connection', (socket) => {
    socket.on('register', async (data_, callback) => {
      const { username, password, terms_version } = data_ || {};
      const email = normalizeEmail(data_?.email);
      if (!username || !username.trim()) {
        return callback?.({ ok: false, error: 'Nombre de usuario requerido' });
      }
      if (!password || password.length < 3) {
        return callback?.({ ok: false, error: 'Contraseña debe tener al menos 3 caracteres' });
      }
      const name = username.trim().toLowerCase();
      if (!/^[a-z0-9áéíóúüñ]+$/.test(name)) {
        return callback?.({ ok: false, error: 'Solo letras, números (sin espacios)' });
      }
      if (data.users.find(u => u.username === name)) {
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

      const newUser = {
        username: name,
        password: await hashPassword(password),
        displayName: name,
        avatar: null,
        departments: [],
        status: 'pending',
        email,
        twoFactorEnabled: false,
        created_at: new Date().toISOString()
      };
      data.users.push(newUser);
      try {
        await saveUser(newUser);
        await saveConsent(name, terms_version, new Date().toISOString(), socket.handshake.address);
      } catch (err) {
        console.error('register error:', err);
        data.users = data.users.filter(u => u !== newUser);
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }

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
      callback?.(getAllUsers(user?.department, user?.role));
    });

    socket.on('login', async (data_, callback) => {
      const { username, password } = data_ || {};
      if (!username || !username.trim()) {
        return callback?.({ ok: false, error: 'Nombre de usuario requerido' });
      }
      if (!password) {
        return callback?.({ ok: false, error: 'Contraseña requerida' });
      }
      const name = String(username).trim().toLowerCase();
      const userKey = 'login-user:' + name;
      const ipKey = 'login-ip:' + socket.handshake.address;
      const lockedFor = Math.max(lockMinutesLeft(userKey), lockMinutesLeft(ipKey));
      if (lockedFor > 0) {
        return callback?.({ ok: false, error: lockedError(lockedFor) });
      }

      // Mismo mensaje si el usuario no existe o la contraseña es incorrecta: no revela qué cuentas existen.
      const userRecord = data.users.find(u => u.username === name);
      if (!userRecord || !(await verifyPassword(String(password), userRecord.password))) {
        registerFailure(userKey, LOGIN_MAX_FAILS_PER_USER);
        registerFailure(ipKey, LOGIN_MAX_FAILS_PER_IP);
        const nowLocked = Math.max(lockMinutesLeft(userKey), lockMinutesLeft(ipKey));
        return callback?.({ ok: false, error: nowLocked > 0 ? lockedError(nowLocked) : 'Usuario o contraseña incorrectos' });
      }
      clearFailures(userKey);
      if (isLegacyHash(userRecord.password)) {
        // Actualiza la contraseña al formato seguro ahora que la conocemos.
        try {
          userRecord.password = await hashPassword(String(password));
          await saveUser(userRecord);
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
      for (const [, u] of users) {
        if (u.username === name) {
          return callback?.({ ok: false, error: 'Ese usuario ya está conectado' });
        }
      }

      // La contraseña es correcta: ahora se exige el código enviado al correo.
      // La primera vez (doble factor aún no activado) este mismo paso lo activa.
      socket.pendingUser = null;
      socket.resumedSessionHash = null;
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
      const userRecord = data.users.find(u => u.username === pending.username);
      if (!userRecord) return callback?.({ ok: false, error: 'Usuario no encontrado' });
      if (userRecord.email) return callback?.({ ok: false, error: 'Tu cuenta ya tiene un correo registrado' });

      const email = normalizeEmail(data_?.email);
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
      const userRecord = data.users.find(u => u.username === pending.username);
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
      const userRecord = data.users.find(u => u.username === pending.username);
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
      const code = String(data_?.code || '').trim();
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
          await saveUser(userRecord);
        } catch (err) {
          console.error('saveUser error:', err);
          userRecord.email = prevEmail;
          userRecord.twoFactorEnabled = prevEnabled;
          return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
        }
      }
      socket.twoFactor = null;

      for (const [, u] of users) {
        if (u.username === userRecord.username) {
          return callback?.({ ok: false, error: 'Ese usuario ya está conectado', restart: true });
        }
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

      const userRecord = data.users.find(u => u.username === session.username);
      if (!userRecord || userRecord.status !== 'active') {
        deleteSession(tokenHash).catch(() => {});
        return callback?.({ ok: false, expired: true });
      }

      for (const [, u] of users) {
        if (u.username === userRecord.username) {
          if (u.sessionHash !== tokenHash) {
            return callback?.({ ok: false, error: 'Ese usuario ya está conectado en otro equipo' });
          }
          // Misma sesión abierta en otra pestaña (o la conexión vieja de una recarga): se reemplaza.
          kickUser(userRecord.username, 'Abriste el chat en otra pestaña o ventana.', { replaced: true });
          break;
        }
      }

      socket.twoFactor = null;
      socket.resumedSessionHash = tokenHash;
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
      const userRecord = data.users.find(u => u.username === socket.pendingUser.username);
      if (!userRecord) return callback?.({ ok: false, error: 'Usuario no encontrado' });
      if (userRecord.status !== 'active') {
        socket.pendingUser = null;
        return callback?.({ ok: false, error: 'Tu cuenta no está habilitada' });
      }

      const assignedDepartments = userRecord.departments || [];
      if (!department || !assignedDepartments.includes(department)) {
        return callback?.({ ok: false, error: 'Departamento no válido' });
      }
      for (const [, u] of users) {
        if (u.username === userRecord.username) {
          return callback?.({ ok: false, error: 'Ese usuario ya está conectado' });
        }
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

      if (user.role !== 'admin') {
        socket.leave(departmentRoom(user.department));
        socket.join(departmentRoom(department));
      }
      user.department = department;
      socket.department = department;
      if (user.sessionHash) {
        updateSessionDepartment(user.sessionHash, department).catch(err => console.error('updateSessionDepartment error:', err));
      }
      broadcastAllUsers();
      notifyFriendsOfStatusChange(user.username);

      const deptRecord = data.departments.find(d => d.name === department);
      io.to(socket.id).emit('profile-updated', {
        role: user.role,
        department: user.department,
        departmentDisplayName: deptRecord?.displayName || department,
        departments: departmentOptions(user.departments || []),
        rooms: getAllRooms(user.department, user.role)
      });

      callback?.({ ok: true });
    });

    socket.on('join-room', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return;

      const roomName = typeof data_ === 'string' ? data_ : data_?.name;
      const password = typeof data_ === 'object' ? data_?.password : undefined;

      if (!roomName) return;

      const room = data.rooms.find(r => r.name === roomName);
      if (!room) return callback?.({ ok: false, error: 'La sala no existe' });

      if (!canViewRoom(room, user.department, user.role)) {
        return callback?.({ ok: false, error: 'No tienes acceso a esta sala' });
      }

      if (room.password) {
        if (!password) {
          return callback?.({ ok: false, requirePassword: true });
        }
        const roomIpKey = 'room-ip:' + socket.handshake.address;
        const roomLocked = lockMinutesLeft(roomIpKey);
        if (roomLocked > 0) return callback?.({ ok: false, error: lockedError(roomLocked) });
        if (!(await verifyPassword(String(password), room.password))) {
          registerFailure(roomIpKey, ROOM_MAX_FAILS_PER_IP);
          return callback?.({ ok: false, error: 'Contraseña incorrecta' });
        }
        if (isLegacyHash(room.password)) {
          room.password = await hashPassword(String(password));
          saveRoom(room).catch(err => console.error('saveRoom error:', err));
        }
      }

      if (user.currentRoom) {
        socket.leave(user.currentRoom);
        const prev = roomUsers.get(user.currentRoom);
        if (prev) {
          prev.delete(socket.id);
          const wasEmpty = prev.size === 0;
          if (wasEmpty) {
            roomUsers.delete(user.currentRoom);
          } else {
            io.to(user.currentRoom).emit('users-update', {
              room: user.currentRoom,
              users: getOnlineUsers(user.currentRoom)
            });
          }
          if (wasEmpty) {
            cleanupTemporaryRoom(user.currentRoom).catch(err => console.error('cleanupTemporaryRoom error:', err));
          }
        }
      }

      user.currentRoom = roomName;
      socket.join(roomName);

      if (!roomUsers.has(roomName)) {
        roomUsers.set(roomName, new Set());
      }
      roomUsers.get(roomName).add(socket.id);

      io.to(roomName).emit('users-update', {
        room: roomName,
        users: getOnlineUsers(roomName)
      });

      if (roomUnreads[user.username]) {
        roomUnreads[user.username][roomName] = 0;
      }
      io.to(socket.id).emit('room-unread-update', { room: roomName, count: 0 });

      const historyPage = getRoomHistory(roomName);
      callback?.({
        ok: true,
        history: historyPage.messages,
        hasMoreHistory: historyPage.hasMore,
        room: roomName,
        hasPassword: !!room.password,
        temporary: !!room.temporary,
        department: room.department || null,
        users: getOnlineUsers(roomName)
      });
    });

    socket.on('room-message', (data_, callback) => {
      const user = users.get(socket.id);
      if (!user?.currentRoom) return;

      const content = sanitizeContent(data_?.content);
      const file = sanitizeFile(data_?.file);
      const reply = sanitizeReply(data_?.reply);
      if (!content && !file) return;

      const msg = {
        id: Date.now() + Math.random(),
        room_name: user.currentRoom,
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

      data.messages.push(msg);
      io.to(user.currentRoom).emit('room-message', msg);
      saveMessage(msg).catch(err => console.error('saveMessage error:', err));

      for (const [sid, u] of users) {
        if (u.currentRoom !== user.currentRoom) {
          if (!roomUnreads[u.username]) roomUnreads[u.username] = {};
          const count = (roomUnreads[u.username][user.currentRoom] || 0) + 1;
          roomUnreads[u.username][user.currentRoom] = count;
          io.to(sid).emit('room-unread-update', { room: user.currentRoom, count });
        }
      }

      callback?.({ ok: true });
    });

    socket.on('private-message', (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return;

      const recipient = data_?.recipient;
      const content = sanitizeContent(data_?.content);
      const file = sanitizeFile(data_?.file);
      const reply = sanitizeReply(data_?.reply);
      if (typeof recipient !== 'string' || !data.users.some(u => u.username === recipient) || (!content && !file)) return;

      const msg = {
        id: Date.now() + Math.random(),
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

      data.messages.push(msg);
      saveMessage(msg).catch(err => console.error('saveMessage error:', err));

      for (const [sid, u] of users) {
        if (u.username === recipient) {
          io.to(sid).emit('private-message', msg);
          break;
        }
      }

      socket.emit('private-message', msg);
      callback?.({ ok: true });
    });

    socket.on('add-reaction', (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.({ ok: false });

      const { messageId, emoji } = data_ || {};
      if (!messageId || !emoji) return;

      const msg = data.messages.find(m => m.id === messageId);
      if (!msg) return callback?.({ ok: false, error: 'Mensaje no encontrado' });

      if (msg.room_name) {
        const room = data.rooms.find(r => r.name === msg.room_name);
        if (!room || !canViewRoom(room, user.department, user.role)) {
          return callback?.({ ok: false, error: 'No tienes acceso a este mensaje' });
        }
      } else if (msg.group_id) {
        if (!isGroupMember(msg.group_id, user.username)) {
          return callback?.({ ok: false, error: 'No tienes acceso a este mensaje' });
        }
      } else if (msg.recipient) {
        if (user.username !== msg.sender && user.username !== msg.recipient) {
          return callback?.({ ok: false, error: 'No tienes acceso a este mensaje' });
        }
      }

      if (!msg.reactions) msg.reactions = {};

      let removed = false;
      let prevEmoji = null;
      // Check if user already has any reaction
      for (const [e, usersList] of Object.entries(msg.reactions)) {
        const idx = usersList.indexOf(user.username);
        if (idx !== -1) {
          prevEmoji = e;
          if (e === emoji) {
            // Same emoji → remove it
            usersList.splice(idx, 1);
            if (usersList.length === 0) delete msg.reactions[e];
            removed = true;
          }
          break;
        }
      }

      if (removed) {
        // removed the reaction, nothing else to do
      } else {
        // Remove previous reaction if exists
        if (prevEmoji && prevEmoji !== emoji) {
          const usersList = msg.reactions[prevEmoji];
          const idx = usersList.indexOf(user.username);
          if (idx !== -1) {
            usersList.splice(idx, 1);
            if (usersList.length === 0) delete msg.reactions[prevEmoji];
          }
        }
        // Add new reaction
        if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
        msg.reactions[emoji].push(user.username);
      }

      updateMessageReactions(msg.id, msg.reactions).catch(err => console.error('updateMessageReactions error:', err));

      // Broadcast the update to everyone who can see the message
      if (msg.room_name) {
        io.to(msg.room_name).emit('reaction-updated', msg);
      } else if (msg.group_id) {
        for (const username of groupMemberUsernames(msg.group_id)) {
          emitToUsername(username, 'reaction-updated', msg);
        }
      } else if (msg.recipient) {
        for (const [sid, u] of users) {
          if (u.username === msg.sender || u.username === msg.recipient) {
            io.to(sid).emit('reaction-updated', msg);
          }
        }
      }

      callback?.({ ok: true, reactions: msg.reactions });
    });

    socket.on('update-display-name', (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.({ ok: false, error: 'No autenticado' });

      const displayName = data_?.displayName?.trim();
      if (!displayName) return callback?.({ ok: false, error: 'Nombre requerido' });
      if (displayName.length > 40) return callback?.({ ok: false, error: 'Maximo 40 caracteres' });

      user.displayName = displayName;
      const record = data.users.find(u => u.username === user.username);
      if (record) {
        record.displayName = displayName;
        saveUser(record).catch(err => console.error('saveUser error:', err));
      }
      socket.displayName = displayName;
      broadcastAllUsers();
      emitToViewersOf(user, 'display-name-updated', { username: user.username, displayName });
      if (user.currentRoom) {
        io.to(user.currentRoom).emit('users-update', {
          room: user.currentRoom,
          users: getOnlineUsers(user.currentRoom)
        });
      }
      callback?.({ ok: true, displayName });
    });

    socket.on('update-avatar', (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.({ ok: false, error: 'No autenticado' });

      const avatar = data_?.avatar || null;
      if (avatar !== null && (typeof avatar !== 'string' || !UPLOAD_URL_RE.test(avatar) || avatar.includes('..'))) {
        return callback?.({ ok: false, error: 'Imagen no válida' });
      }
      user.avatar = avatar;
      const record = data.users.find(u => u.username === user.username);
      if (record) {
        record.avatar = avatar;
        saveUser(record).catch(err => console.error('saveUser error:', err));
      }
      socket.avatar = avatar;
      broadcastAllUsers();
      emitToViewersOf(user, 'avatar-updated', { username: user.username, avatar });
      if (user.currentRoom) {
        io.to(user.currentRoom).emit('users-update', {
          room: user.currentRoom,
          users: getOnlineUsers(user.currentRoom)
        });
      }
      callback?.({ ok: true, avatar });
    });

    socket.on('change-password', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.({ ok: false, error: 'No autenticado' });

      const { currentPassword, newPassword } = data_ || {};
      if (!currentPassword) return callback?.({ ok: false, error: 'Contraseña actual requerida' });
      if (!newPassword || newPassword.length < 3) return callback?.({ ok: false, error: 'Mínimo 3 caracteres' });

      const record = data.users.find(u => u.username === user.username);
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
        await saveUser(record);
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

      const name = data_?.name?.trim()?.toLowerCase()?.replace(/\s+/g, '-');
      if (!name) return callback?.({ ok: false, error: 'Nombre requerido' });

      if (!/^[a-z0-9-áéíóúüñ]+$/.test(name)) {
        return callback?.({ ok: false, error: 'Solo letras, números y guiones' });
      }

      if (data.rooms.find(r => r.name === name)) {
        return callback?.({ ok: false, error: 'Esa sala ya existe' });
      }

      const password = data_?.password?.trim() || null;
      const temporary = !!data_?.temporary;

      if (!temporary && user.role !== 'admin') {
        return callback?.({ ok: false, error: 'Solo administradores pueden crear salas fijas' });
      }

      let department;
      if (user.role === 'admin') {
        department = data_?.department || null;
        if (department && !data.departments.find(d => d.name === department)) {
          return callback?.({ ok: false, error: 'Departamento no válido' });
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
      callback?.({ ok: true, name });
    });

    socket.on('get-rooms', (callback) => {
      const user = users.get(socket.id);
      callback?.(getAllRooms(user?.department, user?.role));
    });

    socket.on('get-conversations', (callback) => {
      const user = users.get(socket.id);
      if (!user) return;
      callback?.(getConversations(user.username));
    });

    socket.on('search-users', (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.([]);

      const query = (data_?.query || '').trim().toLowerCase();
      if (query.length < 2) return callback?.([]);

      const results = data.users
        .filter(u => u.username !== user.username && (u.username.includes(query) || (u.displayName || '').toLowerCase().includes(query)))
        .filter(u => !data_?.activeOnly || u.status === 'active')
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

      const targetRecord = data.users.find(u => u.username === target);
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

        for (const [sid, u] of users) {
          if (u.username === existing.requester) {
            io.to(sid).emit('friend-request-accepted', userPublicInfo(user.username));
            break;
          }
        }
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

      for (const [sid, u] of users) {
        if (u.username === target) {
          io.to(sid).emit('friend-request-received', { id: newRequest.id, ...userPublicInfo(user.username) });
          break;
        }
      }

      callback?.({ ok: true });
    });

    socket.on('respond-friend-request', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.({ ok: false, error: 'No autenticado' });

      const { requestId, accept } = data_ || {};
      const request = data.friends.find(f => f.id === requestId && f.recipient === user.username && f.status === 'pending');
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

      for (const [sid, u] of users) {
        if (u.username === request.requester) {
          io.to(sid).emit(accept ? 'friend-request-accepted' : 'friend-request-rejected', userPublicInfo(user.username));
          break;
        }
      }

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

      for (const [sid, u] of users) {
        if (u.username === other) {
          io.to(sid).emit('friend-removed', { username: user.username });
          break;
        }
      }

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

    socket.on('get-room-unreads', (callback) => {
      const user = users.get(socket.id);
      if (!user) return;
      callback?.(roomUnreads[user.username] || {});
    });

    socket.on('get-all-registered-users', (callback) => {
      const user = users.get(socket.id);
      if (!user || user.role !== 'admin') return callback?.([]);
      callback?.(data.users.map(u => ({
        username: u.username,
        displayName: u.displayName || u.username,
        role: u.role || 'user',
        departments: u.departments || [],
        status: u.status || 'active',
        email: u.email || null,
        twoFactorEnabled: !!u.twoFactorEnabled,
        created_at: u.created_at
      })));
    });

    socket.on('get-pending-registrations', (callback) => {
      const user = users.get(socket.id);
      if (!user || user.role !== 'admin') return callback?.([]);
      callback?.(data.users.filter(u => u.status === 'pending').map(u => ({
        username: u.username,
        displayName: u.displayName || u.username,
        email: u.email || null,
        created_at: u.created_at
      })));
    });

    socket.on('admin-approve-registration', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user || user.role !== 'admin') return callback?.({ ok: false, error: 'No autorizado' });

      const target = data.users.find(u => u.username === data_?.username);
      if (!target) return callback?.({ ok: false, error: 'Usuario no encontrado' });
      if (target.status !== 'pending') return callback?.({ ok: false, error: 'Esa cuenta no está pendiente' });

      target.status = 'active';
      try {
        await saveUser(target);
      } catch (err) {
        console.error('admin-approve-registration error:', err);
        target.status = 'pending';
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }
      callback?.({ ok: true });
    });

    socket.on('admin-reject-registration', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user || user.role !== 'admin') return callback?.({ ok: false, error: 'No autorizado' });

      const target = data.users.find(u => u.username === data_?.username);
      if (!target) return callback?.({ ok: false, error: 'Usuario no encontrado' });
      if (target.status !== 'pending') return callback?.({ ok: false, error: 'Esa cuenta no está pendiente' });

      target.status = 'rejected';
      try {
        await saveUser(target);
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

      const { username, displayName, role, departments, email } = data_ || {};
      if (!username) return callback?.({ ok: false, error: 'Usuario requerido' });

      const target = data.users.find(u => u.username === username);
      if (!target) return callback?.({ ok: false, error: 'Usuario no encontrado' });

      let newEmail;
      if (email !== undefined) {
        newEmail = normalizeEmail(email) || null;
        const editEmailError = newEmail && newEmail !== (target.email || null) ? emailError(newEmail) : null;
        if (editEmailError) return callback?.({ ok: false, error: editEmailError });
        if (newEmail && emailInUse(newEmail, target.username)) return callback?.({ ok: false, error: 'Ese correo ya está registrado en otra cuenta' });
      }

      if (displayName !== undefined) target.displayName = displayName;
      if (role !== undefined && (role === 'admin' || role === 'user')) target.role = role;
      if (departments !== undefined) {
        const deptList = Array.isArray(departments) ? departments.filter(Boolean) : [];
        for (const d of deptList) {
          if (!data.departments.find(x => x.name === d)) {
            return callback?.({ ok: false, error: 'Departamento no válido: ' + d });
          }
        }
        target.departments = deptList;
      }
      if (newEmail !== undefined && newEmail !== (target.email || null)) {
        // Correo nuevo = hay que volver a verificarlo: el doble factor se reactiva en el próximo ingreso.
        target.email = newEmail;
        target.twoFactorEnabled = false;
        loginCodes.delete(target.username);
      }
      try {
        await saveUser(target);
      } catch (err) {
        console.error('saveUser error:', err);
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }

      for (const [sid, u] of users) {
        if (u.username === username) {
          const prevRoom = visibilityRoomFor(u);
          if (role !== undefined) u.role = target.role;
          if (departments !== undefined) {
            u.departments = target.departments;
            if (u.department && !u.departments.includes(u.department)) {
              u.department = u.departments[0] || null;
            }
          }
          const newRoom = visibilityRoomFor(u);
          if (newRoom !== prevRoom) {
            const targetSocket = io.sockets.sockets.get(sid);
            if (targetSocket) {
              targetSocket.leave(prevRoom);
              targetSocket.join(newRoom);
            }
          }
          const deptRecord = u.department ? data.departments.find(d => d.name === u.department) : null;
          io.to(sid).emit('profile-updated', {
            role: u.role,
            department: u.department,
            departmentDisplayName: deptRecord?.displayName || u.department,
            departments: departmentOptions(u.departments || []),
            rooms: getAllRooms(u.department, u.role)
          });
          break;
        }
      }

      broadcastAllUsers();
      emitToViewersOf({ role: target.role, department: (target.departments && target.departments[0]) || null }, 'display-name-updated', { username, displayName: target.displayName || username });

      callback?.({ ok: true });
    });

    socket.on('delete-room', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user || user.role !== 'admin') return callback?.({ ok: false, error: 'No autorizado' });

      const roomName = data_?.name;
      if (!roomName) return callback?.({ ok: false, error: 'Nombre requerido' });

      const idx = data.rooms.findIndex(r => r.name === roomName);
      if (idx === -1) return callback?.({ ok: false, error: 'Sala no existe' });
      if (roomName === 'general') return callback?.({ ok: false, error: 'No puedes eliminar la sala general' });

      const room = data.rooms[idx];
      data.rooms.splice(idx, 1);
      data.messages = data.messages.filter(m => m.room_name !== roomName);
      try {
        await deleteRoom(roomName);
        await deleteMessagesByRoom(roomName);
      } catch (err) {
        console.error('delete-room error:', err);
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }

      emitToViewersOfRoom(room, 'room-deleted', { name: roomName });
      callback?.({ ok: true });
    });

    socket.on('admin-set-room-password', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user || user.role !== 'admin') return callback?.({ ok: false, error: 'No autorizado' });

      const { name, password } = data_ || {};
      if (!name) return callback?.({ ok: false, error: 'Nombre requerido' });
      if (name === 'general') return callback?.({ ok: false, error: 'No puedes cambiar la contraseña de la sala general' });

      const room = data.rooms.find(r => r.name === name);
      if (!room) return callback?.({ ok: false, error: 'Sala no existe' });

      room.password = password ? await hashPassword(String(password)) : null;
      try {
        await saveRoom(room);
      } catch (err) {
        console.error('saveRoom error:', err);
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }

      emitToViewersOfRoom(room, 'room-password-changed', { name, hasPassword: !!room.password });
      callback?.({ ok: true });
    });

    socket.on('get-stats', (callback) => {
      const user = users.get(socket.id);
      if (!user || user.role !== 'admin') return;
      const byDepartment = data.departments.map(d => ({
        name: d.name,
        displayName: d.displayName,
        users: data.users.filter(u => (u.departments || []).includes(d.name)).length,
        online: Array.from(users.values()).filter(u => u.department === d.name).length,
        rooms: data.rooms.filter(r => r.department === d.name).length
      }));
      callback({
        totalUsers: data.users.length,
        connectedUsers: users.size,
        totalMessages: data.messages.length,
        totalRooms: data.rooms.length,
        departments: byDepartment
      });
    });

    socket.on('admin-reset-password', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user || user.role !== 'admin') return callback?.({ ok: false, error: 'No autorizado' });

      const { username, newPassword } = data_ || {};
      if (!username) return callback?.({ ok: false, error: 'Usuario requerido' });
      if (username === user.username) return callback?.({ ok: false, error: 'No puedes cambiar tu propia contraseña aquí' });
      if (!newPassword || newPassword.length < 3) return callback?.({ ok: false, error: 'Mínimo 3 caracteres' });

      const target = data.users.find(u => u.username === username);
      if (!target) return callback?.({ ok: false, error: 'Usuario no encontrado' });

      target.password = await hashPassword(String(newPassword));
      clearFailures('login-user:' + target.username); // el admin le da una contraseña nueva: se quita el bloqueo por intentos
      try {
        await saveUser(target);
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

      const idx = data.users.findIndex(u => u.username === delUsername);
      if (idx === -1) return callback?.({ ok: false, error: 'Usuario no encontrado' });

      data.users.splice(idx, 1);
      try {
        await deleteUser(delUsername);
      } catch (err) {
        console.error('deleteUser error:', err);
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }
      const removedFriendUsernames = getAcceptedFriendUsernames(delUsername);
      data.friends = data.friends.filter(f => f.requester !== delUsername && f.recipient !== delUsername);
      for (const [sid, u] of users) {
        if (removedFriendUsernames.includes(u.username)) {
          io.to(sid).emit('friend-removed', { username: delUsername });
        }
      }

      for (const m of data.groupMembers.filter(x => x.username === delUsername)) {
        const group = findGroup(m.group_id);
        if (!group) continue;
        try {
          if (await removeGroupMembership(group, delUsername) !== 'deleted') broadcastGroup(group);
        } catch (err) {
          console.error('removeGroupMembership error:', err);
        }
      }

      kickUser(delUsername, 'Tu cuenta ha sido eliminada por un administrador');

      broadcastAllUsers();
      callback?.({ ok: true });
    });

    socket.on('admin-block-user', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user || user.role !== 'admin') return callback?.({ ok: false, error: 'No autorizado' });

      const { username, blocked } = data_ || {};
      if (!username) return callback?.({ ok: false, error: 'Usuario requerido' });
      if (username === user.username) return callback?.({ ok: false, error: 'No puedes bloquearte a ti mismo' });
      if (username === 'admin') return callback?.({ ok: false, error: 'No puedes bloquear al usuario admin' });

      const target = data.users.find(u => u.username === username);
      if (!target) return callback?.({ ok: false, error: 'Usuario no encontrado' });
      if (blocked && target.status !== 'active') return callback?.({ ok: false, error: 'Solo se pueden bloquear cuentas activas' });
      if (!blocked && target.status !== 'blocked') return callback?.({ ok: false, error: 'Esa cuenta no está bloqueada' });

      const prevStatus = target.status;
      target.status = blocked ? 'blocked' : 'active';
      try {
        await saveUser(target);
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
      if (!username || !data.users.some(u => u.username === username)) return callback?.({ ok: false, error: 'Usuario no encontrado' });
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
      if (!user || user.role !== 'admin') return callback?.({ ok: false, error: 'No autorizado' });

      const name = data_?.name?.trim()?.toLowerCase()?.replace(/\s+/g, '-');
      const displayName = data_?.displayName?.trim() || name;
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
      if (data.rooms.find(r => r.name === roomName)) {
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
      if (!user || user.role !== 'admin') return callback?.({ ok: false, error: 'No autorizado' });

      const name = data_?.name;
      if (!name) return callback?.({ ok: false, error: 'Nombre requerido' });

      const idx = data.departments.findIndex(d => d.name === name);
      if (idx === -1) return callback?.({ ok: false, error: 'Departamento no existe' });

      const usersAssigned = data.users.filter(u => (u.departments || []).includes(name)).length;
      if (usersAssigned > 0) {
        return callback?.({ ok: false, error: `Hay ${usersAssigned} usuario(s) asignados a este departamento. Reasígnalos antes de eliminarlo.` });
      }

      const deptRooms = data.rooms.filter(r => r.department === name);
      for (const room of deptRooms) {
        const roomMessages = data.messages.filter(m => m.room_name === room.name);
        for (const m of roomMessages) {
          if (m.file?.url && m.file.url.startsWith('/uploads/')) {
            const filename = path.basename(m.file.url);
            const filePath = path.join(__dirname, 'uploads', filename);
            try { fs.unlinkSync(filePath); } catch {}
          }
        }
        data.messages = data.messages.filter(m => m.room_name !== room.name);
        emitToViewersOfRoom(room, 'room-deleted', { name: room.name });
        roomUsers.delete(room.name);
      }
      data.rooms = data.rooms.filter(r => r.department !== name);
      data.departments.splice(idx, 1);

      try {
        for (const room of deptRooms) {
          await deleteMessagesByRoom(room.name);
          await deleteRoom(room.name);
        }
        await deleteDepartment(name);
      } catch (err) {
        console.error('admin-delete-department error:', err);
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }

      io.emit('department-deleted', { name });
      callback?.({ ok: true });
    });

    socket.on('panic-alert', () => {
      const user = users.get(socket.id);
      if (!user) return;

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

      for (const [sid, u] of users) {
        if (sid === socket.id) continue;
        const sameDept = !!(user.department && u.department === user.department);
        const senderIsGlobal = !user.department;
        const recipientIsAdmin = u.role === 'admin';
        if (sameDept || senderIsGlobal || recipientIsAdmin) {
          io.to(sid).emit('panic-alert', payload);
        }
      }

      saveAlert({
        username: user.username,
        displayName: user.displayName || user.username,
        department: user.department || null,
        departmentDisplayName: deptRecord?.displayName || user.department || null,
        location: user.location || '',
        created_at: timestamp
      }).catch(err => console.error('saveAlert error:', err));

      sendPanicAlertEmail(payload).catch(err => console.error('sendPanicAlertEmail error:', err));
    });

    socket.on('get-alert-history', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user || user.role !== 'admin') return callback?.({ alerts: [], hasMore: false });

      const limit = 50;
      const offset = data_?.offset || 0;
      try {
        const rows = await getAlertHistory(limit + 1, offset);
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

      const location = data_?.location?.trim() || '';
      if (location.length > 100) {
        return callback?.({ ok: false, error: 'Máximo 100 caracteres' });
      }

      user.location = location;
      const record = data.users.find(u => u.username === user.username);
      if (record) {
        record.location = location || null;
        saveUser(record).catch(err => console.error('saveUser error:', err));
      }
      callback?.({ ok: true, location });
    });

    // ===== Grupos =====

    socket.on('get-groups', (callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.({ groups: [], invitations: [] });
      const mine = data.groupMembers.filter(m => m.username === user.username);
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

    socket.on('group-message', (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return;
      const group = findGroup(data_?.groupId);
      if (!group || !isGroupMember(group.id, user.username)) return callback?.({ ok: false, error: 'No perteneces a este grupo' });

      const content = sanitizeContent(data_?.content);
      const file = sanitizeFile(data_?.file);
      const reply = sanitizeReply(data_?.reply);
      if (!content && !file) return;

      const msg = {
        id: Date.now() + Math.random(),
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

      data.messages.push(msg);
      saveMessage(msg).catch(err => console.error('saveMessage error:', err));
      for (const username of groupMemberUsernames(group.id)) {
        emitToUsername(username, 'group-message', msg);
      }
      callback?.({ ok: true });
    });

    socket.on('get-group-history', (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return;
      const groupId = data_?.groupId;
      if (!isGroupMember(groupId, user.username)) return callback?.({ ok: false, error: 'No perteneces a este grupo' });
      const page = getGroupHistory(groupId);
      callback?.({ ok: true, history: page.messages, hasMoreHistory: page.hasMore });
    });

    socket.on('get-private-history', (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return;

      const other = data_?.with;
      if (!other) return;

      const page = getPrivateHistory(user.username, other);
      callback?.({ history: page.messages, hasMoreHistory: page.hasMore });
    });

    socket.on('get-more-messages', (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.({ messages: [], hasMore: false });

      const { room, with: withUser, group: groupId, beforeId } = data_ || {};
      if (groupId) {
        if (!isGroupMember(groupId, user.username)) return callback?.({ messages: [], hasMore: false });
        const page = getGroupHistory(groupId, beforeId);
        return callback?.({ messages: page.messages, hasMore: page.hasMore });
      }
      if (room) {
        if (room !== user.currentRoom) {
          return callback?.({ messages: [], hasMore: false });
        }
        const page = getRoomHistory(room, beforeId);
        return callback?.({ messages: page.messages, hasMore: page.hasMore });
      }
      if (withUser) {
        const page = getPrivateHistory(user.username, withUser, beforeId);
        return callback?.({ messages: page.messages, hasMore: page.hasMore });
      }
      callback?.({ messages: [], hasMore: false });
    });

    socket.on('disconnect', () => {
      const user = users.get(socket.id);
      if (!user) return;

      if (user.uploadToken) uploadTokens.delete(user.uploadToken);
      const oldRoom = user.currentRoom;

      for (const [roomName, sockets] of roomUsers) {
        if (sockets.has(socket.id)) {
          sockets.delete(socket.id);
          if (sockets.size === 0) {
            roomUsers.delete(roomName);
          } else {
            io.to(roomName).emit('users-update', {
              room: roomName,
              users: getOnlineUsers(roomName)
            });
          }
        }
      }

      if (user.username && roomUnreads[user.username]) {
        delete roomUnreads[user.username];
      }
      users.delete(socket.id);
      broadcastAllUsers();
      notifyFriendsOfStatusChange(user.username);

      if (oldRoom) {
        cleanupTemporaryRoom(oldRoom).catch(err => console.error('cleanupTemporaryRoom error:', err));
      }
    });
  });

  return {
    isValidUploadToken: (token) => uploadTokens.has(token)
  };
};
