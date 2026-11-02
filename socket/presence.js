// Presencia: quién ve a quién en "Conectados", avisos de entrada/salida y expulsión de una sesión.
const { isSuperAdmin, deptsOf, canViewUser } = require('./permissions');

module.exports = (ctx) => {
  const { users, io, userEntry, isGlobalRoom, onlineSid, roomUsers, uploadTokens, socketIdByUsername,
    setSocketSession } = ctx;

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

  // ===== Presencia: se avisa solo el cambio ("entró", "salió", "cambió su nombre") =====
  // Antes cada ingreso o salida reenviaba la lista completa de conectados a todos (con 1000 usuarios,
  // ~6,5 MB por ingreso). Ahora cada navegador recibe la lista una vez al entrar y luego solo los cambios,
  // y solo quienes pueden ver a esa persona.

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

  const emitToUsername = (username, event, payload) => {
    const sid = onlineSid(username);
    if (sid) io.to(sid).emit(event, payload);
  };

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

  Object.assign(ctx, { departmentRoom, ADMIN_ROOM, AUTH_ROOM, visibilityRoomsFor, getAllUsers, presenceRooms,
    announceOnline, announceOffline, movePresence, announceUserUpdate, emitToUsername, kickUser });

  return (socket) => {
    socket.on('get-all-users', (callback) => {
      const user = users.get(socket.id);
      callback?.(getAllUsers(user));
    });
  };
};
