// Conversaciones privadas (lista) y amigos.

function renderConversations() {
  if (!conversations || conversations.length === 0) {
    conversationsList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px;">Sin conversaciones aun</div>';
    return;
  }

  conversationsList.innerHTML = conversations.map(function(c) {
    var unread = unreadCounts[c.with] || 0;
    var isActive = privateRecipient === c.with;
    var badgeHtml = unread > 0 ? '<span class="conv-badge">' + unread + '</span>' : '';
    var timeHtml = '<span class="conv-time">' + formatDate(c.lastMessage.created_at) + '</span>';
    var lastContent = c.lastMessage.content || (c.lastMessage.file ? '[Archivo]' : '');
    var preview = c.lastMessage.sender === currentUser ? 'Tu: ' + lastContent : lastContent;
    if (preview.length > 40) preview = preview.substring(0, 40) + '...';

    var convDisplay = c.displayName || c.with;
    var convAvatar = c.avatar || null;
    return '<div class="conv-item' + (isActive ? ' active' : '') + (unread > 0 ? ' unread' : '') + '" data-user="' + escapeHtml(c.with) + '">' +
      getAvatarHtml(c.with, convAvatar, 36) +
      '<div class="conv-info">' +
        '<div class="conv-name">' + escapeHtml(convDisplay) + badgeHtml + '</div>' +
        '<div class="conv-preview">' + escapeHtml(preview) + '</div>' +
      '</div>' +
      '<div class="conv-meta">' + timeHtml + '</div>' +
    '</div>';
  }).join('');
}

conversationsList.addEventListener('click', function(e) {
  var el = e.target.closest('.conv-item');
  if (!el) return;
  cancelPrivate();
  openPrivateChat(el.dataset.user);
  if (sidebarTab !== 'conversations') {
    document.querySelectorAll('.sidebar-tab').forEach(function(t) { t.classList.remove('active'); });
    document.querySelector('[data-panel="conversations"]').classList.add('active');
    sidebarTab = 'conversations';
    document.querySelectorAll('.sidebar-panel').forEach(function(p) { p.classList.add('hidden'); });
    $('conversations-panel').classList.remove('hidden');
  }
});

// Un mensaje privado (recibido o enviado) actualiza la lista de conversaciones aquí mismo: antes cada uno
// volvía a pedir la lista completa al servidor (una consulta a la base por mensaje).
function noteConversationMessage(msg) {
  if (!msg || !msg.recipient) return;
  var other = msg.sender === currentUser ? msg.recipient : msg.sender;
  var idx = conversations.findIndex(function(c) { return c.with === other; });
  var conv = idx !== -1 ? conversations.splice(idx, 1)[0] : null;
  if (!conv) {
    var known = allOnlineUsers.concat(friends).find(function(u) { return u && u.username === other; });
    conv = { with: other, displayName: (known && known.displayName) || other, avatar: (known && known.avatar) || null };
  }
  if (msg.sender === other) {
    conv.displayName = msg.displayName || conv.displayName;
    conv.avatar = msg.avatar || null;
  }
  conv.lastMessage = { content: msg.content, created_at: msg.created_at, sender: msg.sender, file: msg.file || null };
  conversations.unshift(conv);
  renderConversations();
}

function updateConvTotalBadge() {
  unreadTotal = 0;
  for (var k in unreadCounts) {
    if (unreadCounts.hasOwnProperty(k)) unreadTotal += unreadCounts[k];
  }
  if (unreadTotal > 0) {
    convTotalBadge.textContent = unreadTotal;
    convTotalBadge.classList.remove('hidden');
  } else {
    convTotalBadge.classList.add('hidden');
  }
  updateTitle();
}

function updateFriendsTotalBadge() {
  var count = friendRequestsIncoming.length;
  if (count > 0) {
    friendsTotalBadge.textContent = count;
    friendsTotalBadge.classList.remove('hidden');
  } else {
    friendsTotalBadge.classList.add('hidden');
  }
}

function loadFriends() {
  socket.emit('get-friends', function(list) {
    friends = list || [];
    renderFriends();
  });
}

function loadFriendRequests() {
  socket.emit('get-pending-friend-requests', function(res) {
    friendRequestsIncoming = (res && res.incoming) || [];
    renderFriendRequests();
    updateFriendsTotalBadge();
  });
}

function friendStatusLabel(f) {
  if (!f.online) return 'Desconectado';
  return f.departmentDisplayName ? f.departmentDisplayName : 'Conectado';
}

function renderFriends() {
  if (!friends || friends.length === 0) {
    friendsList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px;">Aún no tienes amigos agregados</div>';
    return;
  }
  var sorted = friends.slice().sort(function(a, b) {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return (a.displayName || a.username).localeCompare(b.displayName || b.username);
  });
  friendsList.innerHTML = sorted.map(function(f) {
    return '<div class="friend-item" data-user="' + escapeHtml(f.username) + '">' +
      '<div class="friend-avatar-wrap">' +
        getAvatarHtml(f.username, f.avatar, 36) +
        '<span class="friend-status-dot' + (f.online ? ' online' : '') + '"></span>' +
      '</div>' +
      '<div class="friend-info">' +
        '<div class="friend-name">' + escapeHtml(f.displayName || f.username) + '</div>' +
        '<div class="friend-status-text' + (f.online ? ' online' : '') + '">' + escapeHtml(friendStatusLabel(f)) + '</div>' +
      '</div>' +
      '<button class="friend-remove-btn btn-icon" title="Quitar amigo"><i class="fas fa-user-minus"></i></button>' +
    '</div>';
  }).join('');

  friendsList.querySelectorAll('.friend-item').forEach(function(el) {
    el.addEventListener('click', function(e) {
      if (e.target.closest('.friend-remove-btn')) return;
      var username = el.dataset.user;
      cancelPrivate();
      openPrivateChat(username);
      document.querySelectorAll('.sidebar-tab').forEach(function(t) { t.classList.remove('active'); });
      document.querySelector('[data-panel="conversations"]').classList.add('active');
      sidebarTab = 'conversations';
      document.querySelectorAll('.sidebar-panel').forEach(function(p) { p.classList.add('hidden'); });
      $('conversations-panel').classList.remove('hidden');
    });
    var removeBtn = el.querySelector('.friend-remove-btn');
    removeBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var username = el.dataset.user;
      if (!confirm('¿Quitar a ' + username + ' de tus amigos?')) return;
      socket.emit('remove-friend', { username: username }, function(res) {
        if (!res.ok) { showToast(res.error); return; }
        friends = friends.filter(function(f) { return f.username !== username; });
        renderFriends();
        showToast('Amigo eliminado');
      });
    });
  });
}

function renderFriendRequests() {
  if (!friendRequestsIncoming || friendRequestsIncoming.length === 0) {
    friendRequestsSection.classList.add('hidden');
    return;
  }
  friendRequestsSection.classList.remove('hidden');
  friendRequestsList.innerHTML = friendRequestsIncoming.map(function(r) {
    return '<div class="friend-request-item" data-id="' + r.id + '" data-user="' + escapeHtml(r.username) + '">' +
      getAvatarHtml(r.username, r.avatar, 32) +
      '<div class="friend-info">' +
        '<div class="friend-name">' + escapeHtml(r.displayName || r.username) + '</div>' +
      '</div>' +
      '<div class="friend-request-actions">' +
        '<button class="friend-request-accept" title="Aceptar"><i class="fas fa-check"></i></button>' +
        '<button class="friend-request-reject" title="Rechazar"><i class="fas fa-times"></i></button>' +
      '</div>' +
    '</div>';
  }).join('');

  friendRequestsList.querySelectorAll('.friend-request-accept').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var item = btn.closest('.friend-request-item');
      var id = parseInt(item.dataset.id, 10);
      socket.emit('respond-friend-request', { requestId: id, accept: true }, function(res) {
        if (!res.ok) { showToast(res.error); return; }
        friendRequestsIncoming = friendRequestsIncoming.filter(function(r) { return r.id !== id; });
        renderFriendRequests();
        updateFriendsTotalBadge();
        loadFriends();
        showToast('Ahora son amigos');
      });
    });
  });
  friendRequestsList.querySelectorAll('.friend-request-reject').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var item = btn.closest('.friend-request-item');
      var id = parseInt(item.dataset.id, 10);
      socket.emit('respond-friend-request', { requestId: id, accept: false }, function(res) {
        if (!res.ok) { showToast(res.error); return; }
        friendRequestsIncoming = friendRequestsIncoming.filter(function(r) { return r.id !== id; });
        renderFriendRequests();
        updateFriendsTotalBadge();
      });
    });
  });
}

var addFriendSearchTimer = null;

addFriendBtn.addEventListener('click', function() {
  addFriendSearch.value = '';
  addFriendResults.innerHTML = '';
  addFriendError.textContent = '';
  addFriendModalOverlay.classList.remove('hidden');
  addFriendSearch.focus();
});

function closeAddFriendModal() {
  addFriendModalOverlay.classList.add('hidden');
}
addFriendModalClose.addEventListener('click', closeAddFriendModal);
addFriendModalOverlay.addEventListener('click', function(e) {
  if (e.target === addFriendModalOverlay) closeAddFriendModal();
});

addFriendSearch.addEventListener('input', function() {
  clearTimeout(addFriendSearchTimer);
  var query = this.value.trim();
  addFriendError.textContent = '';
  if (query.length < 2) {
    addFriendResults.innerHTML = '';
    return;
  }
  addFriendSearchTimer = setTimeout(function() {
    socket.emit('search-users', { query: query }, function(results) {
      renderAddFriendResults(results || []);
    });
  }, 300);
});

function addFriendActionLabel(status) {
  if (status === 'friends') return 'Ya son amigos';
  if (status === 'pending_sent') return 'Pendiente';
  if (status === 'pending_received') return 'Te escribió';
  return 'Agregar';
}

function renderAddFriendResults(results) {
  if (results.length === 0) {
    addFriendResults.innerHTML = '<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:13px;">Sin resultados</div>';
    return;
  }
  addFriendResults.innerHTML = results.map(function(r) {
    var disabled = r.friendStatus !== 'none' ? ' disabled' : '';
    return '<div class="add-friend-result-item" data-user="' + escapeHtml(r.username) + '">' +
      getAvatarHtml(r.username, r.avatar, 32) +
      '<div class="friend-info">' +
        '<div class="friend-name">' + escapeHtml(r.displayName || r.username) + '</div>' +
        '<div class="friend-username">@' + escapeHtml(r.username) + '</div>' +
      '</div>' +
      '<button class="add-friend-action-btn" data-status="' + r.friendStatus + '"' + disabled + '>' + addFriendActionLabel(r.friendStatus) + '</button>' +
    '</div>';
  }).join('');

  addFriendResults.querySelectorAll('.add-friend-action-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      if (btn.disabled) return;
      var item = btn.closest('.add-friend-result-item');
      var username = item.dataset.user;
      btn.disabled = true;
      btn.textContent = 'Enviando...';
      socket.emit('send-friend-request', { username: username }, function(res) {
        if (!res.ok) {
          btn.disabled = false;
          btn.textContent = 'Agregar';
          addFriendError.textContent = res.error;
          return;
        }
        if (res.autoAccepted) {
          btn.textContent = 'Ya son amigos';
          loadFriends();
          showToast('Ahora son amigos');
        } else {
          btn.textContent = 'Pendiente';
          showToast('Solicitud enviada');
        }
      });
    });
  });
}

socket.on('friend-request-received', function(data) {
  friendRequestsIncoming.push(data);
  renderFriendRequests();
  updateFriendsTotalBadge();
  playNotification();
  showToast((data.displayName || data.username) + ' te envió una solicitud de amistad');
});

socket.on('friend-request-accepted', function(data) {
  showToast((data.displayName || data.username) + ' aceptó tu solicitud de amistad');
  loadFriends();
});

socket.on('friend-request-rejected', function() {
  loadFriendRequests();
});

socket.on('friend-status-update', function(data) {
  var f = friends.find(function(x) { return x.username === data.username; });
  if (f) {
    f.online = data.online;
    f.department = data.department;
    f.departmentDisplayName = data.departmentDisplayName;
    f.departments = data.departments;
    renderFriends();
  }
});

socket.on('friend-removed', function(data) {
  friends = friends.filter(function(f) { return f.username !== data.username; });
  renderFriends();
  showToast(data.username + ' te eliminó de sus amigos');
});
