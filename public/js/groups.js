// Grupos: lista, invitaciones, chat de grupo y ventana para crearlos o administrarlos.

// ===================== GRUPOS =====================

const groupsList = $('groups-list');
const groupsTotalBadge = $('groups-total-badge');
const groupInvitationsSection = $('group-invitations-section');
const groupInvitationsList = $('group-invitations-list');
const groupManageBtn = $('group-manage-btn');
const roomUsersLabel = $('room-users-label');
const groupModalOverlay = $('group-modal-overlay');
const groupModalTitle = $('group-modal-title');
const groupModalName = $('group-modal-name');
const groupModalRenameBtn = $('group-modal-rename-btn');
const groupModalMembersSection = $('group-modal-members-section');
const groupModalMembers = $('group-modal-members');
const groupModalInviteSection = $('group-modal-invite-section');
const groupModalSelected = $('group-modal-selected');
const groupModalSearch = $('group-modal-search');
const groupModalResults = $('group-modal-results');
const groupModalError = $('group-modal-error');
const groupModalDelete = $('group-modal-delete');
const groupModalLeave = $('group-modal-leave');
const groupModalCreate = $('group-modal-create');

var groupModalMode = null; // 'create' | 'manage'
var groupModalSelectedUsers = [];
var groupModalSearchTimer = null;

function findLocalGroup(id) {
  return groups.find(function(g) { return g.id === id; });
}

function groupAvatarHtml(group, size) {
  return '<span class="avatar avatar-' + size + ' avatar-initial group-avatar" style="background:' + stringToColor('grupo-' + group.id) + '"><i class="fas fa-users"></i></span>';
}

function groupRoleLabel(role) {
  if (role === 'owner') return 'Creador';
  if (role === 'admin') return 'Admin';
  return '';
}

function loadGroups() {
  socket.emit('get-groups', function(res) {
    groups = (res && res.groups) || [];
    groupInvitations = (res && res.invitations) || [];
    renderGroups();
    renderGroupInvitations();
    updateGroupsTotalBadge();
  });
}

function updateGroupsTotalBadge() {
  var total = groupInvitations.length;
  for (var k in groupUnreadCounts) {
    if (groupUnreadCounts.hasOwnProperty(k)) total += groupUnreadCounts[k];
  }
  if (total > 0) {
    groupsTotalBadge.textContent = total;
    groupsTotalBadge.classList.remove('hidden');
  } else {
    groupsTotalBadge.classList.add('hidden');
  }
}

function renderGroups() {
  if (groups.length === 0) {
    groupsList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px;">Aún no estás en ningún grupo</div>';
    return;
  }
  var sorted = groups.slice().sort(function(a, b) {
    var ta = a.lastMessage ? a.lastMessage.created_at : a.created_at;
    var tb = b.lastMessage ? b.lastMessage.created_at : b.created_at;
    return (tb || '').localeCompare(ta || '');
  });
  groupsList.innerHTML = sorted.map(function(g) {
    var unread = groupUnreadCounts[g.id] || 0;
    var badgeHtml = unread > 0 ? '<span class="conv-badge">' + unread + '</span>' : '';
    var preview = g.members.length + ' miembro' + (g.members.length === 1 ? '' : 's');
    var timeHtml = '';
    if (g.lastMessage) {
      var lastContent = g.lastMessage.content || (g.lastMessage.file ? '[Archivo]' : '');
      preview = (g.lastMessage.sender === currentUser ? 'Tu' : (g.lastMessage.displayName || g.lastMessage.sender)) + ': ' + lastContent;
      timeHtml = '<span class="conv-time">' + formatDate(g.lastMessage.created_at) + '</span>';
    }
    if (preview.length > 40) preview = preview.substring(0, 40) + '...';
    return '<div class="conv-item' + (currentGroup === g.id ? ' active' : '') + (unread > 0 ? ' unread' : '') + '" data-group="' + g.id + '">' +
      groupAvatarHtml(g, 36) +
      '<div class="conv-info">' +
        '<div class="conv-name">' + escapeHtml(g.name) + badgeHtml + '</div>' +
        '<div class="conv-preview">' + escapeHtml(preview) + '</div>' +
      '</div>' +
      '<div class="conv-meta">' + timeHtml + '</div>' +
    '</div>';
  }).join('');

  groupsList.querySelectorAll('.conv-item').forEach(function(el) {
    el.addEventListener('click', function() {
      openGroupChat(parseInt(el.dataset.group, 10));
    });
  });
}

function renderGroupInvitations() {
  if (groupInvitations.length === 0) {
    groupInvitationsSection.classList.add('hidden');
    return;
  }
  groupInvitationsSection.classList.remove('hidden');
  groupInvitationsList.innerHTML = groupInvitations.map(function(inv) {
    var by = inv.invitedBy ? (inv.invitedBy.displayName || inv.invitedBy.username) : '';
    return '<div class="friend-request-item" data-group="' + inv.id + '">' +
      groupAvatarHtml(inv, 32) +
      '<div class="friend-info">' +
        '<div class="friend-name">' + escapeHtml(inv.name) + '</div>' +
        '<div class="admin-user-username">Te invitó ' + escapeHtml(by) + ' · ' + inv.memberCount + ' miembro' + (inv.memberCount === 1 ? '' : 's') + '</div>' +
      '</div>' +
      '<div class="friend-request-actions">' +
        '<button class="friend-request-accept" title="Unirme"><i class="fas fa-check"></i></button>' +
        '<button class="friend-request-reject" title="Rechazar"><i class="fas fa-times"></i></button>' +
      '</div>' +
    '</div>';
  }).join('');

  groupInvitationsList.querySelectorAll('.friend-request-item').forEach(function(item) {
    var id = parseInt(item.dataset.group, 10);
    item.querySelector('.friend-request-accept').addEventListener('click', function() { respondGroupInvitation(id, true); });
    item.querySelector('.friend-request-reject').addEventListener('click', function() { respondGroupInvitation(id, false); });
  });
}

function respondGroupInvitation(id, accept) {
  socket.emit('group-respond-invite', { groupId: id, accept: accept }, function(res) {
    groupInvitations = groupInvitations.filter(function(i) { return i.id !== id; });
    renderGroupInvitations();
    updateGroupsTotalBadge();
    if (!res.ok) { showToast(res.error); return; }
    if (accept && res.group) {
      upsertLocalGroup(res.group);
      showToast('Te uniste al grupo ' + res.group.name);
      openGroupChat(res.group.id);
    }
  });
}

function upsertLocalGroup(group) {
  var idx = groups.findIndex(function(g) { return g.id === group.id; });
  if (idx === -1) groups.push(group);
  else groups[idx] = group;
  renderGroups();
}

function removeLocalGroup(id) {
  groups = groups.filter(function(g) { return g.id !== id; });
  groupInvitations = groupInvitations.filter(function(i) { return i.id !== id; });
  delete groupUnreadCounts[id];
  renderGroups();
  renderGroupInvitations();
  updateGroupsTotalBadge();
  if (groupModalMode === 'manage' && currentGroup === id) closeGroupModal();
  if (currentGroup === id) cancelPrivate();
}

function showGroupsTab() {
  if (sidebarTab === 'groups') return;
  document.querySelectorAll('.sidebar-tab').forEach(function(t) { t.classList.remove('active'); });
  document.querySelector('[data-panel="groups"]').classList.add('active');
  sidebarTab = 'groups';
  hideAdminView();
  document.querySelectorAll('.sidebar-panel').forEach(function(p) { p.classList.add('hidden'); });
  $('groups-panel').classList.remove('hidden');
}

function openGroupChat(id) {
  var group = findLocalGroup(id);
  if (!group) return;
  privateRecipient = null;
  privateIndicator.classList.add('hidden');
  cancelReply();
  currentGroup = id;
  groupUnreadCounts[id] = 0;
  updateGroupsTotalBadge();
  showGroupsTab();
  renderGroups();
  renderConversations();
  updateGroupHeader(group);

  contextBadge.classList.add('hidden');
  contextGlobalBadge.classList.add('hidden');
  backToRoomBtn.classList.remove('hidden');
  groupManageBtn.classList.remove('hidden');
  messageInput.focus();

  socket.emit('get-group-history', { groupId: id }, function(res) {
    if (!res.ok) { showToast(res.error); removeLocalGroup(id); return; }
    if (currentGroup === id) renderMessages(res.history, res.hasMoreHistory);
  });
  onActionCloseDrawers();
}

function updateGroupHeader(group) {
  contextName.textContent = group.name;
  contextIcon.className = 'fas fa-users';
  messageInput.placeholder = 'Escribe en el grupo ' + group.name + '...';
  roomUsersLabel.textContent = 'Miembros del grupo';
  renderGroupMembersSidebar(group);
}

function renderGroupMembersSidebar(group) {
  roomUsersList.innerHTML = group.members.map(function(m) {
    var isMe = m.username === currentUser;
    var role = groupRoleLabel(m.role);
    var roleHtml = role ? ' <span style="font-size:11px;color:var(--text-muted)">(' + role + ')</span>' : '';
    return '<div class="user-item"' + (isMe ? '' : ' data-user="' + escapeHtml(m.username) + '"') + '>' +
      getAvatarHtml(m.username, m.avatar, 28) +
      '<span class="user-name">' + (isMe ? '<strong>' + escapeHtml(m.displayName) + '</strong> <span style="font-size:11px;color:var(--text-muted)">(tu)</span>' : escapeHtml(m.displayName)) + roleHtml + '</span>' +
      (isMe ? '' : '<i class="fas fa-envelope pm-icon" title="Mensaje privado"></i>') +
    '</div>';
  }).join('');
}

// Sale de la vista de grupo (al volver a una sala o abrir un privado).
function exitGroupMode() {
  if (currentGroup === null) return;
  currentGroup = null;
  groupManageBtn.classList.add('hidden');
  roomUsersLabel.textContent = 'En este canal';
  renderUsers(lastRoomUsers);
  renderGroups();
}

socket.on('group-message', function(msg) {
  var group = findLocalGroup(msg.group_id);
  if (group) {
    group.lastMessage = msg;
  }
  if (msg.group_id === currentGroup) {
    renderMessage(msg);
    renderGroups();
    return;
  }
  if (msg.sender !== currentUser) {
    groupUnreadCounts[msg.group_id] = (groupUnreadCounts[msg.group_id] || 0) + 1;
    updateGroupsTotalBadge();
    playNotification();
    showToast((msg.displayName || msg.sender) + ' en ' + (group ? group.name : 'un grupo'));
  }
  renderGroups();
});

socket.on('group-updated', function(group) {
  upsertLocalGroup(group);
  if (currentGroup === group.id) updateGroupHeader(group);
  if (groupModalMode === 'manage' && currentGroup === group.id) renderGroupModalManage(group);
});

socket.on('group-invitation', function(inv) {
  groupInvitations = groupInvitations.filter(function(i) { return i.id !== inv.id; });
  groupInvitations.push(inv);
  renderGroupInvitations();
  updateGroupsTotalBadge();
  playNotification();
  showToast('Te invitaron al grupo ' + inv.name);
});

socket.on('group-removed', function(data) {
  var wasMember = !!findLocalGroup(data.id);
  removeLocalGroup(data.id);
  if (!wasMember) return;
  if (data.reason === 'deleted') showToast('El grupo ' + data.name + ' fue eliminado');
  else if (data.reason === 'removed') showToast('Ya no eres parte del grupo ' + data.name);
});

groupManageBtn.addEventListener('click', function() {
  var group = findLocalGroup(currentGroup);
  if (group) openManageGroupModal(group);
});

// ----- Modal crear / administrar grupo -----

function resetGroupModal() {
  groupModalError.textContent = '';
  groupModalSearch.value = '';
  groupModalResults.innerHTML = '';
  groupModalSelectedUsers = [];
  groupModalSelected.innerHTML = '';
}

function closeGroupModal() {
  groupModalOverlay.classList.add('hidden');
  groupModalMode = null;
}

$('create-group-btn').addEventListener('click', function() {
  onActionCloseDrawers();
  resetGroupModal();
  groupModalMode = 'create';
  groupModalTitle.innerHTML = '<i class="fas fa-users"></i> Crear grupo';
  groupModalName.value = '';
  groupModalName.disabled = false;
  groupModalRenameBtn.classList.add('hidden');
  groupModalMembersSection.classList.add('hidden');
  groupModalInviteSection.classList.remove('hidden');
  groupModalSelected.classList.remove('hidden');
  groupModalDelete.classList.add('hidden');
  groupModalLeave.classList.add('hidden');
  groupModalCreate.classList.remove('hidden');
  groupModalCreate.disabled = false;
  groupModalOverlay.classList.remove('hidden');
  groupModalName.focus();
});

function openManageGroupModal(group) {
  resetGroupModal();
  groupModalMode = 'manage';
  groupModalTitle.innerHTML = '<i class="fas fa-users-cog"></i> Grupo';
  groupModalName.value = group.name;
  groupModalSelected.classList.add('hidden');
  groupModalMembersSection.classList.remove('hidden');
  groupModalCreate.classList.add('hidden');
  groupModalLeave.classList.remove('hidden');
  renderGroupModalManage(group);
  groupModalOverlay.classList.remove('hidden');
}

function renderGroupModalManage(group) {
  var isOwner = group.myRole === 'owner';
  var isManager = isOwner || group.myRole === 'admin';
  groupModalName.disabled = !isManager;
  if (document.activeElement !== groupModalName) groupModalName.value = group.name;
  groupModalRenameBtn.classList.toggle('hidden', !isManager);
  groupModalInviteSection.classList.toggle('hidden', !isManager);
  groupModalDelete.classList.toggle('hidden', !isOwner);

  var rows = group.members.map(function(m) {
    var role = groupRoleLabel(m.role);
    var actions = '';
    if (m.username !== currentUser && m.role !== 'owner') {
      if (isOwner) {
        actions += '<button class="add-friend-action-btn secondary" data-action="' + (m.role === 'admin' ? 'unadmin' : 'admin') + '">' + (m.role === 'admin' ? 'Quitar admin' : 'Hacer admin') + '</button>';
      }
      if (isOwner || (isManager && m.role === 'member')) {
        actions += '<button class="add-friend-action-btn danger" data-action="remove" title="Quitar del grupo"><i class="fas fa-user-minus"></i></button>';
      }
    }
    return '<div class="add-friend-result-item" data-user="' + escapeHtml(m.username) + '">' +
      getAvatarHtml(m.username, m.avatar, 32) +
      '<div class="friend-info">' +
        '<div class="friend-name">' + escapeHtml(m.displayName) + (m.username === currentUser ? ' (tu)' : '') + '</div>' +
        '<div class="friend-username">@' + escapeHtml(m.username) + (role ? ' · ' + role : '') + '</div>' +
      '</div>' +
      '<div class="group-member-actions">' + actions + '</div>' +
    '</div>';
  });
  group.invited.forEach(function(m) {
    var actions = isManager ? '<button class="add-friend-action-btn danger" data-action="remove" title="Cancelar invitación"><i class="fas fa-times"></i></button>' : '';
    rows.push('<div class="add-friend-result-item" data-user="' + escapeHtml(m.username) + '">' +
      getAvatarHtml(m.username, m.avatar, 32) +
      '<div class="friend-info">' +
        '<div class="friend-name">' + escapeHtml(m.displayName) + '</div>' +
        '<div class="friend-username">@' + escapeHtml(m.username) + ' · Invitación pendiente</div>' +
      '</div>' +
      '<div class="group-member-actions">' + actions + '</div>' +
    '</div>');
  });
  groupModalMembers.innerHTML = rows.join('');

  groupModalMembers.querySelectorAll('[data-action]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var username = btn.closest('.add-friend-result-item').dataset.user;
      var action = btn.dataset.action;
      groupModalError.textContent = '';
      btn.disabled = true;
      var done = function(res) {
        btn.disabled = false;
        if (!res.ok) groupModalError.textContent = res.error;
      };
      if (action === 'remove') {
        socket.emit('group-remove-member', { groupId: group.id, username: username }, done);
      } else {
        socket.emit('group-set-admin', { groupId: group.id, username: username, admin: action === 'admin' }, done);
      }
    });
  });
}

function renderGroupModalSelected() {
  groupModalSelected.innerHTML = groupModalSelectedUsers.map(function(u) {
    return '<span class="group-chip" data-user="' + escapeHtml(u.username) + '">' + escapeHtml(u.displayName || u.username) +
      '<button type="button" title="Quitar"><i class="fas fa-times"></i></button></span>';
  }).join('');
  groupModalSelected.querySelectorAll('.group-chip button').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var username = btn.parentElement.dataset.user;
      groupModalSelectedUsers = groupModalSelectedUsers.filter(function(u) { return u.username !== username; });
      renderGroupModalSelected();
    });
  });
}

groupModalSearch.addEventListener('input', function() {
  clearTimeout(groupModalSearchTimer);
  var query = this.value.trim();
  if (query.length < 2) {
    groupModalResults.innerHTML = '';
    return;
  }
  groupModalSearchTimer = setTimeout(function() {
    socket.emit('search-users', { query: query, activeOnly: true }, function(results) {
      renderGroupModalResults(results || []);
    });
  }, 300);
});

function renderGroupModalResults(results) {
  var group = groupModalMode === 'manage' ? findLocalGroup(currentGroup) : null;
  var taken = {};
  if (group) {
    group.members.concat(group.invited).forEach(function(m) { taken[m.username] = true; });
  }
  groupModalSelectedUsers.forEach(function(u) { taken[u.username] = true; });

  if (results.length === 0) {
    groupModalResults.innerHTML = '<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:13px;">Sin resultados</div>';
    return;
  }
  groupModalResults.innerHTML = results.map(function(r) {
    var disabled = taken[r.username] ? ' disabled' : '';
    var label = taken[r.username] ? 'Agregado' : (groupModalMode === 'manage' ? 'Invitar' : 'Agregar');
    return '<div class="add-friend-result-item" data-user="' + escapeHtml(r.username) + '" data-name="' + escapeHtml(r.displayName || r.username) + '">' +
      getAvatarHtml(r.username, r.avatar, 32) +
      '<div class="friend-info">' +
        '<div class="friend-name">' + escapeHtml(r.displayName || r.username) + '</div>' +
        '<div class="friend-username">@' + escapeHtml(r.username) + '</div>' +
      '</div>' +
      '<button class="add-friend-action-btn"' + disabled + '>' + label + '</button>' +
    '</div>';
  }).join('');

  groupModalResults.querySelectorAll('.add-friend-action-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      if (btn.disabled) return;
      var item = btn.closest('.add-friend-result-item');
      var username = item.dataset.user;
      groupModalError.textContent = '';
      if (groupModalMode === 'create') {
        groupModalSelectedUsers.push({ username: username, displayName: item.dataset.name });
        renderGroupModalSelected();
        btn.disabled = true;
        btn.textContent = 'Agregado';
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Invitando...';
      socket.emit('group-invite', { groupId: currentGroup, usernames: [username] }, function(res) {
        if (!res.ok) {
          btn.disabled = false;
          btn.textContent = 'Invitar';
          groupModalError.textContent = res.error;
          return;
        }
        btn.textContent = 'Invitado';
        showToast('Invitación enviada a ' + item.dataset.name);
      });
    });
  });
}

groupModalCreate.addEventListener('click', function() {
  var name = groupModalName.value.trim();
  if (!name) { groupModalError.textContent = 'Ponle un nombre al grupo'; return; }
  groupModalCreate.disabled = true;
  socket.emit('create-group', { name: name, members: groupModalSelectedUsers.map(function(u) { return u.username; }) }, function(res) {
    groupModalCreate.disabled = false;
    if (!res.ok) { groupModalError.textContent = res.error; return; }
    closeGroupModal();
    upsertLocalGroup(res.group);
    showToast(groupModalSelectedUsers.length > 0 ? 'Grupo creado. Se enviaron las invitaciones.' : 'Grupo creado');
    openGroupChat(res.group.id);
  });
});

groupModalRenameBtn.addEventListener('click', function() {
  var name = groupModalName.value.trim();
  if (!name) { groupModalError.textContent = 'Ponle un nombre al grupo'; return; }
  socket.emit('group-rename', { groupId: currentGroup, name: name }, function(res) {
    if (!res.ok) { groupModalError.textContent = res.error; return; }
    groupModalName.blur();
    showToast('Nombre actualizado');
  });
});

groupModalName.addEventListener('keydown', function(e) {
  if (e.key !== 'Enter') return;
  if (groupModalMode === 'create') groupModalCreate.click();
  else if (!groupModalRenameBtn.classList.contains('hidden')) groupModalRenameBtn.click();
});

groupModalLeave.addEventListener('click', function() {
  var group = findLocalGroup(currentGroup);
  if (!group) return;
  var msg = group.myRole === 'owner'
    ? '¿Salir del grupo "' + group.name + '"?\nOtro miembro quedará como administrador del grupo.'
    : '¿Salir del grupo "' + group.name + '"?';
  if (!confirm(msg)) return;
  socket.emit('group-leave', { groupId: group.id }, function(res) {
    if (!res.ok) { groupModalError.textContent = res.error; return; }
    closeGroupModal();
    removeLocalGroup(group.id);
    showToast('Saliste del grupo ' + group.name);
  });
});

groupModalDelete.addEventListener('click', function() {
  var group = findLocalGroup(currentGroup);
  if (!group) return;
  if (!confirm('¿Eliminar el grupo "' + group.name + '"?\nSe borrarán todos sus mensajes para todos los miembros.')) return;
  socket.emit('group-delete', { groupId: group.id }, function(res) {
    if (!res.ok) { groupModalError.textContent = res.error; return; }
    closeGroupModal();
  });
});

$('group-modal-close').addEventListener('click', closeGroupModal);
groupModalOverlay.addEventListener('click', function(e) {
  if (e.target === groupModalOverlay) closeGroupModal();
});
