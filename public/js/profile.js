// Perfil propio (nombre, foto, contraseña, ubicación), salir y botón de alerta.

function openNameModal() {
  nameModalInput.value = currentDisplayName || currentUser;
  nameModalError.textContent = '';
  nameModalOverlay.classList.remove('hidden');
  nameModalInput.focus();
  nameModalInput.select();
}

function closeNameModal() {
  nameModalOverlay.classList.add('hidden');
}

editNameBtn.addEventListener('click', openNameModal);
nameModalClose.addEventListener('click', closeNameModal);
nameModalCancel.addEventListener('click', closeNameModal);
nameModalOverlay.addEventListener('click', function(e) {
  if (e.target === nameModalOverlay) closeNameModal();
});
nameModalInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') nameModalConfirm.click();
});
nameModalConfirm.addEventListener('click', function() {
  var newName = nameModalInput.value.trim();
  if (!newName) { nameModalError.textContent = 'Ingresa un nombre'; return; }
  if (newName.length > 40) { nameModalError.textContent = 'Maximo 40 caracteres'; return; }
  nameModalConfirm.disabled = true;
  nameModalConfirm.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  socket.emit('update-display-name', { displayName: newName }, function(res) {
    nameModalConfirm.disabled = false;
    nameModalConfirm.innerHTML = '<i class="fas fa-check"></i> Guardar';
    if (!res.ok) {
      nameModalError.textContent = res.error || 'Error';
      return;
    }
    currentDisplayName = res.displayName;
    displayName.textContent = res.displayName;
    closeNameModal();
    showToast('Nombre actualizado');
  });
});

avatarInput.addEventListener('change', function() {
  var file = avatarInput.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showToast('La imagen debe ser menor a 2 MB');
    avatarInput.value = '';
    return;
  }
  var formData = new FormData();
  formData.append('file', file);
  fetch('/api/upload', { method: 'POST', body: formData, headers: uploadHeaders() })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.error) { showToast(data.error); return; }
      socket.emit('update-avatar', { avatar: data.url }, function(res2) {
        if (res2.ok) {
          currentAvatar = data.url;
          updateHeaderAvatar();
          showToast('Avatar actualizado');
        }
      });
    })
    .catch(function() { showToast('Error al subir avatar'); })
    .finally(function() { avatarInput.value = ''; });
});

headerAvatar.addEventListener('click', function() {
  showToast('La imagen de avatar debe ser de máximo 2 MB');
  avatarInput.click();
});

var headerMenuToggle = $('header-menu-toggle');
var headerUserMenu = $('header-user-menu');

headerMenuToggle.addEventListener('click', function(e) {
  e.stopPropagation();
  headerUserMenu.classList.toggle('open');
});

headerUserMenu.addEventListener('click', function(e) {
  if (e.target.closest('.header-edit-btn')) {
    headerUserMenu.classList.remove('open');
  }
});

document.addEventListener('click', function(e) {
  if (headerUserMenu.classList.contains('open') && !headerUserMenu.contains(e.target) && e.target !== headerMenuToggle && !headerMenuToggle.contains(e.target)) {
    headerUserMenu.classList.remove('open');
  }
});

function openPwdModal() {
  pwdChangeCurrent.value = '';
  pwdChangeNew.value = '';
  pwdChangeConfirm.value = '';
  pwdChangeError.textContent = '';
  pwdChangeOverlay.classList.remove('hidden');
  pwdChangeCurrent.focus();
}

function closePwdModal() {
  pwdChangeOverlay.classList.add('hidden');
}

changePwdBtn.addEventListener('click', openPwdModal);
pwdChangeClose.addEventListener('click', closePwdModal);
pwdChangeCancel.addEventListener('click', closePwdModal);
pwdChangeOverlay.addEventListener('click', function(e) {
  if (e.target === pwdChangeOverlay) closePwdModal();
});

pwdChangeCurrent.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') pwdChangeNew.focus();
});
pwdChangeNew.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') pwdChangeConfirm.focus();
});
pwdChangeConfirm.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') pwdChangeConfirmBtn.click();
});

pwdChangeConfirmBtn.addEventListener('click', function() {
  var current = pwdChangeCurrent.value;
  var newPwd = pwdChangeNew.value;
  var confirm = pwdChangeConfirm.value;

  if (!current) { pwdChangeError.textContent = 'Ingresa tu contraseña actual'; return; }
  if (!newPwd || newPwd.length < 8) { pwdChangeError.textContent = 'Mínimo 8 caracteres'; return; }
  if (newPwd !== confirm) { pwdChangeError.textContent = 'Las contraseñas no coinciden'; return; }

  pwdChangeConfirmBtn.disabled = true;
  pwdChangeConfirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

  socket.emit('change-password', { currentPassword: current, newPassword: newPwd }, function(res) {
    pwdChangeConfirmBtn.disabled = false;
    pwdChangeConfirmBtn.innerHTML = '<i class="fas fa-check"></i> Cambiar';
    if (!res.ok) {
      pwdChangeError.textContent = res.error;
      return;
    }
    closePwdModal();
    showToast('Contraseña actualizada');
  });
});

logoutBtn.addEventListener('click', () => {
  if (!confirm('Salir del chat?')) return;
  var done = false;
  function finish() {
    if (done) return;
    done = true;
    clearStoredSession();
    location.reload();
  }
  socket.emit('logout', finish);
  setTimeout(finish, 2000); // si el servidor no responde, igual se sale
});

function playPanicSound() {
  try {
    panicAudio.currentTime = 0;
    panicAudio.play();
  } catch(e) {}
}

function showPanicModal(data) {
  var who = data.displayName || data.username;
  if (data.departmentDisplayName) who += ' (' + data.departmentDisplayName + ')';
  panicModalMessage.textContent = 'El usuario ' + who + ' está pidiendo asistencia';
  var loc = data.location && data.location.trim() ? data.location : 'Indeterminada';
  panicModalLocation.innerHTML = 'Ubicación: <strong>' + escapeHtml(loc) + '</strong>';
  panicModalTime.textContent = formatTime(data.timestamp);
  panicModalOverlay.classList.remove('hidden');
}

function closePanicModal() {
  panicModalOverlay.classList.add('hidden');
  panicAudio.pause();
  panicAudio.currentTime = 0;
}

// Después de enviar una alerta hay que esperar 30 segundos para otra (botón y triple clic comparten la espera;
// el servidor también la exige).
var PANIC_COOLDOWN_MS = 30000;
var panicLastTrigger = 0;
var panicBtnHtml = panicBtn.innerHTML;
var panicCountdownTimer = null;

function panicSecondsLeft() {
  return Math.max(0, Math.ceil((panicLastTrigger + PANIC_COOLDOWN_MS - Date.now()) / 1000));
}

function startPanicCountdown() {
  clearInterval(panicCountdownTimer);
  function tick() {
    var left = panicSecondsLeft();
    if (left <= 0) {
      clearInterval(panicCountdownTimer);
      panicBtn.disabled = false;
      panicBtn.innerHTML = panicBtnHtml;
      return;
    }
    panicBtn.disabled = true;
    panicBtn.innerHTML = '<i class="fas fa-hourglass-half"></i> Alerta enviada (' + left + 's)';
  }
  tick();
  panicCountdownTimer = setInterval(tick, 1000);
}

function sendPanicAlert() {
  if (!currentDepartment) return false;
  if (panicSecondsLeft() > 0) {
    showToast('Ya enviaste una alerta. Podrás enviar otra en ' + panicSecondsLeft() + ' segundos.');
    return false;
  }
  panicLastTrigger = Date.now();
  startPanicCountdown();
  panicModalMessage.textContent = 'Has enviado una alerta de asistencia';
  panicModalLocation.innerHTML = 'Ubicación: <strong>' + escapeHtml(currentLocation || 'Indeterminada') + '</strong>';
  panicModalTime.textContent = formatTime(new Date().toISOString());
  panicModalOverlay.classList.remove('hidden');
  socket.emit('panic-alert', function(res) {
    if (res && !res.ok && res.waitSeconds) {
      // El servidor aún cuenta una alerta anterior (p. ej. se recargó la página): esta no se envió.
      panicLastTrigger = Date.now() + res.waitSeconds * 1000 - PANIC_COOLDOWN_MS;
      startPanicCountdown();
      closePanicModal();
      showToast('Ya enviaste una alerta. Podrás enviar otra en ' + res.waitSeconds + ' segundos.');
    } else if (res && !res.ok) {
      panicLastTrigger = 0;
      startPanicCountdown();
      closePanicModal();
      if (res.error) showToast(res.error);
    }
  });
  return true;
}

panicBtn.addEventListener('click', sendPanicAlert);

panicModalOk.addEventListener('click', closePanicModal);
panicModalClose.addEventListener('click', closePanicModal);
panicModalOverlay.addEventListener('click', function(e) {
  if (e.target === panicModalOverlay) closePanicModal();
});

// Triple clic rápido en zona gris del chat para activar alerta
var panicClickTimes = [];
var PANIC_CLICK_WINDOW = 800;

document.addEventListener('click', function(e) {
  if (!currentUser || !currentDepartment) return;
  if (panicSecondsLeft() > 0) return;

  var tag = e.target.tagName;
  if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'A') return;

  var el = e.target;
  while (el) {
    if (el.id === 'sidebar-rooms' || el.id === 'chat-header' || el.classList.contains('modal-overlay') || el.classList.contains('modal-box')) return;
    el = el.parentElement;
  }

  panicClickTimes.push(Date.now());
  panicClickTimes = panicClickTimes.filter(function(t) { return Date.now() - t <= PANIC_CLICK_WINDOW; });

  if (panicClickTimes.length >= 3) {
    panicClickTimes = [];
    if (!sendPanicAlert()) return;

    var flash = document.createElement('div');
    flash.style.cssText = 'position:fixed;inset:0;border:6px solid #ef4444;border-radius:0;pointer-events:none;z-index:1999;animation:fadeOut 0.6s forwards;';
    document.body.appendChild(flash);
    setTimeout(function() { flash.remove(); }, 700);
  }
});

editLocationBtn.addEventListener('click', function() {
  locationModalInput.value = currentLocation;
  locationModalStatus.textContent = currentLocation ? 'Ubicación actual: ' + currentLocation : '';
  locationModalError.textContent = '';
  locationModalOverlay.classList.remove('hidden');
  locationModalInput.focus();
  locationModalInput.select();
});

locationModalConfirm.addEventListener('click', function() {
  var loc = locationModalInput.value.trim();
  if (loc.length > 100) { locationModalError.textContent = 'Máximo 100 caracteres'; return; }
  locationModalConfirm.disabled = true;
  locationModalConfirm.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  socket.emit('update-location', { location: loc }, function(res) {
    locationModalConfirm.disabled = false;
    locationModalConfirm.innerHTML = '<i class="fas fa-check"></i> Guardar';
    if (!res.ok) { locationModalError.textContent = res.error; return; }
    currentLocation = res.location;
    locationModalOverlay.classList.add('hidden');
    showToast('Ubicación actualizada');
  });
});

locationModalClear.addEventListener('click', function() {
  locationModalInput.value = '';
  locationModalStatus.textContent = '';
  locationModalInput.focus();
});

function closeLocationModal() {
  locationModalOverlay.classList.add('hidden');
}

locationModalClose.addEventListener('click', closeLocationModal);
locationModalOverlay.addEventListener('click', function(e) {
  if (e.target === locationModalOverlay) closeLocationModal();
});

locationModalInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') locationModalConfirm.click();
});
