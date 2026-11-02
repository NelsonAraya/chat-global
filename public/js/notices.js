// Avisos del servidor: mensajes nuevos, no leídos, salas, departamentos, perfil y alertas.

socket.on('room-message', function(msg) {
  if (msg.sender !== currentUser) playNotification();
  if (!privateRecipient && !currentGroup) renderMessage(msg);
});

socket.on('room-unread-update', function(data) {
  roomUnreadCounts[data.room] = data.count;
  renderRooms();
  updateRoomTotalBadge();
});

// Mensajes nuevos en una sala que puedo ver pero en la que no estoy: el servidor los junta y avisa el total.
socket.on('room-unread-increment', function(data) {
  if (!data || !data.room || data.room === currentRoom) return;
  roomUnreadCounts[data.room] = (roomUnreadCounts[data.room] || 0) + (data.count || 1);
  renderRooms();
  updateRoomTotalBadge();
});

socket.on('private-message', function(msg) {
  noteConversationMessage(msg);
  var isRelevant = msg.sender === privateRecipient ||
                   (msg.recipient && msg.recipient === privateRecipient);

  if (isRelevant) {
    renderMessage(msg);
    return;
  }

  if (msg.recipient && msg.recipient !== currentUser) return;

  if (msg.sender !== currentUser) {
    var from = msg.sender;
    playNotification();
    if (!unreadCounts[from]) unreadCounts[from] = 0;
    unreadCounts[from]++;
    updateConvTotalBadge();
    renderConversations();

    if (privateRecipient && privateRecipient !== from) {
      showToast('Mensaje privado de ' + from);
    } else if (!privateRecipient) {
      showToast(from + ' te envio un mensaje privado');
    }
  }
});

socket.on('reaction-updated', function(msg) {
  var el = messagesList.querySelector('[data-message-id="' + msg.id + '"]');
  if (el) {
    updateReactionsBar(el, msg.reactions, msg.id);
  }
});

socket.on('users-update', function(data) {
  if (data.room === currentRoom && data.users) {
    renderUsers(data.users);
  }
  if (data.allUsers) {
    renderAllUsers(data.allUsers);
  }
});

socket.on('all-users', function(data) {
  if (data.users) {
    renderAllUsers(data.users);
  }
});

socket.on('get-all-users-response', function(users) {
  if (users) renderAllUsers(users);
});

socket.on('room-created', function(data) {
  rooms.push({ name: data.name, hasPassword: !!data.hasPassword, temporary: !!data.temporary, department: data.department || null });
  renderRooms();
  if (sidebarTab === 'admin') renderAdminPanel();
  showToast('Sala #' + data.name + ' creada');
});

socket.on('department-created', function(data) {
  if (!departments.find(function(d) { return d.name === data.name; })) {
    departments.push({ name: data.name, displayName: data.displayName });
  }
  if (sidebarTab === 'admin') renderAdminPanel();
});

socket.on('department-deleted', function(data) {
  departments = departments.filter(function(d) { return d.name !== data.name; });
  if (sidebarTab === 'admin') renderAdminPanel();
});

socket.on('profile-updated', function(data) {
  if (data.role !== undefined) {
    currentRole = data.role;
    currentSuperAdmin = !!data.superAdmin;
    if (currentRole === 'admin') adminTab.classList.remove('hidden');
    else adminTab.classList.add('hidden');
  }
  if (data.departments !== undefined) {
    myDepartments = data.departments || [];
  }
  if (data.adminDepartments !== undefined) {
    myAdminDepartments = data.adminDepartments || [];
  }
  if (currentRole === 'admin') applyAdminScopeUi();
  if (data.department !== undefined) {
    currentDepartment = data.department;
    currentDepartmentDisplayName = data.departmentDisplayName || data.department;
    updateHeaderDepartment();
  }
  if (data.rooms) {
    rooms = data.rooms;
    renderRooms();
    var stillVisible = rooms.some(function(r) { return r.name === currentRoom; });
    if (!stillVisible) {
      showToast('Tu departamento cambió. Entrando a tu nueva sala principal.');
      cancelPrivate();
      joinRoom({ name: rooms.length > 0 ? rooms[0].name : 'general' });
    }
  }
});

socket.on('room-deleted', function(data) {
  rooms = rooms.filter(function(r) { return r.name !== data.name; });
  renderRooms();
  if (sidebarTab === 'admin') renderAdminPanel();
  if (currentRoom === data.name) {
    showToast('La sala #' + data.name + ' se ha cerrado');
    joinRoom({ name: 'general' });
  } else {
    showToast('Sala #' + data.name + ' eliminada');
  }
});

socket.on('room-password-changed', function(data) {
  var found = rooms.find(function(r) { return r.name === data.name; });
  if (found) {
    found.hasPassword = data.hasPassword;
    renderRooms();
    if (sidebarTab === 'admin') renderAdminPanel();
  }
});

socket.on('panic-alert', function(data) {
  showPanicModal(data);
  playPanicSound();
});
