const fs = require('fs');
const path = require('path');

module.exports = (io, db) => {
  const {
    data, hashPassword,
    saveUser, deleteUser,
    saveRoom, deleteRoom,
    saveMessage, updateMessageReactions, deleteMessagesByRoom,
    saveDepartment, deleteDepartment,
    saveConsent
  } = db;
  const TERMS_VERSION = '1.0';
  const users = new Map();
  const roomUsers = new Map();
  const roomUnreads = {};

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

  // La lista de "todos los usuarios" es distinta para cada visor (según su departamento),
  // así que se envía personalizada en vez de un io.emit único.
  const broadcastAllUsers = () => {
    for (const [sid, u] of users) {
      io.to(sid).emit('all-users', { users: getAllUsers(u.department, u.role) });
    }
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

  const departmentOptions = (names) => names.map(n => {
    const rec = data.departments.find(d => d.name === n);
    return { name: n, displayName: rec?.displayName || n };
  });

  const finalizeLogin = (socket, userRecord, department, callback) => {
    const role = userRecord.role || 'user';
    const assignedDepartments = userRecord.departments || [];
    users.set(socket.id, { username: userRecord.username, currentRoom: null, displayName: userRecord.displayName || userRecord.username, avatar: userRecord.avatar || null, location: userRecord.location || '', role, department, departments: assignedDepartments });
    socket.username = userRecord.username;
    socket.displayName = userRecord.displayName || userRecord.username;
    socket.avatar = userRecord.avatar || null;
    socket.location = userRecord.location || '';
    socket.department = department;
    socket.pendingUser = null;
    broadcastAllUsers();
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
      departments: departmentOptions(assignedDepartments)
    });
  };

  io.on('connection', (socket) => {
    socket.on('register', async (data_, callback) => {
      const { username, password, terms_version, department } = data_ || {};
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
      if (!terms_version) {
        return callback?.({ ok: false, error: 'Debes aceptar los Términos y Condiciones' });
      }

      let userDepartments = [];
      if (data.departments.length > 0) {
        if (!department) return callback?.({ ok: false, error: 'Selecciona tu departamento/centro' });
        if (!data.departments.find(d => d.name === department)) {
          return callback?.({ ok: false, error: 'Departamento no válido' });
        }
        userDepartments = [department];
      }

      const newUser = {
        username: name,
        password: hashPassword(password),
        displayName: name,
        avatar: null,
        departments: userDepartments,
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
      callback?.({ ok: true });
    });

    socket.on('get-departments', (callback) => {
      callback?.(data.departments.map(d => ({ name: d.name, displayName: d.displayName })));
    });

    socket.on('get-all-users', (callback) => {
      const user = users.get(socket.id);
      callback?.(getAllUsers(user?.department, user?.role));
    });

    socket.on('login', (data_, callback) => {
      const { username, password } = data_ || {};
      if (!username || !username.trim()) {
        return callback?.({ ok: false, error: 'Nombre de usuario requerido' });
      }
      if (!password) {
        return callback?.({ ok: false, error: 'Contraseña requerida' });
      }
      const name = username.trim().toLowerCase();
      const userRecord = data.users.find(u => u.username === name);
      if (!userRecord) {
        return callback?.({ ok: false, error: 'Usuario no encontrado' });
      }
      if (userRecord.password !== hashPassword(password)) {
        return callback?.({ ok: false, error: 'Contraseña incorrecta' });
      }
      for (const [, u] of users) {
        if (u.username === name) {
          return callback?.({ ok: false, error: 'Ese usuario ya está conectado' });
        }
      }

      const assignedDepartments = userRecord.departments || [];
      if (assignedDepartments.length > 1) {
        socket.pendingUser = { username: name };
        return callback?.({
          ok: true,
          requireDepartment: true,
          departments: departmentOptions(assignedDepartments)
        });
      }

      finalizeLogin(socket, userRecord, assignedDepartments[0] || null, callback);
    });

    socket.on('select-department', (data_, callback) => {
      if (!socket.pendingUser) return callback?.({ ok: false, error: 'No hay una sesión pendiente' });

      const { department } = data_ || {};
      const userRecord = data.users.find(u => u.username === socket.pendingUser.username);
      if (!userRecord) return callback?.({ ok: false, error: 'Usuario no encontrado' });

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

      user.department = department;
      socket.department = department;
      broadcastAllUsers();

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

    socket.on('join-room', (data_, callback) => {
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
        if (hashPassword(password) !== room.password) {
          return callback?.({ ok: false, error: 'Contraseña incorrecta' });
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
        users: getOnlineUsers(roomName)
      });
    });

    socket.on('room-message', (data_, callback) => {
      const user = users.get(socket.id);
      if (!user?.currentRoom) return;

      const content = data_?.content?.trim();
      const file = data_?.file;
      const reply = data_?.reply;
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

      const { recipient, content } = data_ || {};
      const file = data_?.file;
      const reply = data_?.reply;
      if (!recipient || (!content?.trim() && !file)) return;

      const msg = {
        id: Date.now() + Math.random(),
        sender: user.username,
        displayName: user.displayName || user.username,
        avatar: user.avatar || null,
        recipient,
        content: content?.trim() || '',
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
      if (record.password !== hashPassword(currentPassword)) return callback?.({ ok: false, error: 'Contraseña actual incorrecta' });

      const previousPassword = record.password;
      record.password = hashPassword(newPassword);
      try {
        await saveUser(record);
      } catch (err) {
        console.error('saveUser error:', err);
        record.password = previousPassword;
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }
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
        password: password ? hashPassword(password) : null,
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
        created_at: u.created_at
      })));
    });

    socket.on('update-user', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user || user.role !== 'admin') return callback?.({ ok: false, error: 'No autorizado' });

      const { username, displayName, role, departments } = data_ || {};
      if (!username) return callback?.({ ok: false, error: 'Usuario requerido' });

      const target = data.users.find(u => u.username === username);
      if (!target) return callback?.({ ok: false, error: 'Usuario no encontrado' });

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
      try {
        await saveUser(target);
      } catch (err) {
        console.error('saveUser error:', err);
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }

      for (const [sid, u] of users) {
        if (u.username === username) {
          if (role !== undefined) u.role = target.role;
          if (departments !== undefined) {
            u.departments = target.departments;
            if (u.department && !u.departments.includes(u.department)) {
              u.department = u.departments[0] || null;
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

      room.password = password ? hashPassword(password) : null;
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

      target.password = hashPassword(newPassword);
      try {
        await saveUser(target);
      } catch (err) {
        console.error('saveUser error:', err);
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
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

      for (const [sid, u] of users) {
        if (u.username === delUsername) {
          for (const [roomName, sockets] of roomUsers) {
            if (sockets.has(sid)) {
              sockets.delete(sid);
              if (sockets.size === 0) roomUsers.delete(roomName);
              break;
            }
          }
          if (roomUnreads[delUsername]) {
            delete roomUnreads[delUsername];
          }
          io.to(sid).emit('force-disconnect', { reason: 'Tu cuenta ha sido eliminada por un administrador' });
          users.delete(sid);
          break;
        }
      }

      broadcastAllUsers();
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
      const payload = {
        username: user.username,
        displayName: user.displayName || user.username,
        location: user.location || '',
        department: user.department || null,
        departmentDisplayName: deptRecord?.displayName || user.department || null,
        timestamp: new Date().toISOString()
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

      const { room, with: withUser, beforeId } = data_ || {};
      if (room) {
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

      if (oldRoom) {
        cleanupTemporaryRoom(oldRoom).catch(err => console.error('cleanupTemporaryRoom error:', err));
      }
    });
  });
};
