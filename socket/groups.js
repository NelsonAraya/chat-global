// Grupos: conversaciones privadas entre varios usuarios (invitaciones, roles, mensajes).
const { sanitizeContent } = require('./validation');

module.exports = (ctx) => {
  const { lazyIndex, data, userCard, isOnline, emitToUsername, deleteUploadedFile, findUser, users, buildReply,
    claimMessageFile, nextMessageId, returnUpload, SEND_ERROR, getGroupHistory } = ctx;
  const { getLastGroupMessages, getGroupFileUrls, deleteGroup, deleteGroupMember, saveGroupMember, saveGroup,
    renameGroup, saveMessage } = ctx.db;

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

  Object.assign(ctx, { groupRowsOfUser, findGroup, isGroupMember, groupMemberUsernames, lastGroupMessages,
    broadcastGroup, removeGroupMembership });

  return (socket) => {
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
  };
};
