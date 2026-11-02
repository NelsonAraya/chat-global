// Mensajes: dibujarlos, historial anterior, reacciones, respuestas, enviar y chat privado.

function updateRoomTotalBadge() {
  var total = 0;
  for (var k in roomUnreadCounts) {
    if (roomUnreadCounts.hasOwnProperty(k)) total += roomUnreadCounts[k];
  }
  if (total > 0) {
    roomTotalBadge.textContent = total;
    roomTotalBadge.classList.remove('hidden');
  } else {
    roomTotalBadge.classList.add('hidden');
  }
  updateTitle();
}

var historyOldestId = null;
var historyHasMore = false;
var loadingMoreHistory = false;

function renderMessages(messages, hasMore) {
  messagesList.innerHTML = '';
  historyOldestId = messages.length > 0 ? messages[0].id : null;
  historyHasMore = !!hasMore;
  loadingMoreHistory = false;
  messagesStart.classList.toggle('hidden', messages.length > 0);
  if (messages.length === 0) return;

  var lastDate = null;
  messages.forEach(function(m) {
    renderMessage(m, false, lastDate);
    lastDate = m.created_at ? new Date(m.created_at).toDateString() : null;
  });
  updateHistoryTopIndicator();
  scrollToBottom();
}

function loadMoreHistory() {
  if (loadingMoreHistory || !historyHasMore || historyOldestId === null) return;
  if (!currentRoom && !privateRecipient && !currentGroup) return;

  loadingMoreHistory = true;
  showHistoryLoadingIndicator(true);

  var payload = { beforeId: historyOldestId };
  if (privateRecipient) {
    payload.with = privateRecipient;
  } else if (currentGroup) {
    payload.group = currentGroup;
  } else {
    payload.room = currentRoom;
  }

  socket.emit('get-more-messages', payload, function(res) {
    loadingMoreHistory = false;
    showHistoryLoadingIndicator(false);
    if (!res || !res.messages) return;
    historyHasMore = !!res.hasMore;
    if (res.messages.length > 0) {
      historyOldestId = res.messages[0].id;
      prependMessages(res.messages);
    }
    updateHistoryTopIndicator();
  });
}

function prependMessages(olderMessages) {
  if (!olderMessages || olderMessages.length === 0) return;
  var prevScrollHeight = messagesContainer.scrollHeight;
  var prevScrollTop = messagesContainer.scrollTop;

  var oldFirstMsgEl = messagesList.querySelector('.message');
  var oldFirstDate = oldFirstMsgEl ? oldFirstMsgEl.dataset.messageDate : null;
  var oldLeadingDivider = messagesList.firstChild && messagesList.firstChild.classList && messagesList.firstChild.classList.contains('message-divider')
    ? messagesList.firstChild : null;

  var frag = document.createDocumentFragment();
  var lastDate = null;
  olderMessages.forEach(function(m) {
    var msgDate = m.created_at ? new Date(m.created_at).toDateString() : null;
    if (lastDate !== msgDate && msgDate) {
      frag.appendChild(buildDateDivider(m));
    }
    frag.appendChild(buildMessageElement(m, false));
    lastDate = msgDate;
  });

  if (oldLeadingDivider && lastDate && oldFirstDate === lastDate) {
    oldLeadingDivider.remove();
  }

  messagesList.insertBefore(frag, messagesList.firstChild);
  messagesContainer.scrollTop = prevScrollTop + (messagesContainer.scrollHeight - prevScrollHeight);
}

function updateHistoryTopIndicator() {
  var existing = $('history-top-msg');
  if (existing) existing.remove();
  if (historyHasMore || messagesList.children.length === 0) return;
  var marker = document.createElement('div');
  marker.id = 'history-top-msg';
  marker.className = 'history-top-indicator';
  marker.textContent = 'Inicio de la conversación';
  messagesList.insertBefore(marker, messagesList.firstChild);
}

function showHistoryLoadingIndicator(show) {
  var el = $('history-loading-indicator');
  if (show) {
    if (!el) {
      el = document.createElement('div');
      el.id = 'history-loading-indicator';
      el.className = 'history-loading-indicator';
      el.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cargando mensajes anteriores...';
      messagesList.insertBefore(el, messagesList.firstChild);
    }
  } else if (el) {
    el.remove();
  }
}

messagesContainer.addEventListener('scroll', function() {
  if (messagesContainer.scrollTop < 80) {
    loadMoreHistory();
  }
});

var REACTION_EMOJIS = ['👍', '👎', '❤️', '😄', '😮', '😢', '😡', '🎉', '🔥', '✅'];

function sendReaction(messageId, emoji) {
  socket.emit('add-reaction', { messageId: messageId, emoji: emoji });
}

function createReactionButton(emoji, usersList, messageId) {
  var btn = document.createElement('button');
  btn.className = 'msg-reaction' + (usersList.indexOf(currentUser) !== -1 ? ' active' : '');
  btn.textContent = emoji + ' ' + usersList.length;
  btn.title = usersList.join(', ');
  btn.addEventListener('click', function(e) {
    e.stopPropagation();
    sendReaction(messageId, emoji);
  });
  return btn;
}

var reactionPicker = null;

function showReactionPicker(anchorEl, messageId) {
  hideReactionPicker();
  reactionPicker = document.createElement('div');
  reactionPicker.className = 'reaction-picker';
  REACTION_EMOJIS.forEach(function(emoji) {
    var btn = document.createElement('button');
    btn.textContent = emoji;
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      sendReaction(messageId, emoji);
      hideReactionPicker();
    });
    reactionPicker.appendChild(btn);
  });
  document.body.appendChild(reactionPicker);

  var rect = anchorEl.getBoundingClientRect();
  var top = rect.top - reactionPicker.offsetHeight - 4;
  var left = rect.left;
  if (top < 0) top = rect.bottom + 4;
  reactionPicker.style.top = top + 'px';
  reactionPicker.style.left = left + 'px';

  setTimeout(function() {
    document.addEventListener('click', hideReactionPicker, { once: true });
  }, 0);
}

function hideReactionPicker() {
  if (reactionPicker) {
    reactionPicker.remove();
    reactionPicker = null;
  }
}

function updateReactionsBar(el, reactions, messageId) {
  var bar = el.querySelector('.msg-reactions');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'msg-reactions';
    el.appendChild(bar);
  }
  bar.innerHTML = '';
  if (reactions) {
    var entries = Object.entries(reactions).sort(function(a, b) {
      return b[1].length - a[1].length;
    });
    entries.forEach(function(entry) {
      var emoji = entry[0];
      var usersList = entry[1];
      bar.appendChild(createReactionButton(emoji, usersList, messageId));
    });
  }
  var addBtn = document.createElement('button');
  addBtn.className = 'msg-add-reaction';
  addBtn.innerHTML = '<i class="fas fa-plus"></i>';
  addBtn.title = 'Agregar reaccion';
  addBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    showReactionPicker(addBtn, messageId);
  });
  bar.appendChild(addBtn);
}

function buildDateDivider(msg) {
  var divider = document.createElement('div');
  divider.className = 'message-divider';
  divider.textContent = new Date(msg.created_at).toLocaleDateString('es-CL', {
    weekday: 'long', day: 'numeric', month: 'long'
  });
  return divider;
}

function buildMessageElement(msg, animate) {
  if (animate === undefined) animate = true;
  var isPrivate = msg.type === 'private';
  var isSelf = msg.sender === currentUser;
  var msgDate = msg.created_at ? new Date(msg.created_at).toDateString() : null;

  var el = document.createElement('div');
  el.className = 'message ' + (isSelf ? 'self' : 'other') + (isPrivate ? ' private' : '');
  if (!animate) el.style.animation = 'none';
  if (msg.id) el.dataset.messageId = msg.id;
  if (msgDate) el.dataset.messageDate = msgDate;

  var senderName = msg.displayName || msg.sender;
  var senderHtml = '';
  if (!isSelf && !isPrivate) {
    senderHtml = '<div class="msg-sender">' +
      getAvatarHtml(msg.sender, msg.avatar, 24) +
      '<span>' + escapeHtml(senderName) + '</span></div>';
  } else if (isPrivate) {
    senderHtml = '<div class="msg-sender">' +
      getAvatarHtml(msg.sender, msg.avatar, 24) +
      '<span><i class="fas fa-lock"></i> ' + escapeHtml(senderName) + '</span></div>';
  }

  var fileHtml = '';
  var fileUrl = msg.file ? safeUploadUrl(msg.file.url) : null;
  if (fileUrl) {
    var fileType = String(msg.file.type || '');
    if (fileType.startsWith('image/')) {
      fileHtml = '<div class="msg-file"><img src="' + escapeHtml(fileUrl) + '" alt="' + escapeHtml(msg.file.name) + '" class="msg-image" loading="lazy" /></div>';
    } else if (fileType.startsWith('audio/')) {
      fileHtml = '<div class="msg-file msg-audio"><audio src="' + escapeHtml(fileUrl) + '" controls preload="metadata"></audio></div>';
    } else {
      fileHtml = '<div class="msg-file"><i class="fas fa-file"></i> <a href="' + escapeHtml(fileUrl) + '" target="_blank" download>' + escapeHtml(msg.file.name) + '</a> <span class="msg-file-size">' + formatFileSize(Number(msg.file.size) || 0) + '</span></div>';
    }
  }

  var replyHtml = '';
  if (msg.reply) {
    var replyIdNum = Number(msg.reply.id);
    var replyId = Number.isFinite(replyIdNum) && replyIdNum ? ' data-reply-id="' + replyIdNum + '"' : '';
    replyHtml = '<div class="msg-reply-block"' + replyId + '><div class="msg-reply-sender">' + escapeHtml(msg.reply.sender) + '</div><div class="msg-reply-text">' + escapeHtml(msg.reply.content) + '</div></div>';
  }

  var contentHtml = msg.content ? '<div class="msg-text">' + escapeHtml(msg.content) + '</div>' : '';

  el.innerHTML = senderHtml + replyHtml + contentHtml + fileHtml +
    '<div class="msg-time">' + formatTime(msg.created_at) + '</div>';

  var replyBtn = document.createElement('button');
  replyBtn.className = 'msg-reply-btn';
  replyBtn.innerHTML = '<i class="fas fa-reply"></i>';
  replyBtn.title = 'Responder';
  replyBtn.addEventListener('click', function() {
    var replyContent = msg.content || (msg.file ? '[Archivo]' : '');
    replyingTo = {
      sender: msg.sender,
      content: replyContent,
      id: msg.id
    };
    replyTargetName.textContent = msg.sender;
    replyTargetPreview.textContent = replyContent;
    replyIndicator.classList.remove('hidden');
    messageInput.focus();
  });
  el.appendChild(replyBtn);

  updateReactionsBar(el, msg.reactions, msg.id);

  return el;
}

function renderMessage(msg, animate, lastDate) {
  var msgDate = msg.created_at ? new Date(msg.created_at).toDateString() : null;
  if (lastDate === undefined) {
    // Mensaje en vivo: la fecha anterior es la del último mensaje en pantalla (si no, cada uno llevaba separador).
    var lastEl = domMessages[domMessages.length - 1];
    lastDate = lastEl ? lastEl.dataset.messageDate : null;
  }
  if (lastDate !== msgDate && msgDate) {
    messagesList.appendChild(buildDateDivider(msg));
  }
  messagesList.appendChild(buildMessageElement(msg, animate));
  if (animate !== false) trimOldMessages(); // mensaje nuevo en vivo
  scrollToBottom();
}

// Una sala activa abierta todo el día juntaba miles de mensajes en pantalla y el navegador se ponía lento:
// se dejan los últimos MAX_DOM_MESSAGES y los anteriores se vuelven a cargar al subir (como el historial).
var MAX_DOM_MESSAGES = 300;
var domMessages = messagesList.getElementsByClassName('message'); // lista viva

function trimOldMessages() {
  var extra = domMessages.length - MAX_DOM_MESSAGES;
  if (extra <= 0) return;
  var removed = 0;
  while (messagesList.firstChild && removed < extra) {
    var node = messagesList.firstChild;
    if (node.classList && node.classList.contains('message')) removed++;
    node.remove();
  }
  // Lo que quedó antes del primer mensaje (separadores o avisos) se quita; el primer mensaje lleva su fecha.
  while (messagesList.firstChild && !(messagesList.firstChild.classList && messagesList.firstChild.classList.contains('message'))) {
    messagesList.firstChild.remove();
  }
  var first = messagesList.firstChild;
  if (!first) return;
  if (first.dataset.messageDate) messagesList.insertBefore(buildDateDivider({ created_at: first.dataset.messageDate }), first);
  historyOldestId = first.dataset.messageId || historyOldestId;
  historyHasMore = true;
}

// Navigate to replied message on click
messagesList.addEventListener('click', function(e) {
  if (e.target.classList.contains('msg-image')) {
    openImageModal(e.target.getAttribute('src'));
    return;
  }
  var block = e.target.closest('.msg-reply-block');
  if (block) {
    var replyId = parseFloat(block.dataset.replyId);
    if (replyId) {
      var target = messagesList.querySelector('[data-message-id="' + replyId + '"]');
      if (target) {
        target.style.animation = '';
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('msg-highlight');
        setTimeout(function() { target.classList.remove('msg-highlight'); }, 1500);
      } else {
        showToast('El mensaje original no está cargado, sube para verlo');
      }
    }
  }
});

function scrollToBottom() {
  var container = $('messages-container');
  requestAnimationFrame(function() {
    container.scrollTop = container.scrollHeight;
  });
}

function sendMessage() {
  var content = messageInput.value.trim();
  if (!content && !pendingFile) return;

  var payload = { content: content };
  if (pendingFile) {
    payload.file = pendingFile;
  }
  if (replyingTo) {
    payload.reply = replyingTo;
  }

  // Si el servidor no pudo guardar el mensaje, avisa y devuelve el texto al cuadro para no perderlo.
  var onSent = function(res) {
    if (res && res.ok === false) {
      showToast(res.error || 'No se pudo enviar el mensaje');
      if (content && !messageInput.value) messageInput.value = content;
    }
  };

  if (privateRecipient) {
    payload.recipient = privateRecipient;
    socket.emit('private-message', payload, onSent);
  } else if (currentGroup) {
    payload.groupId = currentGroup;
    socket.emit('group-message', payload, onSent);
  } else if (currentRoom) {
    socket.emit('room-message', payload, onSent);
  }

  messageInput.value = '';
  pendingFile = null;
  filePreview.classList.add('hidden');
  fileInput.value = '';
  cancelReply();
  messageInput.focus();
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

function openPrivateChat(username) {
  if (username === currentUser) return;
  exitGroupMode();
  privateRecipient = username;

  unreadCounts[username] = 0;
  updateConvTotalBadge();
  renderConversations();

  contextName.textContent = username;
  contextIcon.className = 'fas fa-lock';
  contextBadge.classList.remove('hidden');
  contextGlobalBadge.classList.add('hidden');
  backToRoomBtn.classList.remove('hidden');

  privateIndicator.classList.remove('hidden');
  privateRecipientName.textContent = username;

  messageInput.placeholder = 'Escribe a @' + username + '...';
  messageInput.focus();

  loadPrivateHistory(username);
  onActionCloseDrawers();
}

function cancelPrivate() {
  privateRecipient = null;
  exitGroupMode();
  privateIndicator.classList.add('hidden');
  cancelReply();

  if (currentRoom) {
    contextName.textContent = currentRoom;
    var curRoomData = rooms.find(function(r) { return r.name === currentRoom; });
    if (curRoomData && curRoomData.hasPassword) contextIcon.className = 'fas fa-lock';
    else if (curRoomData && curRoomData.temporary) contextIcon.className = 'far fa-clock';
    else contextIcon.className = 'fas fa-hashtag';
    contextBadge.classList.add('hidden');
    contextGlobalBadge.classList.toggle('hidden', !!(curRoomData && curRoomData.department));
    backToRoomBtn.classList.add('hidden');
    messageInput.placeholder = 'Escribe en #' + currentRoom + '...';

    socket.emit('join-room', { name: currentRoom }, function(res) {
      if (res?.ok) {
        roomUnreadCounts[currentRoom] = 0;
        renderRooms();
        updateRoomTotalBadge();
        renderUsers(res.users || []);
        renderMessages(res.history, res.hasMoreHistory);
      }
    });
  }
  renderConversations();
}

backToRoomBtn.addEventListener('click', cancelPrivate);
cancelPrivateBtn.addEventListener('click', cancelPrivate);
cancelReplyBtn.addEventListener('click', cancelReply);

function cancelReply() {
  replyingTo = null;
  replyIndicator.classList.add('hidden');
}

function loadPrivateHistory(username) {
  socket.emit('get-private-history', { with: username }, function(res) {
    renderMessages(res.history, res.hasMoreHistory);
  });
}
