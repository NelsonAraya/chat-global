// Utilidades: escapar texto, formatos de fecha y tamaño, avatares, avisos y selector de departamento.

// Escapa también comillas: el resultado se usa tanto en texto como dentro de atributos HTML.
function escapeHtml(text) {
  return String(text === null || text === undefined ? '' : text).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// Dominios de correo permitidos: los define el servidor (ALLOWED_EMAIL_DOMAINS); este es solo el valor inicial.
var allowedEmailDomains = ['cormudesi.cl', 'gmail.com'];

function allowedEmailDomainsText() {
  return allowedEmailDomains.map(function(d) { return '@' + d; }).join(' o ');
}

// Misma regla que el servidor: formato estricto y solo dominios permitidos. Devuelve el error o null.
function emailError(email) {
  email = String(email || '').trim().toLowerCase();
  var at = email.lastIndexOf('@');
  var local = email.slice(0, at);
  var domain = email.slice(at + 1);
  if (at <= 0 || email.length > 254 || local.length > 64 || !/^[a-z0-9_%+-]+(\.[a-z0-9_%+-]+)*$/.test(local)) return 'Correo no válido';
  if (allowedEmailDomains.indexOf(domain) === -1) return 'Solo se aceptan correos ' + allowedEmailDomainsText();
  return null;
}

function loadEmailDomains() {
  socket.emit('get-email-domains', function(domains) {
    if (Array.isArray(domains) && domains.length > 0) allowedEmailDomains = domains;
    var placeholder = 'Correo ' + allowedEmailDomainsText() + '...';
    registerEmail.placeholder = placeholder;
    $('twofactor-email').placeholder = placeholder;
  });
}

// Solo se muestran archivos subidos a este servidor; cualquier otra URL (p. ej. "javascript:") se descarta.
function safeUploadUrl(url) {
  return typeof url === 'string' && /^\/uploads\/[A-Za-z0-9._-]+$/.test(url) ? url : null;
}

function formatTime(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatDate(isoString) {
  try {
    const d = new Date(isoString);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return 'ahora';
    if (diff < 3600) return Math.floor(diff / 60) + 'm';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h';
    if (diff < 172800) return 'ayer';
    return d.toLocaleDateString('es-CL', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

function stringToColor(str) {
  var hash = 0;
  for (var i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  var colors = ['#2563eb','#dc2626','#059669','#d97706','#7c3aed','#db2777','#0891b2','#ca8a04'];
  return colors[Math.abs(hash) % colors.length];
}

function getAvatarHtml(username, avatarUrl, size) {
  if (avatarUrl) {
    return '<img src="' + escapeHtml(avatarUrl) + '" class="avatar avatar-' + size + '" alt="" />';
  }
  var color = stringToColor(username);
  var initial = username.charAt(0).toUpperCase();
  return '<span class="avatar avatar-' + size + ' avatar-initial" style="background:' + color + '">' + initial + '</span>';
}

function updateHeaderDepartment() {
  if (currentDepartmentDisplayName) {
    headerDepartment.textContent = currentDepartmentDisplayName;
    headerDepartment.classList.remove('hidden');
    panicBtn.title = 'La alerta solo la verán los usuarios de ' + currentDepartmentDisplayName + ' y los administradores';
  } else {
    headerDepartment.classList.add('hidden');
  }
  // La alerta va a un departamento: quien no tiene uno no puede enviarla.
  panicBtn.classList.toggle('hidden', !currentDepartment);
  switchDeptBtn.classList.toggle('hidden', myDepartments.length <= 1);
}

function openDepartmentSelect(mode, deptList, onPick) {
  departmentSelectError.textContent = '';
  if (mode === 'login') {
    departmentSelectTitle.innerHTML = '<i class="fas fa-building"></i> Selecciona tu departamento';
    departmentSelectIntro.textContent = 'Tu cuenta tiene acceso a varios departamentos/centros. Elige con cuál quieres ingresar ahora.';
    departmentSelectClose.classList.add('hidden');
  } else {
    departmentSelectTitle.innerHTML = '<i class="fas fa-right-left"></i> Cambiar de departamento';
    departmentSelectIntro.textContent = 'Selecciona el departamento/centro al que quieres cambiarte.';
    departmentSelectClose.classList.remove('hidden');
  }
  departmentSelectList.innerHTML = (deptList || []).map(function(d) {
    return '<button type="button" class="department-select-item" data-dept="' + escapeHtml(d.name) + '"><i class="fas fa-building"></i> ' + escapeHtml(d.displayName || d.name) + '</button>';
  }).join('');
  departmentSelectList.querySelectorAll('.department-select-item').forEach(function(btn) {
    btn.addEventListener('click', function() {
      departmentSelectError.textContent = '';
      btn.disabled = true;
      onPick(btn.dataset.dept, function(err) {
        btn.disabled = false;
        departmentSelectError.textContent = err || 'Error';
      });
    });
  });
  departmentSelectOverlay.classList.remove('hidden');
}

function closeDepartmentSelect() {
  departmentSelectOverlay.classList.add('hidden');
}

departmentSelectClose.addEventListener('click', closeDepartmentSelect);
departmentSelectOverlay.addEventListener('click', function(e) {
  if (e.target === departmentSelectOverlay && !departmentSelectClose.classList.contains('hidden')) closeDepartmentSelect();
});

switchDeptBtn.addEventListener('click', function() {
  openDepartmentSelect('switch', myDepartments, function(dept, onError) {
    socket.emit('switch-department', { department: dept }, function(res) {
      if (!res.ok) { onError(res.error); return; }
      closeDepartmentSelect();
      showToast('Cambiaste de departamento');
    });
  });
});

function updateHeaderAvatar() {
  if (currentAvatar) {
    headerAvatar.innerHTML = '<img src="' + escapeHtml(currentAvatar) + '" class="avatar avatar-32" alt="" />';
  } else {
    var color = stringToColor(currentUser);
    var initial = currentUser.charAt(0).toUpperCase();
    headerAvatar.innerHTML = '<span class="avatar avatar-32 avatar-initial" style="background:' + color + '">' + initial + '</span>';
  }
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function showToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = '<i class="fas fa-info-circle"></i> ' + escapeHtml(msg);
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function updateTitle() {
  var roomTotal = 0;
  for (var k in roomUnreadCounts) {
    if (roomUnreadCounts.hasOwnProperty(k)) roomTotal += roomUnreadCounts[k];
  }
  var total = unreadTotal + roomTotal;
  document.title = total > 0
    ? '(' + total + ') Chat Cormudesi'
    : 'Chat Cormudesi';
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    unreadTotal = 0;
    roomUnreadCounts = {};
    renderRooms();
    updateTitle();
    updateConvTotalBadge();
    updateRoomTotalBadge();
  }
});
