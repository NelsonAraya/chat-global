// Panel de administración: cuentas, solicitudes de registro, salas, departamentos y estadísticas.
const { str, normalizeEmail, emailError } = require('./validation');
const { isSuperAdmin, canManageUser, adminDeptsOf, canManageUserFully, FULL_SCOPE_ERROR, adminScope, inAdminScope } = require('./permissions');

module.exports = (ctx) => {
  const { kickUser, notifyFriendsOfStatusChange, users, data, findUser, emailInUse, loginCodes, onlineSid,
    visibilityRoomsFor, presenceRooms, io, movePresence, getAllUsers, leaveRoomIfNoAccess, departmentOptions,
    getAllRooms, findRoom, deleteUploadedFile, emitToViewersOfRoom, emptyRoom, clearFailures,
    getAcceptedFriendUsernames, emitToUsername, groupRowsOfUser, findGroup, removeGroupMembership, broadcastGroup,
    MIN_PASSWORD_LENGTH, PASSWORD_LENGTH_ERROR } = ctx;
  const { deleteUserSessions, saveUserFields, getRoomFileUrls, deleteRoom, deleteMessagesByRoom, hashPassword,
    saveRoom, countMessages, deleteUser, saveDepartment, deleteDepartment } = ctx.db;

  // Cierra todas las sesiones guardadas de un usuario (y su conexión activa, si se indica un motivo).
  const revokeUserSessions = async (username, kickReason) => {
    await deleteUserSessions(username);
    if (kickReason && kickUser(username, kickReason)) {
      notifyFriendsOfStatusChange(username);
    }
  };

  return (socket) => {
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
      if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) return callback?.({ ok: false, error: PASSWORD_LENGTH_ERROR });

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
  };
};
