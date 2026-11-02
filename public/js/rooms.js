// Salas: entrar (con contraseña si tiene) y crear salas.

function joinRoom(data) {
  var name = typeof data === 'string' ? data : data.name;
  if (!name) return;

  var payload = { name: name };

  if (roomPasswords[name]) {
    payload.password = roomPasswords[name];
  } else if (data.password) {
    payload.password = data.password;
  }

  socket.emit('join-room', payload, function(res) {
    if (!res.ok) {
      if (res.requirePassword) {
        pendingPasswordRoom = name;
        passwordModalRoomName.textContent = '#' + name;
        passwordModalInput.value = '';
        passwordModalError.textContent = '';
        passwordModalOverlay.classList.remove('hidden');
        passwordModalInput.focus();
        return;
      }
      if (res.error) showToast(res.error);
      return;
    }

    currentRoom = name;
    privateRecipient = null;
    exitGroupMode();
    roomUnreadCounts[name] = 0;
    contextName.textContent = name;
    if (res.hasPassword) contextIcon.className = 'fas fa-lock';
    else if (res.temporary) contextIcon.className = 'far fa-clock';
    else contextIcon.className = 'fas fa-hashtag';
    contextBadge.classList.add('hidden');
    contextGlobalBadge.classList.toggle('hidden', !!res.department);
    backToRoomBtn.classList.add('hidden');
    welcomeRoom.textContent = name;
    renderRooms();
    roomUsersHidden = !!res.hideUsers;
    renderUsers(res.users || []);

    renderMessages(res.history, res.hasMoreHistory);
    messageInput.placeholder = 'Escribe en #' + name + '...';
    messageInput.focus();
    onActionCloseDrawers();
  });
}

$('create-room-btn').addEventListener('click', function() {
  onActionCloseDrawers();
  createModalOverlay.classList.remove('hidden');
  createModalInput.value = '';
  createModalPassword.value = '';
  createModalError.textContent = '';
  if (currentRole !== 'admin') {
    createModalTemporary.checked = true;
    createModalTemporary.disabled = true;
    createModalInfo.classList.remove('hidden');
    createModalDeptGroup.classList.add('hidden');
  } else {
    createModalTemporary.checked = false;
    createModalTemporary.disabled = false;
    createModalInfo.classList.add('hidden');
    // Las salas globales solo las crea el administrador general; el de departamento, en los suyos.
    // En el departamento donde está como usuario (no admin) solo puede crear salas temporales.
    var userDeptOption = !currentSuperAdmin && currentDepartment && myAdminDepartments.indexOf(currentDepartment) === -1
      ? '<option value="' + escapeHtml(currentDepartment) + '">' + escapeHtml(currentDepartmentDisplayName || currentDepartment) + ' (solo temporal)</option>'
      : '';
    createModalDepartment.innerHTML = (currentSuperAdmin ? '<option value="">Global (todos los departamentos)</option>' : '') +
      adminDepartments().map(function(d) {
        return '<option value="' + escapeHtml(d.name) + '">' + escapeHtml(d.displayName || d.name) + '</option>';
      }).join('') + userDeptOption;
    createModalDeptGroup.classList.remove('hidden');
  }
  createModalInput.focus();
});

function closeCreateModal() {
  createModalOverlay.classList.add('hidden');
}

createModalClose.addEventListener('click', closeCreateModal);
createModalCancel.addEventListener('click', closeCreateModal);
createModalOverlay.addEventListener('click', function(e) {
  if (e.target === createModalOverlay) closeCreateModal();
});

createModalInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') createModalPassword.focus();
});
createModalPassword.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') createModalConfirm.click();
});

createModalConfirm.addEventListener('click', function() {
  var name = createModalInput.value.trim();
  if (!name) { createModalError.textContent = 'Ingresa un nombre'; return; }

  createModalConfirm.disabled = true;
  createModalConfirm.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creando...';

  socket.emit('create-room', {
    name: name,
    password: createModalPassword.value || null,
    temporary: createModalTemporary.checked,
    department: currentRole === 'admin' ? (createModalDepartment.value || null) : undefined
  }, function(res) {
    createModalConfirm.disabled = false;
    createModalConfirm.innerHTML = '<i class="fas fa-check"></i> Crear';
    if (!res.ok) { createModalError.textContent = res.error; return; }
    closeCreateModal();
    if (sidebarTab !== 'rooms') {
      document.querySelectorAll('.sidebar-tab').forEach(function(t) { t.classList.remove('active'); });
      document.querySelector('[data-panel="rooms"]').classList.add('active');
      sidebarTab = 'rooms';
      document.querySelectorAll('.sidebar-panel').forEach(function(p) { p.classList.add('hidden'); });
      $('rooms-panel').classList.remove('hidden');
    }
    cancelPrivate();
    joinRoom({ name: res.name });
  });
});

function closePasswordModal() {
  passwordModalOverlay.classList.add('hidden');
  pendingPasswordRoom = null;
}

passwordModalClose.addEventListener('click', closePasswordModal);
passwordModalCancel.addEventListener('click', closePasswordModal);
passwordModalOverlay.addEventListener('click', function(e) {
  if (e.target === passwordModalOverlay) closePasswordModal();
});

passwordModalInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') passwordModalConfirm.click();
});

passwordModalConfirm.addEventListener('click', function() {
  var pwd = passwordModalInput.value;
  if (!pwd) { passwordModalError.textContent = 'Ingresa la contraseña'; return; }

  passwordModalConfirm.disabled = true;
  passwordModalConfirm.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando...';

  roomPasswords[pendingPasswordRoom] = pwd;
  joinRoom({ name: pendingPasswordRoom, password: pwd });

  passwordModalConfirm.disabled = false;
  passwordModalConfirm.innerHTML = '<i class="fas fa-unlock"></i> Entrar';
  closePasswordModal();
});
