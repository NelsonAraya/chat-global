// Salas: entrar, escribir, crear, salas temporales y avisos de no leídos.
const { canViewRoom, inAdminScope } = require('./permissions');
const { sanitizeContent, str } = require('./validation');

module.exports = (ctx) => {
  const { data, departmentRoom, ADMIN_ROOM, AUTH_ROOM, io, roomUsers, users, findRoom, deleteUploadedFile,
    isGlobalRoom, lockMinutesLeft, lockedError, registerFailure, ROOM_MAX_FAILS_PER_USER, userEntry,
    getRoomHistory, buildReply, claimMessageFile, nextMessageId, returnUpload, SEND_ERROR } = ctx;
  const { getRoomFileUrls, deleteRoom, deleteMessagesByRoom, verifyPassword, isLegacyHash, hashPassword, saveRoom,
    saveMessage } = ctx.db;

  const getAllRooms = (viewer) => (viewer ? data.rooms
    .filter(r => canViewRoom(r, viewer))
    .map(r => ({ name: r.name, hasPassword: !!r.password, temporary: !!r.temporary, department: r.department || null })) : []);

  // Quiénes ven una sala: global = todos; de un departamento = ese departamento y los admins.
  const roomViewerRooms = (room) => (room.department ? [departmentRoom(room.department), ADMIN_ROOM] : [AUTH_ROOM]);
  const emitToViewersOfRoom = (room, event, payload) => io.to(roomViewerRooms(room)).emit(event, payload);

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

  // Salas temporales: cada usuario puede tener pocas abiertas a la vez, y una que nadie usa no se queda
  // para siempre (antes solo se borraba al salir la última persona, así que una sala creada y nunca usada
  // quedaba en la lista de todo el departamento).

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

  Object.assign(ctx, { getAllRooms, emitToViewersOfRoom, cleanupTemporaryRoom, leaveRoomIfNoAccess, emptyRoom });

  return (socket) => {
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

    // Los no leídos los cuenta cada navegador desde que entra (se mantiene por compatibilidad).
    socket.on('get-room-unreads', (callback) => {
      callback?.({});
    });
  };
};
