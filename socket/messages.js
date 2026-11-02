// Piezas comunes de los mensajes (salas, privados y grupos): ids, citas, historial, reacciones.

module.exports = (ctx) => {
  const { db, HISTORY_PAGE_SIZE, findUser } = ctx;
  const { getMessage, getRoomMessages, getPrivateMessages, getGroupMessages, getLastPrivateMessages } = ctx.db;

  const SEND_ERROR = 'No se pudo enviar el mensaje. Intenta de nuevo.';

  // El id de un mensaje es su marca de tiempo (ms) y define el orden del historial: siempre crece, aunque
  // lleguen dos mensajes en el mismo milisegundo o el reloj del equipo retroceda.
  let lastMessageId = db.maxMessageId || 0;
  const nextMessageId = () => {
    lastMessageId = Math.max(Date.now(), Math.floor(lastMessageId) + 1);
    return lastMessageId;
  };

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

  // Solo se aceptan las reacciones que ofrece el selector del chat (misma lista que REACTION_EMOJIS en public/js/messages.js).
  const REACTION_EMOJIS = new Set(['👍', '👎', '❤️', '😄', '😮', '😢', '😡', '🎉', '🔥', '✅']);

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

  const getGroupHistory = async (groupId, beforeId) => {
    const page = await getGroupMessages(groupId, beforeId, HISTORY_PAGE_SIZE);
    return { messages: page.messages.map(m => ({ ...m, type: 'group' })), hasMore: page.hasMore };
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

  Object.assign(ctx, { SEND_ERROR, nextMessageId, buildReply, REACTION_EMOJIS, getRoomHistory, getPrivateHistory,
    getGroupHistory, getConversations, toggleReaction, withMessageLock });
};
