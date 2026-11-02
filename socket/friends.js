// Amigos: solicitudes, lista con estado en vivo y búsqueda de usuarios.
const { str } = require('./validation');

module.exports = (ctx) => {
  const { friendRowsOf, onlineSid, users, data, findUser, departmentOptions, userPublicInfo, io, emitToUsername } = ctx;
  const { updateFriendStatus, saveFriendRequest, deleteFriendRow } = ctx.db;

  // ===================== AMIGOS =====================

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

  Object.assign(ctx, { getAcceptedFriendUsernames, notifyFriendsOfStatusChange });

  return (socket) => {
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
  };
};
