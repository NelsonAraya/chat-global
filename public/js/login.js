// Ingreso: login, sesión guardada, doble factor, registro y Términos y Condiciones.

function loadDepartments(callback) {
  socket.emit('get-departments', function(list) {
    departments = list || [];
    if (callback) callback(departments);
  });
}

document.querySelectorAll('.login-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const form = tab.dataset.form;
    document.querySelectorAll('.login-form-box').forEach(f => f.classList.add('hidden'));
    $(form + '-form').classList.remove('hidden');
    loginError.textContent = '';
  });
});

// La autorización para subir va en una cabecera: así el servidor la revisa antes de recibir el archivo.
function uploadHeaders() {
  return { 'X-Upload-Token': currentUploadToken || '' };
}

// Los archivos (/uploads) solo se sirven con sesión: se canjea el token de subida por una cookie
// antes de mostrar el chat, para que las imágenes y avatares carguen desde el primer momento.
function completeLogin(username, res, opts) {
  var token = res.uploadToken || null;
  if (!token) return showChatAfterLogin(username, res, opts);
  fetch('/api/file-access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: token }),
    credentials: 'same-origin'
  }).catch(function() {}).then(function() {
    showChatAfterLogin(username, res, opts);
  });
}

function showChatAfterLogin(username, res, opts) {
  opts = opts || {};
  currentUser = username.toLowerCase();
  currentUploadToken = res.uploadToken || null;
  currentDisplayName = res.displayName || username;
  currentAvatar = res.avatar || null;
  currentLocation = res.location || '';
  currentRole = res.role || 'user';
  currentSuperAdmin = !!res.superAdmin;
  currentDepartment = res.department || null;
  currentDepartmentDisplayName = res.departmentDisplayName || null;
  myDepartments = res.departments || [];
  myAdminDepartments = res.adminDepartments || [];
  rooms = res.rooms || [];
  loginScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
  displayName.textContent = currentDisplayName;
  updateHeaderDepartment();
  updateHeaderAvatar();
  if (currentRole === 'admin') {
    adminTab.classList.remove('hidden');
    applyAdminScopeUi();
    refreshErrorCount();
  } else {
    adminTab.classList.add('hidden');
  }
  if (res.sessionToken) storeSession(res.sessionToken, res.sessionRemember);
  initializeChat();
  socket.emit('get-room-unreads', function(counts) {
    roomUnreadCounts = Object.assign(counts || {}, roomUnreadCounts); // no pisa los avisos que ya llegaron
    renderRooms();
    updateRoomTotalBadge();
  });
}

function doLogin(username, password, callback) {
  loginBtn.disabled = true;
  loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Conectando...';

  socket.emit('login', { username, password }, (res) => {
    loginBtn.disabled = false;
    loginBtn.innerHTML = '<i class="fas fa-arrow-right"></i> Ingresar';

    if (!res.ok) {
      callback?.({ ok: false, error: res.error });
      return;
    }

    continueLogin(username, res, {}, callback);
  });
}

// Sigue el ingreso después de que el servidor aceptó la contraseña: código por correo
// (doble factor), selección de departamento si tiene varios y, por último, entrar al chat.
function continueLogin(username, res, opts, callback) {
  if (res.requireTwoFactor) {
    openTwoFactor(username, res, opts, callback);
    return;
  }

  if (res.requireDepartment) {
    openDepartmentSelect('login', res.departments, function(dept, onError) {
      socket.emit('select-department', { department: dept }, function(res2) {
        if (!res2.ok) { onError(res2.error); return; }
        completeLogin(username, res2, opts);
        closeDepartmentSelect();
        if (res.twoFactorActivated) showToast('Doble factor activado');
        callback?.({ ok: true });
      });
    });
    return;
  }

  completeLogin(username, res, opts);
  if (res.twoFactorActivated) showToast('Doble factor activado');
  callback?.({ ok: true });
}

// ===================== SESIÓN GUARDADA =====================
// El navegador guarda solo un token de sesión (nunca la contraseña). Sin "Recordar este equipo" va en
// sessionStorage (se borra al cerrar la pestaña); con la casilla, en localStorage (7 días).
var SESSION_KEY = 'chat_session';

function storeSession(token, remember) {
  try {
    if (remember) {
      localStorage.setItem(SESSION_KEY, token);
      sessionStorage.removeItem(SESSION_KEY);
    } else {
      sessionStorage.setItem(SESSION_KEY, token);
      localStorage.removeItem(SESSION_KEY);
    }
  } catch (e) {}
}

function getStoredSession() {
  try {
    return sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
  } catch (e) {
    return null;
  }
}

function clearStoredSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
    // Versiones anteriores guardaban usuario y contraseña en el navegador: se eliminan.
    localStorage.removeItem('chat_user');
    localStorage.removeItem('chat_pass');
  } catch (e) {}
}

try {
  localStorage.removeItem('chat_user');
  localStorage.removeItem('chat_pass');
} catch (e) {}

function tryAutoLogin() {
  var token = getStoredSession();
  if (!token) return false;
  loginBtn.disabled = true;
  loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Conectando...';
  socket.emit('resume-session', { token: token }, function(res) {
    loginBtn.disabled = false;
    loginBtn.innerHTML = '<i class="fas fa-arrow-right"></i> Ingresar';
    if (!res.ok) {
      if (res.expired) clearStoredSession();
      if (res.error) loginError.textContent = res.error;
      loginUsername.focus();
      return;
    }
    continueLogin(res.username, res, {}, function(r) {
      if (!r.ok) loginError.textContent = r.error;
    });
  });
  return true;
}

// ===================== DOBLE FACTOR (código por correo) =====================

const twofactorIntro = $('twofactor-intro');
const twofactorEmailStep = $('twofactor-email-step');
const twofactorEmail = $('twofactor-email');
const twofactorEmailBtn = $('twofactor-email-btn');
const twofactorCodeStep = $('twofactor-code-step');
const twofactorCode = $('twofactor-code');
const twofactorTimer = $('twofactor-timer');
const twofactorVerifyBtn = $('twofactor-verify-btn');
const twofactorResendBtn = $('twofactor-resend-btn');
const twofactorCancelBtn = $('twofactor-cancel-btn');

let twoFactorState = null; // { username, opts, callback, setup, ticket }
let twoFactorInterval = null;

// Pase del paso del código: en el celular, al ir a la app de correo el navegador corta la conexión (y a veces
// recarga la página al volver). El pase se manda en cada paso para que el servidor recuerde que la contraseña
// ya se comprobó, y se guarda en sessionStorage para retomar el paso si la página se recargó.
var TWO_FACTOR_KEY = 'chat_2fa';

function storeTwoFactorTicket(username, ticket) {
  try { sessionStorage.setItem(TWO_FACTOR_KEY, JSON.stringify({ username: username, ticket: ticket })); } catch (e) {}
}

function getStoredTwoFactorTicket() {
  try {
    var saved = JSON.parse(sessionStorage.getItem(TWO_FACTOR_KEY) || 'null');
    return saved && saved.username && saved.ticket ? saved : null;
  } catch (e) {
    return null;
  }
}

function clearStoredTwoFactorTicket() {
  try { sessionStorage.removeItem(TWO_FACTOR_KEY); } catch (e) {}
}

function twoFactorAuth(extra) {
  var auth = twoFactorState ? { username: twoFactorState.username, ticket: twoFactorState.ticket } : {};
  return Object.assign(auth, extra || {});
}

// Al cargar la página: si quedó a medio ingresar el código, vuelve a ese paso sin pedir la contraseña.
function tryRestoreTwoFactor() {
  var saved = getStoredTwoFactorTicket();
  if (!saved) return false;
  socket.emit('two-factor-restore', { username: saved.username, ticket: saved.ticket }, function(res) {
    if (!res || !res.ok) {
      clearStoredTwoFactorTicket();
      loginUsername.focus();
      return;
    }
    res.twoFactorTicket = saved.ticket;
    openTwoFactor(saved.username, res, {}, function(r) {
      if (!r.ok) loginError.textContent = r.error;
    });
  });
  return true;
}

function showLoginBox(formId) {
  document.querySelectorAll('.login-form-box').forEach(f => f.classList.add('hidden'));
  $(formId).classList.remove('hidden');
  document.querySelector('.login-tabs').classList.toggle('hidden', formId === 'twofactor-form');
}

function openTwoFactor(username, res, opts, callback) {
  twoFactorState = { username: username, opts: opts, callback: callback, setup: !!res.setup, ticket: res.twoFactorTicket || null };
  if (res.twoFactorTicket) storeTwoFactorTicket(username, res.twoFactorTicket);
  loginError.textContent = '';
  showLoginBox('twofactor-form');
  if (res.needEmail) {
    twofactorIntro.textContent = 'Para proteger tu cuenta debes activar el doble factor. Indica tu correo y te enviaremos un código para verificarlo.';
    twofactorEmail.value = '';
    twofactorEmailStep.classList.remove('hidden');
    twofactorCodeStep.classList.add('hidden');
    twofactorEmail.focus();
  } else {
    showTwoFactorCodeStep(res);
  }
}

function showTwoFactorCodeStep(res) {
  twofactorIntro.textContent = twoFactorState.setup
    ? 'Primer ingreso: debes activar el doble factor. Enviamos un código a ' + res.maskedEmail + '. Ingrésalo para verificar tu correo.'
    : (res.reused
      ? 'Ya te enviamos un código a ' + res.maskedEmail + ' y sigue vigente. Ingrésalo para continuar.'
      : 'Enviamos un código de acceso a ' + res.maskedEmail + '. Ingrésalo para continuar.');
  twofactorEmailStep.classList.add('hidden');
  twofactorCodeStep.classList.remove('hidden');
  twofactorCode.value = '';
  twofactorCode.focus();
  startTwoFactorTimer((typeof res.expiresInSeconds === 'number' ? res.expiresInSeconds : 300) * 1000);
}

function startTwoFactorTimer(ms) {
  clearInterval(twoFactorInterval);
  var expiresAt = Date.now() + ms;
  function tick() {
    var left = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
    if (left === 0) {
      twofactorTimer.innerHTML = '<i class="fas fa-clock"></i> El código venció. Pide uno nuevo.';
      clearInterval(twoFactorInterval);
      return;
    }
    var m = Math.floor(left / 60);
    var s = left % 60;
    twofactorTimer.innerHTML = '<i class="fas fa-clock"></i> El código vence en ' + m + ':' + (s < 10 ? '0' : '') + s;
  }
  tick();
  twoFactorInterval = setInterval(tick, 1000);
}

function closeTwoFactor() {
  clearInterval(twoFactorInterval);
  twoFactorState = null;
  clearStoredTwoFactorTicket();
  twofactorVerifyBtn.disabled = false;
  twofactorVerifyBtn.innerHTML = '<i class="fas fa-check"></i> Verificar';
  document.querySelectorAll('.login-tab').forEach(t => t.classList.toggle('active', t.dataset.form === 'login'));
  showLoginBox('login-form');
}

twofactorEmailBtn.addEventListener('click', function() {
  var email = twofactorEmail.value.trim();
  var twoFactorEmailError = emailError(email);
  if (twoFactorEmailError) { loginError.textContent = twoFactorEmailError; return; }
  twofactorEmailBtn.disabled = true;
  socket.emit('two-factor-set-email', twoFactorAuth({ email: email }), function(res) {
    twofactorEmailBtn.disabled = false;
    if (!res.ok) {
      if (res.restart) closeTwoFactor();
      loginError.textContent = res.error;
      return;
    }
    loginError.textContent = '';
    showTwoFactorCodeStep(res);
  });
});

twofactorEmail.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') twofactorEmailBtn.click();
});

twofactorVerifyBtn.addEventListener('click', function() {
  if (!twoFactorState) return;
  var code = twofactorCode.value.trim();
  if (!/^\d{6}$/.test(code)) { loginError.textContent = 'El código tiene 6 dígitos'; return; }
  twofactorVerifyBtn.disabled = true;
  twofactorVerifyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando...';
  socket.emit('two-factor-verify', twoFactorAuth({ code: code, remember: $('twofactor-remember').checked }), function(res) {
    twofactorVerifyBtn.disabled = false;
    twofactorVerifyBtn.innerHTML = '<i class="fas fa-check"></i> Verificar';
    if (!res.ok) {
      if (res.restart) closeTwoFactor();
      loginError.textContent = res.error;
      return;
    }
    var state = twoFactorState;
    closeTwoFactor();
    loginError.textContent = '';
    continueLogin(state.username, res, state.opts, state.callback);
  });
});

twofactorCode.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') twofactorVerifyBtn.click();
});

twofactorResendBtn.addEventListener('click', function() {
  twofactorResendBtn.disabled = true;
  socket.emit('two-factor-resend', twoFactorAuth(), function(res) {
    twofactorResendBtn.disabled = false;
    if (!res.ok) {
      if (res.restart) closeTwoFactor();
      loginError.textContent = res.error;
      return;
    }
    loginError.textContent = '';
    showTwoFactorCodeStep(res);
    showToast('Código reenviado');
  });
});

twofactorCancelBtn.addEventListener('click', function() {
  closeTwoFactor();
  loginError.textContent = '';
});

loginUsername.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loginPassword.focus();
});
loginPassword.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loginBtn.click();
});

loginBtn.addEventListener('click', () => {
  const username = loginUsername.value.trim();
  const password = loginPassword.value;
  if (!username) { loginError.textContent = 'Ingresa tu usuario'; return; }
  if (!password) { loginError.textContent = 'Ingresa tu contraseña'; return; }
  doLogin(username, password, (res) => {
    if (!res.ok) loginError.textContent = res.error;
  });
});

registerUsername.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') registerEmail.focus();
});
registerEmail.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') registerPassword.focus();
});
registerPassword.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') registerConfirm.focus();
});
registerConfirm.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') registerBtn.click();
});

const TERMS_VERSION = '1.1';
let pendingRegistration = null;

const termsOverlay = $('terms-modal-overlay');
const termsAcceptCheckbox = $('terms-accept-checkbox');
const termsAcceptBtn = $('terms-accept-btn');
const termsCancelBtn = $('terms-cancel-btn');
const termsError = $('terms-error');

function openTermsModal() {
  termsAcceptCheckbox.checked = false;
  termsAcceptBtn.disabled = true;
  termsError.textContent = '';
  termsOverlay.classList.remove('hidden');
  termsAcceptCheckbox.focus();
}

function closeTermsModal() {
  termsOverlay.classList.add('hidden');
  pendingRegistration = null;
  registerBtn.disabled = false;
  registerBtn.innerHTML = '<i class="fas fa-user-plus"></i> Crear cuenta';
}

termsAcceptCheckbox.addEventListener('change', function() {
  termsAcceptBtn.disabled = !this.checked;
});

termsCancelBtn.addEventListener('click', closeTermsModal);
termsOverlay.addEventListener('click', function(e) {
  if (e.target === termsOverlay) closeTermsModal();
});

termsAcceptBtn.addEventListener('click', function() {
  if (!pendingRegistration) return;
  const regUsername = pendingRegistration.username;
  const regPassword = pendingRegistration.password;
  const regEmail = pendingRegistration.email;

  termsAcceptBtn.disabled = true;
  termsAcceptBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Registrando...';

  socket.emit('register', {
    username: regUsername,
    password: regPassword,
    email: regEmail,
    terms_version: TERMS_VERSION
  }, (res) => {
    termsAcceptBtn.disabled = false;
    termsAcceptBtn.innerHTML = '<i class="fas fa-check"></i> Aceptar';
    pendingRegistration = null;

    if (!res.ok) {
      termsError.textContent = res.error;
      return;
    }

    closeTermsModal();
    registerUsername.value = '';
    registerEmail.value = '';
    registerPassword.value = '';
    registerConfirm.value = '';
    document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('[data-form="login"]').classList.add('active');
    document.querySelectorAll('.login-form-box').forEach(f => f.classList.add('hidden'));
    $('login-form').classList.remove('hidden');
    loginUsername.value = regUsername;
    loginPassword.focus();
    loginError.textContent = 'Cuenta creada. Debe ser aprobada por un administrador antes de que puedas ingresar.';
  });
});

registerBtn.addEventListener('click', () => {
  const username = registerUsername.value.trim();
  const email = registerEmail.value.trim();
  const password = registerPassword.value;
  const confirm = registerConfirm.value;

  if (!username) { loginError.textContent = 'Ingresa un usuario'; return; }
  var registerEmailError = emailError(email);
  if (registerEmailError) { loginError.textContent = registerEmailError; return; }
  if (!password || password.length < 8) { loginError.textContent = 'La contraseña debe tener al menos 8 caracteres'; return; }
  if (password !== confirm) { loginError.textContent = 'No coinciden'; return; }

  pendingRegistration = { username, email, password };
  registerBtn.disabled = true;
  registerBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando...';
  loginError.textContent = '';
  openTermsModal();
});
