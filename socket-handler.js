const fs = require('fs');
const path = require('path');

module.exports = (io, db) => {
  const { data, save, hashPassword, saveConsent } = db;
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

  const getAllRooms = () => data.rooms.map(r => ({
    name: r.name,
    hasPassword: !!r.password,
    temporary: !!r.temporary
  }));

  const getAllUsers = () => {
    const seen = new Map();
    for (const [, u] of users) {
      if (!seen.has(u.username)) {
        seen.set(u.username, { username: u.username, displayName: u.displayName || u.username, avatar: u.avatar || null });
      }
    }
    return Array.from(seen.values());
  };

  const getRoomHistory = (roomName) => {
    return data.messages
      .filter(m => m.room_name === roomName && !m.recipient)
      .map(m => ({ ...m, type: 'room' }));
  };

  const getPrivateHistory = (userA, userB) => {
    return data.messages
      .filter(m =>
        m.recipient &&
        ((m.sender === userA && m.recipient === userB) ||
         (m.sender === userB && m.recipient === userA))
      )
      .map(m => ({ ...m, type: 'private' }));
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

  const cleanupTemporaryRoom = (roomName) => {
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
    save();
    io.emit('room-deleted', { name: roomName });
    roomUsers.delete(roomName);
    return true;
  };

  io.on('connection', (socket) => {
    socket.on('register', (data_, callback) => {
      const { username, password, terms_version } = data_ || {};
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
      data.users.push({
        username: name,
        password: hashPassword(password),
        displayName: name,
        avatar: null,
        created_at: new Date().toISOString()
      });
      saveConsent(name, terms_version, new Date().toISOString(), socket.handshake.address);
      save();
      callback?.({ ok: true });
    });

    socket.on('get-all-users', (callback) => {
      callback?.(getAllUsers());
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

      const role = userRecord.role || 'user';
      users.set(socket.id, { username: name, currentRoom: null, displayName: userRecord.displayName || name, avatar: userRecord.avatar || null, location: userRecord.location || '', role });
      socket.username = name;
      socket.displayName = userRecord.displayName || name;
      socket.avatar = userRecord.avatar || null;
      socket.location = userRecord.location || '';
      io.emit('all-users', { users: getAllUsers() });
      callback?.({
        ok: true,
        rooms: getAllRooms(),
        displayName: userRecord.displayName || name,
        avatar: userRecord.avatar || null,
        location: userRecord.location || '',
        role
      });
    });

    socket.on('join-room', (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return;

      const roomName = typeof data_ === 'string' ? data_ : data_?.name;
      const password = typeof data_ === 'object' ? data_?.password : undefined;

      if (!roomName) return;

      const room = data.rooms.find(r => r.name === roomName);
      if (!room) return callback?.({ ok: false, error: 'La sala no existe' });

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
              users: getOnlineUsers(user.currentRoom),
              allUsers: getAllUsers()
            });
          }
          if (wasEmpty) {
            cleanupTemporaryRoom(user.currentRoom);
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
        users: getOnlineUsers(roomName),
        allUsers: getAllUsers()
      });

      if (roomUnreads[user.username]) {
        roomUnreads[user.username][roomName] = 0;
      }
      io.to(socket.id).emit('room-unread-update', { room: roomName, count: 0 });

      callback?.({
        ok: true,
        history: getRoomHistory(roomName),
        room: roomName,
        hasPassword: !!room.password,
        temporary: !!room.temporary
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
      save();

      io.to(user.currentRoom).emit('room-message', msg);

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
      save();

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

      save();

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
        save();
      }
      socket.displayName = displayName;
      io.emit('all-users', { users: getAllUsers() });
      io.emit('display-name-updated', { username: user.username, displayName });
      if (user.currentRoom) {
        io.to(user.currentRoom).emit('users-update', {
          room: user.currentRoom,
          users: getOnlineUsers(user.currentRoom),
          allUsers: getAllUsers()
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
        save();
      }
      socket.avatar = avatar;
      io.emit('all-users', { users: getAllUsers() });
      io.emit('avatar-updated', { username: user.username, avatar });
      if (user.currentRoom) {
        io.to(user.currentRoom).emit('users-update', {
          room: user.currentRoom,
          users: getOnlineUsers(user.currentRoom),
          allUsers: getAllUsers()
        });
      }
      callback?.({ ok: true, avatar });
    });

    socket.on('change-password', (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.({ ok: false, error: 'No autenticado' });

      const { currentPassword, newPassword } = data_ || {};
      if (!currentPassword) return callback?.({ ok: false, error: 'Contraseña actual requerida' });
      if (!newPassword || newPassword.length < 3) return callback?.({ ok: false, error: 'Mínimo 3 caracteres' });

      const record = data.users.find(u => u.username === user.username);
      if (!record) return callback?.({ ok: false, error: 'Usuario no encontrado' });
      if (record.password !== hashPassword(currentPassword)) return callback?.({ ok: false, error: 'Contraseña actual incorrecta' });

      record.password = hashPassword(newPassword);
      save();
      callback?.({ ok: true });
    });

    socket.on('create-room', (data_, callback) => {
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

      data.rooms.push({
        name,
        created_by: user.username,
        created_at: new Date().toISOString(),
        password: password ? hashPassword(password) : null,
        temporary
      });
      save();

      io.emit('room-created', {
        name,
        hasPassword: !!password,
        temporary
      });
      callback?.({ ok: true, name });
    });

    socket.on('get-rooms', (callback) => {
      callback?.(getAllRooms());
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
        created_at: u.created_at
      })));
    });

    socket.on('update-user', (data_, callback) => {
      const user = users.get(socket.id);
      if (!user || user.role !== 'admin') return callback?.({ ok: false, error: 'No autorizado' });

      const { username, displayName, role } = data_ || {};
      if (!username) return callback?.({ ok: false, error: 'Usuario requerido' });

      const target = data.users.find(u => u.username === username);
      if (!target) return callback?.({ ok: false, error: 'Usuario no encontrado' });

      if (displayName !== undefined) target.displayName = displayName;
      if (role !== undefined && (role === 'admin' || role === 'user')) target.role = role;
      save();

      io.emit('display-name-updated', { username, displayName: target.displayName || username });

      callback?.({ ok: true });
    });

    socket.on('delete-room', (data_, callback) => {
      const user = users.get(socket.id);
      if (!user || user.role !== 'admin') return callback?.({ ok: false, error: 'No autorizado' });

      const roomName = data_?.name;
      if (!roomName) return callback?.({ ok: false, error: 'Nombre requerido' });

      const idx = data.rooms.findIndex(r => r.name === roomName);
      if (idx === -1) return callback?.({ ok: false, error: 'Sala no existe' });
      if (roomName === 'general') return callback?.({ ok: false, error: 'No puedes eliminar la sala general' });

      data.rooms.splice(idx, 1);
      data.messages = data.messages.filter(m => m.room_name !== roomName);
      save();

      io.emit('room-deleted', { name: roomName });
      callback?.({ ok: true });
    });

    socket.on('admin-set-room-password', (data_, callback) => {
      const user = users.get(socket.id);
      if (!user || user.role !== 'admin') return callback?.({ ok: false, error: 'No autorizado' });

      const { name, password } = data_ || {};
      if (!name) return callback?.({ ok: false, error: 'Nombre requerido' });
      if (name === 'general') return callback?.({ ok: false, error: 'No puedes cambiar la contraseña de la sala general' });

      const room = data.rooms.find(r => r.name === name);
      if (!room) return callback?.({ ok: false, error: 'Sala no existe' });

      room.password = password ? hashPassword(password) : null;
      save();

      io.emit('room-password-changed', { name, hasPassword: !!room.password });
      callback?.({ ok: true });
    });

    socket.on('get-stats', (callback) => {
      const user = users.get(socket.id);
      if (!user || user.role !== 'admin') return;
      callback({
        totalUsers: data.users.length,
        connectedUsers: users.size,
        totalMessages: data.messages.length,
        totalRooms: data.rooms.length
      });
    });

    socket.on('admin-reset-password', (data_, callback) => {
      const user = users.get(socket.id);
      if (!user || user.role !== 'admin') return callback?.({ ok: false, error: 'No autorizado' });

      const { username, newPassword } = data_ || {};
      if (!username) return callback?.({ ok: false, error: 'Usuario requerido' });
      if (username === user.username) return callback?.({ ok: false, error: 'No puedes cambiar tu propia contraseña aquí' });
      if (!newPassword || newPassword.length < 3) return callback?.({ ok: false, error: 'Mínimo 3 caracteres' });

      const target = data.users.find(u => u.username === username);
      if (!target) return callback?.({ ok: false, error: 'Usuario no encontrado' });

      target.password = hashPassword(newPassword);
      save();
      callback?.({ ok: true });
    });

    socket.on('admin-delete-user', (data_, callback) => {
      const user = users.get(socket.id);
      if (!user || user.role !== 'admin') return callback?.({ ok: false, error: 'No autorizado' });

      const delUsername = data_?.username;
      if (!delUsername) return callback?.({ ok: false, error: 'Usuario requerido' });
      if (delUsername === user.username) return callback?.({ ok: false, error: 'No puedes eliminarte a ti mismo' });
      if (delUsername === 'admin') return callback?.({ ok: false, error: 'No puedes eliminar al usuario admin' });

      const idx = data.users.findIndex(u => u.username === delUsername);
      if (idx === -1) return callback?.({ ok: false, error: 'Usuario no encontrado' });

      data.users.splice(idx, 1);
      save();

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

      io.emit('all-users', { users: getAllUsers() });
      callback?.({ ok: true });
    });

    socket.on('panic-alert', () => {
      const user = users.get(socket.id);
      if (!user) return;

      socket.broadcast.emit('panic-alert', {
        username: user.username,
        displayName: user.displayName || user.username,
        location: user.location || '',
        timestamp: new Date().toISOString()
      });
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
        save();
      }
      callback?.({ ok: true, location });
    });

    socket.on('get-private-history', (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return;

      const other = data_?.with;
      if (!other) return;

      callback?.(getPrivateHistory(user.username, other));
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
              users: getOnlineUsers(roomName),
              allUsers: getAllUsers()
            });
          }
        }
      }

      if (user.username && roomUnreads[user.username]) {
        delete roomUnreads[user.username];
      }
      users.delete(socket.id);
      io.emit('all-users', { users: getAllUsers() });

      if (oldRoom) {
        cleanupTemporaryRoom(oldRoom);
      }
    });
  });
};
