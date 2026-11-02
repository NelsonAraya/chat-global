// Listas de conectados (en la sala y en total) y presencia en vivo.

function renderUserItem(u, isCurrent) {
  if (!u) return '';
  var username = typeof u === 'string' ? u : u.username;
  var display = typeof u === 'string' ? u : (u.displayName || u.username);
  var avatar = typeof u === 'string' ? null : (u.avatar || null);

  var avatarHtml = getAvatarHtml(username, avatar, 28);
  var nameHtml = isCurrent
    ? '<strong>' + escapeHtml(display) + '</strong> <span style="font-size:11px;color:var(--text-muted)">(tu)</span>'
    : escapeHtml(display);

  var pmHtml = isCurrent ? '' : '<i class="fas fa-envelope pm-icon" title="Mensaje privado"></i>';

  return '<div class="user-item"' + (isCurrent ? '' : ' data-user="' + escapeHtml(username) + '"') + '>' +
    avatarHtml +
    '<span class="user-name">' + nameHtml + '</span>' +
    pmHtml + '</div>';
}

function renderUsers(users) {
  if (!users || !Array.isArray(users)) return;
  if (!currentUser) return;
  lastRoomUsers = users;
  if (currentGroup) return; // mientras hay un grupo abierto, la lista muestra a sus miembros
  if (roomUsersHidden) {
    roomUsersList.innerHTML = '<div class="room-users-hidden-note">En los canales globales no se muestra quién está conectado.</div>';
    return;
  }

  var currentObj = { username: currentUser, displayName: currentDisplayName || currentUser, avatar: currentAvatar };
  var currentEl = renderUserItem(currentObj, true);
  var otherUsers = users.filter(function(u) {
    var uname = typeof u === 'string' ? u : u.username;
    return uname !== currentUser;
  }).map(function(u) {
    return renderUserItem(u, false);
  }).join('');

  roomUsersList.innerHTML = currentEl + otherUsers;
}

function renderAllUsers(users) {
  if (!users || !Array.isArray(users)) return;
  if (!currentUser) return;
  allOnlineUsers = users;

  var currentObj = { username: currentUser, displayName: currentDisplayName || currentUser, avatar: currentAvatar };
  var currentEl = renderUserItem(currentObj, true);
  var otherUsers = users.filter(function(u) {
    var uname = typeof u === 'string' ? u : u.username;
    return uname !== currentUser;
  }).map(function(u) {
    return renderUserItem(u, false);
  }).join('');

  allUsersList.innerHTML = currentEl + otherUsers;
}

// Clic en una persona (o en su sobre) de las listas de conectados: abre el privado. Un solo manejador por
// lista: las listas se redibujan con cada entrada y salida.
[roomUsersList, allUsersList].forEach(function(list) {
  list.addEventListener('click', function(e) {
    var el = e.target.closest('.user-item[data-user]');
    if (el) openPrivateChat(el.dataset.user);
  });
});

// ===== Presencia: el servidor avisa solo los cambios y aquí se aplican a las listas que ya se tienen =====
// Varias llegadas seguidas (p. ej. a las 8:00, cuando entra todo el mundo) se dibujan juntas.
var presenceRenderTimer = null;
function schedulePresenceRender() {
  if (presenceRenderTimer) return;
  presenceRenderTimer = setTimeout(function() {
    presenceRenderTimer = null;
    renderAllUsers(allOnlineUsers);
    renderUsers(lastRoomUsers);
  }, 200);
}

function withoutUser(list, username) {
  return list.filter(function(u) { return (typeof u === 'string' ? u : u.username) !== username; });
}

socket.on('user-online', function(u) {
  if (!u || !u.username) return;
  allOnlineUsers = withoutUser(allOnlineUsers, u.username).concat([u]);
  schedulePresenceRender();
});

socket.on('user-offline', function(data) {
  if (!data || !data.username) return;
  allOnlineUsers = withoutUser(allOnlineUsers, data.username);
  schedulePresenceRender();
});

socket.on('room-user-joined', function(data) {
  if (!data || data.room !== currentRoom || !data.user) return;
  lastRoomUsers = withoutUser(lastRoomUsers, data.user.username).concat([data.user]);
  schedulePresenceRender();
});

socket.on('room-user-left', function(data) {
  if (!data || data.room !== currentRoom) return;
  lastRoomUsers = withoutUser(lastRoomUsers, data.username);
  schedulePresenceRender();
});

// Alguien cambió su nombre o su foto: se actualiza en pantalla sin volver a pedir datos al servidor.
socket.on('user-updated', function(u) {
  if (!u || !u.username) return;
  if (u.username === currentUser) {
    currentDisplayName = u.displayName;
    displayName.textContent = u.displayName;
    currentAvatar = u.avatar || null;
    updateHeaderAvatar();
  }
  var patch = function(list) {
    return list.map(function(x) {
      return x && x.username === u.username ? Object.assign({}, x, { displayName: u.displayName, avatar: u.avatar || null }) : x;
    });
  };
  allOnlineUsers = patch(allOnlineUsers);
  lastRoomUsers = patch(lastRoomUsers);
  friends = patch(friends);
  var convChanged = false;
  conversations.forEach(function(c) {
    if (c.with === u.username) { c.displayName = u.displayName; c.avatar = u.avatar || null; convChanged = true; }
  });
  if (convChanged) renderConversations();
  renderFriends();
  schedulePresenceRender();
});
