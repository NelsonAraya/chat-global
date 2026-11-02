// Panel de administración: cuentas, solicitudes, alertas, errores, departamentos y salas.

function departmentLabel(name) {
  if (!name) return 'Global';
  var found = departments.find(function(d) { return d.name === name; });
  return found ? (found.displayName || found.name) : name;
}

function userDepartmentsLabel(names) {
  if (!names || names.length === 0) return 'Sin asignar';
  return names.map(function(n) {
    var found = departments.find(function(d) { return d.name === n; });
    return found ? (found.displayName || found.name) : n;
  }).join(', ');
}

// Departamentos que puede administrar este admin: todos si es el general; si no, solo donde es admin.
function adminDepartments() {
  if (currentSuperAdmin) return departments;
  return departments.filter(function(d) { return myAdminDepartments.indexOf(d.name) !== -1; });
}

function canAdminRoom(room) {
  if (currentSuperAdmin) return true;
  return !!room.department && myAdminDepartments.indexOf(room.department) !== -1;
}

// Muestra u oculta lo que solo usa el administrador general (registros, departamentos, errores).
function applyAdminScopeUi() {
  var errorsTabBtn = document.querySelector('.admin-subtab[data-admin-tab="errores"]');
  if (errorsTabBtn) errorsTabBtn.classList.toggle('hidden', !currentSuperAdmin);
  createDeptBtn.classList.toggle('hidden', !currentSuperAdmin);
  if (!currentSuperAdmin) adminPendingSection.classList.add('hidden');
}

// Cada departamento tiene dos casillas: "pertenece" y "Admin" (esta última solo con el rol Administrador).
function renderDepartmentCheckboxes(containerEl, selectedNames, adminNames) {
  var list = adminDepartments();
  if (list.length === 0) {
    containerEl.innerHTML = '<div class="admin-edit-dept-empty">No hay departamentos creados aún.</div>';
    return;
  }
  adminNames = adminNames || [];
  containerEl.innerHTML = list.map(function(d) {
    var checked = selectedNames.indexOf(d.name) !== -1 ? ' checked' : '';
    var adminChecked = adminNames.indexOf(d.name) !== -1 ? ' checked' : '';
    return '<div class="admin-edit-dept-row">' +
      '<label><input type="checkbox" class="dept-member" value="' + escapeHtml(d.name) + '"' + checked + ' /> ' + escapeHtml(d.displayName || d.name) + '</label>' +
      '<label class="dept-admin-toggle"><input type="checkbox" class="dept-admin" value="' + escapeHtml(d.name) + '"' + adminChecked + ' /> Admin</label>' +
    '</div>';
  }).join('');
  containerEl.querySelectorAll('.admin-edit-dept-row').forEach(function(row) {
    var member = row.querySelector('.dept-member');
    var admin = row.querySelector('.dept-admin');
    member.addEventListener('change', function() { if (!member.checked) admin.checked = false; });
    admin.addEventListener('change', function() { if (admin.checked) member.checked = true; });
  });
  updateAdminDeptToggles();
}

// Las casillas "Admin" solo se muestran cuando el rol elegido es Administrador.
function updateAdminDeptToggles() {
  var isAdmin = adminEditRole.value === 'admin';
  adminEditDepartments.querySelectorAll('.dept-admin-toggle').forEach(function(el) { el.classList.toggle('hidden', !isAdmin); });
  $('admin-edit-admin-hint').classList.toggle('hidden', !isAdmin);
}
adminEditRole.addEventListener('change', updateAdminDeptToggles);

function loadPendingRegistrations() {
  socket.emit('get-pending-registrations', function(list) {
    pendingRegistrations = list || [];
    renderPendingRegistrations();
    updateAdminPendingBadge();
  });
}

function renderPendingRegistrations() {
  if (!pendingRegistrations || pendingRegistrations.length === 0) {
    adminPendingSection.classList.add('hidden');
    return;
  }
  adminPendingSection.classList.remove('hidden');
  adminPendingList.innerHTML = pendingRegistrations.map(function(r) {
    return '<div class="friend-request-item" data-user="' + escapeHtml(r.username) + '">' +
      getAvatarHtml(r.username, null, 32) +
      '<div class="friend-info">' +
        '<div class="friend-name">' + escapeHtml(r.displayName || r.username) + '</div>' +
        '<div class="admin-user-username">@' + escapeHtml(r.username) + '</div>' +
        '<div class="admin-user-username"><i class="fas fa-envelope"></i> ' + escapeHtml(r.email || 'Sin correo') + '</div>' +
      '</div>' +
      '<div class="friend-request-actions">' +
        '<button class="friend-request-accept" title="Aceptar"><i class="fas fa-check"></i></button>' +
        '<button class="friend-request-reject" title="Rechazar"><i class="fas fa-times"></i></button>' +
      '</div>' +
    '</div>';
  }).join('');

  adminPendingList.querySelectorAll('.friend-request-accept').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var username = btn.closest('.friend-request-item').dataset.user;
      socket.emit('admin-approve-registration', { username: username }, function(res) {
        if (!res.ok) { showToast(res.error); return; }
        pendingRegistrations = pendingRegistrations.filter(function(r) { return r.username !== username; });
        renderPendingRegistrations();
        updateAdminPendingBadge();
        showToast('Cuenta de ' + username + ' aprobada');
        renderAdminPanel();
      });
    });
  });
  adminPendingList.querySelectorAll('.friend-request-reject').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var username = btn.closest('.friend-request-item').dataset.user;
      if (!confirm('¿Rechazar la cuenta de "' + username + '"? No podrá ingresar al chat.')) return;
      socket.emit('admin-reject-registration', { username: username }, function(res) {
        if (!res.ok) { showToast(res.error); return; }
        pendingRegistrations = pendingRegistrations.filter(function(r) { return r.username !== username; });
        renderPendingRegistrations();
        updateAdminPendingBadge();
        showToast('Cuenta de ' + username + ' rechazada');
        renderAdminPanel();
      });
    });
  });
}

function updateAdminPendingBadge() {
  var count = pendingRegistrations.length;
  if (count > 0) {
    adminPendingBadge.textContent = count;
    adminPendingBadge.classList.remove('hidden');
  } else {
    adminPendingBadge.classList.add('hidden');
  }
}

socket.on('registration-pending', function(data) {
  if (currentRole !== 'admin') return;
  pendingRegistrations.push(data);
  renderPendingRegistrations();
  updateAdminPendingBadge();
  playNotification();
  showToast('Nueva solicitud de cuenta: ' + (data.displayName || data.username));
});

function formatAlertDateTime(iso) {
  try {
    var d = new Date(iso);
    return d.toLocaleString('es-CL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return '';
  }
}

function loadAlertHistory(reset) {
  if (loadingAlertHistory) return;
  if (reset) {
    alertHistory = [];
    alertHistoryHasMore = false;
  }
  loadingAlertHistory = true;
  adminAlertsLoadMore.disabled = true;
  socket.emit('get-alert-history', { offset: reset ? 0 : alertHistory.length }, function(res) {
    loadingAlertHistory = false;
    adminAlertsLoadMore.disabled = false;
    if (!res) return;
    alertHistory = reset ? (res.alerts || []) : alertHistory.concat(res.alerts || []);
    alertHistoryHasMore = !!res.hasMore;
    renderAlertHistory();
  });
}

function renderAlertHistory() {
  if (alertHistory.length === 0) {
    adminAlertsList.innerHTML = '<div class="admin-table-empty">Sin alertas registradas todavía.</div>';
    adminAlertsLoadMore.classList.add('hidden');
    return;
  }
  adminAlertsList.innerHTML = alertHistory.map(function(a) {
    var dept = a.departmentDisplayName || (a.department ? a.department : 'Global / sin departamento');
    var loc = a.location && a.location.trim() ? a.location : 'Indeterminada';
    return '<div class="admin-user-item">' +
      getAvatarHtml(a.username, null, 36) +
      '<div class="admin-user-info">' +
        '<div class="admin-user-name">' + escapeHtml(a.displayName || a.username) + ' <span class="admin-user-username">@' + escapeHtml(a.username) + '</span></div>' +
        '<div class="admin-user-username"><i class="fas fa-building"></i> ' + escapeHtml(dept) + ' &nbsp; <i class="fas fa-map-marker-alt"></i> ' + escapeHtml(loc) + '</div>' +
      '</div>' +
      '<div class="admin-room-meta" style="flex-shrink:0;">' + escapeHtml(formatAlertDateTime(a.created_at)) + '</div>' +
    '</div>';
  }).join('');
  adminAlertsLoadMore.classList.toggle('hidden', !alertHistoryHasMore);
}

adminAlertsLoadMore.addEventListener('click', function() {
  loadAlertHistory(false);
});

// ===== Registro de errores del sistema (solo administradores) =====
var errorLogItems = [];
var errorLogHasMore = false;
var loadingErrorLog = false;

function updateErrorsBadge(count) {
  adminErrorsBadge.textContent = count > 99 ? '99+' : String(count);
  adminErrorsBadge.classList.toggle('hidden', !count);
}

function refreshErrorCount() {
  if (!currentSuperAdmin) return;
  socket.emit('get-error-count', function(res) {
    if (res) updateErrorsBadge(res.pendingCount || 0);
  });
}

function loadErrorLog(reset) {
  if (loadingErrorLog || !currentSuperAdmin) return;
  loadingErrorLog = true;
  adminErrorsLoadMore.disabled = true;
  socket.emit('get-error-log', { offset: reset ? 0 : errorLogItems.length, onlyPending: adminErrorsOnlyPending.checked }, function(res) {
    loadingErrorLog = false;
    adminErrorsLoadMore.disabled = false;
    if (!res || !res.ok) return;
    errorLogItems = reset ? res.errors : errorLogItems.concat(res.errors);
    errorLogHasMore = !!res.hasMore;
    updateErrorsBadge(res.pendingCount || 0);
    renderErrorLog();
  });
}

// Texto listo para pegar en un correo o mensaje a los desarrolladores.
function errorReportText(e) {
  return [
    'Error del Chat CORMUDESI (#' + e.id + ')',
    'Origen: ' + e.source,
    'Mensaje: ' + e.message,
    'Usuario: ' + (e.username || '—'),
    'Primera vez: ' + formatAlertDateTime(e.created_at),
    'Última vez: ' + formatAlertDateTime(e.last_at) + ' (' + e.occurrences + ' ' + (e.occurrences === 1 ? 'vez' : 'veces') + ')',
    '',
    e.stack || '(sin detalle técnico)'
  ].join('\n');
}

function renderErrorLog() {
  if (errorLogItems.length === 0) {
    adminErrorsList.innerHTML = '<div class="admin-table-empty">' +
      (adminErrorsOnlyPending.checked ? 'No hay errores pendientes. 🎉' : 'No hay errores registrados.') + '</div>';
    adminErrorsLoadMore.classList.add('hidden');
    return;
  }
  adminErrorsList.innerHTML = errorLogItems.map(function(e, i) {
    var times = e.occurrences > 1 ? ' <span class="admin-count-badge">' + e.occurrences + ' veces</span>' : '';
    var who = e.username ? ' &nbsp; <i class="fas fa-user"></i> ' + escapeHtml(e.username) : '';
    var status = e.resolved
      ? '<span class="admin-error-status"><i class="fas fa-check"></i> Revisado por ' + escapeHtml(e.resolvedBy || '—') + '</span>'
      : '';
    return '<div class="admin-error-item' + (e.resolved ? ' resolved' : '') + '" data-index="' + i + '">' +
      '<div class="admin-error-head">' +
        '<div class="admin-user-info">' +
          '<div class="admin-error-message">' + escapeHtml(e.message) + times + '</div>' +
          '<div class="admin-user-username"><i class="fas fa-location-crosshairs"></i> ' + escapeHtml(e.source) + who +
            ' &nbsp; <i class="fas fa-clock"></i> ' + escapeHtml(formatAlertDateTime(e.last_at)) + '</div>' +
          status +
        '</div>' +
        '<div class="admin-error-actions">' +
          '<button class="btn-icon admin-error-toggle" title="Ver detalle"><i class="fas fa-chevron-down"></i></button>' +
          '<button class="btn-icon admin-error-copy" title="Copiar para los desarrolladores"><i class="fas fa-copy"></i></button>' +
          '<button class="btn-icon admin-error-resolve" title="' + (e.resolved ? 'Volver a pendiente' : 'Marcar revisado') + '">' +
            '<i class="fas ' + (e.resolved ? 'fa-rotate-left' : 'fa-check') + '"></i></button>' +
        '</div>' +
      '</div>' +
      '<pre class="admin-error-stack hidden">' + escapeHtml(errorReportText(e)) + '</pre>' +
    '</div>';
  }).join('');
  adminErrorsLoadMore.classList.toggle('hidden', !errorLogHasMore);
}

adminErrorsList.addEventListener('click', function(ev) {
  var item = ev.target.closest('.admin-error-item');
  if (!item) return;
  var e = errorLogItems[Number(item.dataset.index)];
  if (!e) return;
  if (ev.target.closest('.admin-error-toggle')) {
    item.querySelector('.admin-error-stack').classList.toggle('hidden');
  } else if (ev.target.closest('.admin-error-copy')) {
    var text = errorReportText(e);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function() { showToast('Detalle copiado'); }, function() { showToast('No se pudo copiar'); });
    } else {
      showToast('Tu navegador no permite copiar automáticamente');
    }
  } else if (ev.target.closest('.admin-error-resolve')) {
    socket.emit('admin-resolve-error', { id: e.id, resolved: !e.resolved }, function(res) {
      if (!res || !res.ok) { showToast((res && res.error) || 'No se pudo actualizar'); return; }
      updateErrorsBadge(res.pendingCount || 0);
      loadErrorLog(true);
    });
  }
});

adminErrorsOnlyPending.addEventListener('change', function() { loadErrorLog(true); });
adminErrorsRefresh.addEventListener('click', function() { loadErrorLog(true); });
adminErrorsLoadMore.addEventListener('click', function() { loadErrorLog(false); });

// El servidor avisa que se registró un error nuevo: se actualiza el contador (y la lista si está abierta).
socket.on('error-logged', function() {
  if (currentRole !== 'admin') return;
  if (!$('admin-subtab-errores').classList.contains('hidden') && !adminView.classList.contains('hidden')) {
    loadErrorLog(true);
  } else {
    refreshErrorCount();
  }
});

// Errores de esta página en el navegador: se informan al servidor (como mucho una vez cada mensaje).
var reportedClientErrors = {};
function reportClientError(message, stack, where) {
  if (!currentUser || !socket.connected) return;
  var key = String(message).slice(0, 200);
  if (reportedClientErrors[key] || Object.keys(reportedClientErrors).length > 20) return;
  reportedClientErrors[key] = true;
  socket.emit('client-error', { message: String(message || ''), stack: String(stack || ''), where: String(where || '') });
}
window.addEventListener('error', function(ev) {
  if (!ev.error && !ev.message) return; // p. ej. una imagen que no cargó
  reportClientError(ev.message, ev.error && ev.error.stack, (ev.filename || '') + ':' + (ev.lineno || 0) + ':' + (ev.colno || 0));
});
window.addEventListener('unhandledrejection', function(ev) {
  var r = ev.reason;
  reportClientError(r && r.message ? r.message : String(r), r && r.stack, location.pathname);
});

// ===== Panel Admin → Usuarios: el servidor envía las cuentas de a 50 y hace la búsqueda =====
var adminUsersOffset = 0;
var adminUsersLoading = false;
var adminUsersSearchTimer = null;

function adminUserRowHtml(u) {
  var isAdmin = u.role === 'admin';
  var adminDepts = u.adminDepartments || [];
  // Admin solo en algunos de sus departamentos: se indica en cuáles.
  var roleLabel = !isAdmin ? 'User' : (adminDepts.length && adminDepts.length < (u.departments || []).length ? 'Admin de ' + userDepartmentsLabel(adminDepts) : 'Admin');
  var statusHtml = u.status === 'rejected' ? ' <span class="admin-user-role admin-status-rejected">Rechazado</span>'
    : u.status === 'blocked' ? ' <span class="admin-user-role admin-status-rejected">Bloqueado</span>' : '';
  var emailHtml = '<div class="admin-user-username"><i class="fas fa-envelope"></i> ' + escapeHtml(u.email || 'Sin correo') +
    (u.twoFactorEnabled ? ' <span class="admin-user-role">2FA activo</span>' : ' <span class="admin-user-role">2FA pendiente</span>') + '</div>';
  return '<div class="admin-user-item">' +
    '<div class="admin-user-info">' +
      '<div class="admin-user-name">' + escapeHtml(u.displayName || u.username) + '</div>' +
      '<div class="admin-user-username">@' + escapeHtml(u.username) + '  <span class="admin-user-role' + (isAdmin ? ' admin-role-badge' : '') + '">' + escapeHtml(roleLabel) + '</span> <span class="admin-user-role">' + escapeHtml(userDepartmentsLabel(u.departments)) + '</span>' + statusHtml + '</div>' +
      emailHtml +
    '</div>' +
    '<button class="admin-user-edit-btn btn-icon" data-username="' + escapeHtml(u.username) + '" data-displayname="' + escapeHtml(u.displayName || u.username) + '" data-role="' + escapeHtml(u.role) + '" data-departments="' + escapeHtml((u.departments || []).join(',')) + '" data-admin-departments="' + escapeHtml(adminDepts.join(',')) + '" data-fully-managed="' + (u.fullyManaged ? '1' : '0') + '" data-email="' + escapeHtml(u.email || '') + '" data-status="' + escapeHtml(u.status || 'active') + '" title="Editar usuario"><i class="fas fa-pen"></i></button>' +
  '</div>';
}

// reset = primera página (al abrir el panel o al cambiar la búsqueda); si no, agrega la siguiente.
function loadAdminUsers(reset) {
  if (adminUsersLoading && !reset) return;
  if (reset) adminUsersOffset = 0;
  adminUsersLoading = true;
  var query = $('admin-users-search').value.trim();
  var requestOffset = adminUsersOffset;
  socket.emit('get-all-registered-users', { query: query, offset: requestOffset }, function(res) {
    adminUsersLoading = false;
    // Llegó tarde una respuesta de una búsqueda anterior: se ignora.
    if (query !== $('admin-users-search').value.trim() || requestOffset !== adminUsersOffset) return;
    var list = (res && res.users) || [];
    var more = adminUsersList.querySelector('.admin-users-more');
    if (more) more.remove();
    var html = list.map(adminUserRowHtml).join('');
    if (reset) adminUsersList.innerHTML = html || '<div class="admin-table-empty">' + (query ? 'Sin resultados' : 'Sin usuarios') + '</div>';
    else adminUsersList.insertAdjacentHTML('beforeend', html);
    adminUsersOffset = requestOffset + list.length;
    if (res && res.hasMore) {
      adminUsersList.insertAdjacentHTML('beforeend', '<button class="btn-secondary admin-users-more">Cargar más (' + (res.total - adminUsersOffset) + ' restantes)</button>');
    }
  });
}

$('admin-users-search').addEventListener('input', function() {
  clearTimeout(adminUsersSearchTimer);
  adminUsersSearchTimer = setTimeout(function() { loadAdminUsers(true); }, 300);
});

// Un solo manejador para toda la lista (las filas se agregan por páginas).
adminUsersList.addEventListener('click', function(e) {
  if (e.target.closest('.admin-users-more')) { loadAdminUsers(false); return; }
  var btn = e.target.closest('.admin-user-edit-btn');
  if (!btn) return;
  adminEditUsernameDisplay.textContent = btn.dataset.username;
  adminEditDisplayname.value = btn.dataset.displayname;
  adminEditEmail.value = btn.dataset.email || '';
  adminEditEmail.dataset.original = btn.dataset.email || '';
  adminEditRole.value = btn.dataset.role;
  var selectedDepts = btn.dataset.departments ? btn.dataset.departments.split(',') : [];
  var selectedAdminDepts = btn.dataset.adminDepartments ? btn.dataset.adminDepartments.split(',') : [];
  renderDepartmentCheckboxes(adminEditDepartments, selectedDepts, selectedAdminDepts);
  adminEditPassword.value = '';
  adminEditPasswordConfirm.value = '';
  adminEditDeleteBtn.disabled = false;
  adminEditDeleteBtn.innerHTML = '<i class="fas fa-trash"></i> Eliminar usuario';
  setAdminEditBlockButton(btn.dataset.status);
  // Si también pertenece a departamentos que este admin no administra, lo que afecta a toda la cuenta
  // (contraseña, correo, bloquear, eliminar) queda para el administrador general.
  var fullyManaged = btn.dataset.fullyManaged === '1';
  $('admin-edit-limited-note').classList.toggle('hidden', fullyManaged);
  $('admin-edit-pwd-section').classList.toggle('hidden', !fullyManaged);
  adminEditEmail.readOnly = !fullyManaged;
  adminEditDeleteBtn.classList.toggle('hidden', !fullyManaged);
  adminEditBlockBtn.classList.toggle('hidden', !fullyManaged);
  $('admin-edit-sessions-btn').disabled = false;
  adminEditError.textContent = '';
  adminEditOverlay.classList.remove('hidden');
  adminEditDisplayname.focus();
});

function renderAdminPanel() {
  applyAdminScopeUi();
  if (currentSuperAdmin) {
    loadPendingRegistrations();
    loadErrorLog(true);
  }
  loadAlertHistory(true);
  socket.emit('get-stats', function(stats) {
    if (stats) {
      adminStatUsers.textContent = stats.totalUsers;
      adminStatOnline.textContent = stats.connectedUsers;
      adminStatMsgs.textContent = stats.totalMessages === null || stats.totalMessages === undefined ? '—' : stats.totalMessages;
      adminStatRooms.textContent = stats.totalRooms;
    }

    adminDepartmentsList.innerHTML = adminDepartments().map(function(d) {
      var depStats = stats && stats.departments ? stats.departments.find(function(s) { return s.name === d.name; }) : null;
      var meta = depStats ? (depStats.users + ' usuarios · ' + depStats.online + ' conectados · ' + depStats.rooms + ' salas') : '';
      return '<div class="admin-room-item">' +
        '<div class="admin-room-info">' +
          '<span class="admin-room-name">' + escapeHtml(d.displayName || d.name) + '</span>' +
          '<span class="admin-room-meta">' + meta + '</span>' +
        '</div>' +
        '<div class="admin-room-actions">' +
          (currentSuperAdmin ? '<button class="admin-dept-delete-btn btn-icon" data-dept="' + escapeHtml(d.name) + '" title="Eliminar departamento"><i class="fas fa-trash"></i></button>' : '') +
        '</div>' +
      '</div>';
    }).join('') || '<div class="admin-table-empty">Sin departamentos. Crea uno con el botón "Crear departamento".</div>';

    adminDepartmentsList.querySelectorAll('.admin-dept-delete-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var name = btn.dataset.dept;
        if (!confirm('¿Eliminar el departamento "' + departmentLabel(name) + '"?\nSolo se puede eliminar si no tiene usuarios asignados; sus salas y mensajes se borrarán.')) return;
        socket.emit('admin-delete-department', { name: name }, function(res) {
          if (!res.ok) { showToast(res.error); return; }
          showToast('Departamento eliminado');
          renderAdminPanel();
        });
      });
    });
  });

  loadAdminUsers(true);

  adminRoomsList.innerHTML = rooms.map(function(r) {
    var actions = '';
    if (r.name !== 'general' && canAdminRoom(r)) {
      if (!r.temporary) {
        actions += '<button class="admin-room-lock-btn btn-icon" data-room="' + escapeHtml(r.name) + '" data-haspassword="' + r.hasPassword + '" title="' + (r.hasPassword ? 'Cambiar contraseña' : 'Poner contraseña') + '"><i class="fas ' + (r.hasPassword ? 'fa-lock' : 'fa-unlock') + '"></i></button>';
      }
      actions += '<button class="admin-room-delete-btn btn-icon" data-room="' + escapeHtml(r.name) + '" title="Eliminar sala"><i class="fas fa-trash"></i></button>';
    }
    return '<div class="admin-room-item">' +
      '<div class="admin-room-info">' +
        '<span class="admin-room-name">#' + escapeHtml(r.name) + '</span>' +
        '<span class="admin-room-meta">' + (r.temporary ? 'Temporal' : 'Fija') + (r.hasPassword ? ' · 🔒' : '') + ' · ' + escapeHtml(departmentLabel(r.department)) + '</span>' +
      '</div>' +
      '<div class="admin-room-actions">' + actions + '</div>' +
    '</div>';
  }).join('');

  adminRoomsList.querySelectorAll('.admin-room-lock-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      adminRoomPwdName.textContent = '#' + btn.dataset.room;
      adminRoomPwdStatus.textContent = btn.dataset.haspassword === 'true' ? 'Protegida' : 'Abierta';
      adminRoomPwdInput.value = '';
      adminRoomPwdError.textContent = '';
      adminRoomPwdOverlay.classList.remove('hidden');
      adminRoomPwdInput.focus();
      adminRoomPwdConfirm.dataset.room = btn.dataset.room;
    });
  });

  adminRoomsList.querySelectorAll('.admin-room-delete-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var roomName = btn.dataset.room;
      if (confirm('¿Eliminar la sala #' + roomName + '?\nSe borrarán todos sus mensajes.')) {
        socket.emit('delete-room', { name: roomName }, function(res) {
          if (!res.ok) { showToast(res.error); return; }
          showToast('Sala #' + roomName + ' eliminada');
        });
      }
    });
  });
}

// ===================== ADMIN EDIT USER MODAL =====================

adminEditConfirm.addEventListener('click', function() {
  var username = adminEditUsernameDisplay.textContent;
  var displayName = adminEditDisplayname.value.trim();
  var email = adminEditEmail.value.trim();
  var role = adminEditRole.value;
  var departments = Array.from(adminEditDepartments.querySelectorAll('.dept-member:checked')).map(function(cb) { return cb.value; });
  var adminDepartments = role === 'admin'
    ? Array.from(adminEditDepartments.querySelectorAll('.dept-admin:checked')).map(function(cb) { return cb.value; })
    : [];
  var newPassword = adminEditPassword.value;
  var newPasswordConfirm = adminEditPasswordConfirm.value;

  if (!displayName) { adminEditError.textContent = 'Nombre requerido'; return; }
  // Un correo que no cambió se deja pasar (cuentas antiguas con otro dominio); el servidor aplica la misma regla.
  var adminEmailError = email && email.toLowerCase() !== (adminEditEmail.dataset.original || '').toLowerCase() ? emailError(email) : null;
  if (adminEmailError) { adminEditError.textContent = adminEmailError; return; }

  if (newPassword || newPasswordConfirm) {
    if (newPassword.length < 8) { adminEditError.textContent = 'Contraseña: mínimo 8 caracteres'; return; }
    if (newPassword !== newPasswordConfirm) { adminEditError.textContent = 'Las contraseñas no coinciden'; return; }
  }

  adminEditConfirm.disabled = true;
  adminEditConfirm.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';

  socket.emit('update-user', { username, displayName, email, role, departments, adminDepartments }, function(res) {
    if (!res.ok) {
      adminEditConfirm.disabled = false;
      adminEditConfirm.innerHTML = '<i class="fas fa-save"></i> Guardar';
      adminEditError.textContent = res.error;
      return;
    }

    function done() {
      adminEditConfirm.disabled = false;
      adminEditConfirm.innerHTML = '<i class="fas fa-save"></i> Guardar';
      adminEditOverlay.classList.add('hidden');
      renderAdminPanel();
    }

    if (newPassword) {
      socket.emit('admin-reset-password', { username, newPassword }, function(pwdRes) {
        if (!pwdRes.ok) {
          showToast('Usuario actualizado, pero error al cambiar contraseña: ' + pwdRes.error);
        } else {
          showToast('Usuario y contraseña actualizados');
        }
        done();
      });
    } else {
      showToast('Usuario actualizado');
      done();
    }
  });
});

function closeAdminEdit() {
  adminEditOverlay.classList.add('hidden');
}

adminEditCancel.addEventListener('click', closeAdminEdit);
adminEditClose.addEventListener('click', closeAdminEdit);
adminEditOverlay.addEventListener('click', function(e) {
  if (e.target === adminEditOverlay) closeAdminEdit();
});

adminEditDisplayname.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') adminEditConfirm.click();
});

adminEditDeleteBtn.addEventListener('click', function() {
  var username = adminEditUsernameDisplay.textContent;
  if (!confirm('¿Eliminar al usuario "' + username + '"?\nSe eliminará su cuenta permanentemente.')) return;

  adminEditDeleteBtn.disabled = true;
  adminEditDeleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Eliminando...';

  socket.emit('admin-delete-user', { username: username }, function(res) {
    adminEditDeleteBtn.disabled = false;
    adminEditDeleteBtn.innerHTML = '<i class="fas fa-trash"></i> Eliminar usuario';
    if (!res.ok) { adminEditError.textContent = res.error; return; }
    showToast('Usuario ' + username + ' eliminado');
    adminEditOverlay.classList.add('hidden');
    renderAdminPanel();
  });
});

$('admin-edit-sessions-btn').addEventListener('click', function() {
  var btn = this;
  var username = adminEditUsernameDisplay.textContent;
  if (!confirm('¿Cerrar todas las sesiones de "' + username + '"?\nSi está conectado se le cerrará el chat, y en todos sus equipos tendrá que volver a ingresar con contraseña y código.')) return;
  btn.disabled = true;
  socket.emit('admin-revoke-sessions', { username: username }, function(res) {
    btn.disabled = false;
    if (!res.ok) { adminEditError.textContent = res.error; return; }
    showToast('Sesiones de ' + username + ' cerradas');
  });
});

// Solo las cuentas activas se pueden bloquear; las bloqueadas muestran "Desbloquear".
function setAdminEditBlockButton(status) {
  adminEditBlockBtn.dataset.status = status || 'active';
  adminEditBlockBtn.disabled = false;
  adminEditBlockBtn.classList.toggle('hidden', status !== 'active' && status !== 'blocked');
  adminEditBlockBtn.innerHTML = status === 'blocked'
    ? '<i class="fas fa-unlock"></i> Desbloquear usuario'
    : '<i class="fas fa-ban"></i> Bloquear usuario';
}

adminEditBlockBtn.addEventListener('click', function() {
  var username = adminEditUsernameDisplay.textContent;
  var block = adminEditBlockBtn.dataset.status !== 'blocked';
  if (block && !confirm('¿Bloquear al usuario "' + username + '"?\nSe cerrará su sesión y no podrá volver a ingresar hasta que lo desbloquees.')) return;

  adminEditBlockBtn.disabled = true;
  adminEditBlockBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + (block ? 'Bloqueando...' : 'Desbloqueando...');

  socket.emit('admin-block-user', { username: username, blocked: block }, function(res) {
    if (!res.ok) {
      setAdminEditBlockButton(adminEditBlockBtn.dataset.status);
      adminEditError.textContent = res.error;
      return;
    }
    setAdminEditBlockButton(block ? 'blocked' : 'active');
    showToast('Usuario ' + username + (block ? ' bloqueado' : ' desbloqueado'));
    renderAdminPanel();
  });
});

adminEditPassword.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') adminEditPasswordConfirm.focus();
});
adminEditPasswordConfirm.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') adminEditConfirm.click();
});

// ===================== END ADMIN EDIT =====================

// ===================== CREATE DEPARTMENT MODAL =====================

createDeptBtn.addEventListener('click', function() {
  createDeptDisplayname.value = '';
  createDeptError.textContent = '';
  createDeptModalOverlay.classList.remove('hidden');
  createDeptDisplayname.focus();
});

function closeCreateDeptModal() {
  createDeptModalOverlay.classList.add('hidden');
}

createDeptClose.addEventListener('click', closeCreateDeptModal);
createDeptCancel.addEventListener('click', closeCreateDeptModal);
createDeptModalOverlay.addEventListener('click', function(e) {
  if (e.target === createDeptModalOverlay) closeCreateDeptModal();
});
createDeptDisplayname.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') createDeptConfirm.click();
});

createDeptConfirm.addEventListener('click', function() {
  var displayName = createDeptDisplayname.value.trim();
  if (!displayName) { createDeptError.textContent = 'Ingresa un nombre'; return; }

  createDeptConfirm.disabled = true;
  createDeptConfirm.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creando...';

  socket.emit('admin-create-department', { name: displayName, displayName: displayName }, function(res) {
    createDeptConfirm.disabled = false;
    createDeptConfirm.innerHTML = '<i class="fas fa-check"></i> Crear';
    if (!res.ok) { createDeptError.textContent = res.error; return; }
    if (!departments.find(function(d) { return d.name === res.name; })) {
      departments.push({ name: res.name, displayName: res.displayName });
    }
    closeCreateDeptModal();
    showToast('Departamento "' + res.displayName + '" creado');
    renderAdminPanel();
  });
});

// ===================== END CREATE DEPARTMENT MODAL =====================

// ===================== ADMIN ROOM PASSWORD MODAL =====================

function closeAdminRoomPwdModal() {
  adminRoomPwdOverlay.classList.add('hidden');
}

adminRoomPwdClose.addEventListener('click', closeAdminRoomPwdModal);
adminRoomPwdCancel.addEventListener('click', closeAdminRoomPwdModal);
adminRoomPwdOverlay.addEventListener('click', function(e) {
  if (e.target === adminRoomPwdOverlay) closeAdminRoomPwdModal();
});

adminRoomPwdInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') adminRoomPwdConfirm.click();
});

adminRoomPwdConfirm.addEventListener('click', function() {
  var roomName = adminRoomPwdConfirm.dataset.room;
  var password = adminRoomPwdInput.value;

  adminRoomPwdConfirm.disabled = true;
  adminRoomPwdConfirm.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';

  socket.emit('admin-set-room-password', { name: roomName, password: password || null }, function(res) {
    adminRoomPwdConfirm.disabled = false;
    adminRoomPwdConfirm.innerHTML = '<i class="fas fa-check"></i> Guardar';
    if (!res.ok) { adminRoomPwdError.textContent = res.error; return; }
    closeAdminRoomPwdModal();
    showToast(password ? 'Contraseña asignada a #' + roomName : 'Contraseña quitada de #' + roomName);
  });
});

// ===================== END ADMIN ROOM PASSWORD MODAL =====================
