// Mensajes privados, reacciones e historial anterior (de salas, grupos y privados).
const { canViewRoom } = require('./permissions');
const { sanitizeContent } = require('./validation');

module.exports = (ctx) => {
  const { findRoom, isGroupMember, users, findUser, buildReply, claimMessageFile, nextMessageId, returnUpload,
    SEND_ERROR, emitToUsername, REACTION_EMOJIS, withMessageLock, toggleReaction, io, lastGroupMessages,
    groupMemberUsernames, getConversations, getPrivateHistory, getGroupHistory, getRoomHistory } = ctx;
  const { saveMessage, getMessage, updateMessageReactions } = ctx.db;

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

  return (socket) => {
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

    socket.on('get-conversations', async (callback) => {
      const user = users.get(socket.id);
      if (!user) return;
      callback?.(await getConversations(user.username));
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
  };
};
