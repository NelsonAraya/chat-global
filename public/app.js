const socket = io();

let currentUser = null;
let currentDisplayName = null;
let currentAvatar = null;
let currentLocation = '';
let currentRoom = null;
let privateRecipient = null;
let rooms = [];
let conversations = [];
let unreadCounts = {};
let roomUnreadCounts = {};
let unreadTotal = 0;
let pendingPasswordRoom = null;
let sidebarTab = 'rooms';
let roomPasswords = {};
let currentRole = 'user';
let pendingFile = null;
let replyingTo = null;

const $ = (id) => document.getElementById(id);

const loginScreen = $('login-screen');
const chatScreen = $('chat-screen');

const loginUsername = $('login-username');
const loginPassword = $('login-password');
const loginBtn = $('login-btn');
const loginError = $('login-error');

const registerUsername = $('register-username');
const registerPassword = $('register-password');
const registerConfirm = $('register-confirm');
const registerBtn = $('register-btn');

const displayName = $('display-name');
const headerAvatar = $('header-avatar');
const editNameBtn = $('edit-name-btn');
const nameModalOverlay = $('name-modal-overlay');
const nameModalInput = $('name-modal-input');
const nameModalConfirm = $('name-modal-confirm');
const nameModalCancel = $('name-modal-cancel');
const nameModalClose = $('name-modal-close');
const nameModalError = $('name-modal-error');
const changePwdBtn = $('change-pwd-btn');
const pwdChangeOverlay = $('pwd-change-modal-overlay');
const pwdChangeCurrent = $('pwd-change-current');
const pwdChangeNew = $('pwd-change-new');
const pwdChangeConfirm = $('pwd-change-confirm');
const pwdChangeConfirmBtn = $('pwd-change-confirm-btn');
const pwdChangeCancel = $('pwd-change-cancel');
const pwdChangeClose = $('pwd-change-close');
const pwdChangeError = $('pwd-change-error');
const avatarInput = $('avatar-input');
const logoutBtn = $('logout-btn');

const roomsList = $('rooms-list');
const conversationsList = $('conversations-list');
const convTotalBadge = $('conv-total-badge');
const roomTotalBadge = $('room-total-badge');
const allUsersList = $('all-users-list');
const adminTab = $('admin-tab');
const adminUsersList = $('admin-users-list');
const adminRoomsList = $('admin-rooms-list');
const adminEditOverlay = $('admin-edit-user-overlay');
const adminEditUsernameDisplay = $('admin-edit-username-display');
const adminEditDisplayname = $('admin-edit-displayname');
const adminEditRole = $('admin-edit-role');
const adminEditError = $('admin-edit-error');
const adminEditConfirm = $('admin-edit-confirm');
const adminEditCancel = $('admin-edit-cancel');
const adminEditClose = $('admin-edit-user-close');
const adminEditPassword = $('admin-edit-password');
const adminEditPasswordConfirm = $('admin-edit-password-confirm');
const adminEditDeleteBtn = $('admin-edit-delete-btn');
const adminStats = $('admin-stats');
const adminStatUsers = $('admin-stat-users');
const adminStatOnline = $('admin-stat-online');
const adminStatMsgs = $('admin-stat-msgs');
const adminStatRooms = $('admin-stat-rooms');
const adminRoomPwdOverlay = $('admin-room-pwd-overlay');
const adminRoomPwdName = $('admin-room-pwd-name');
const adminRoomPwdStatus = $('admin-room-pwd-status');
const adminRoomPwdInput = $('admin-room-pwd-input');
const adminRoomPwdError = $('admin-room-pwd-error');
const adminRoomPwdConfirm = $('admin-room-pwd-confirm');
const adminRoomPwdCancel = $('admin-room-pwd-cancel');
const adminRoomPwdClose = $('admin-room-pwd-close');

const messagesList = $('messages-list');
const messagesStart = $('messages-start');
const messageInput = $('message-input');
const sendBtn = $('send-btn');

const roomUsersList = $('room-users-list');
const contextName = $('context-name');
const contextIcon = $('context-icon');
const contextBadge = $('context-badge');
const welcomeRoom = $('welcome-room');
const backToRoomBtn = $('back-to-room-btn');
const privateIndicator = $('private-indicator');
const privateRecipientName = $('private-recipient-name');
const cancelPrivateBtn = $('cancel-private-btn');

const createModalOverlay = $('create-modal-overlay');
const createModalInput = $('create-modal-input');
const createModalPassword = $('create-modal-password');
const createModalTemporary = $('create-modal-temporary');
const createModalInfo = $('create-modal-info');
const createModalConfirm = $('create-modal-confirm');
const createModalCancel = $('create-modal-cancel');
const createModalClose = $('create-modal-close');
const createModalError = $('create-modal-error');

const passwordModalOverlay = $('password-modal-overlay');
const passwordModalInput = $('password-modal-input');
const passwordModalRoomName = $('password-room-name');
const passwordModalConfirm = $('password-modal-confirm');
const passwordModalCancel = $('password-modal-cancel');
const passwordModalClose = $('password-modal-close');
const passwordModalError = $('password-modal-error');

const toastContainer = $('toast-container');
const emojiBtn = $('emoji-btn');
const emojiPicker = $('emoji-picker');
const emojiGrid = $('emoji-grid');
const attachBtn = $('attach-btn');
const fileInput = $('file-input');
const filePreview = $('file-preview');
const filePreviewName = $('file-preview-name');
const filePreviewSize = $('file-preview-size');
const filePreviewRemove = $('file-preview-remove');
const imageModalOverlay = $('image-modal-overlay');
const imageModalImg = $('image-modal-img');
const imageModalClose = $('image-modal-close');
const micBtn = $('mic-btn');
const recordingIndicator = $('recording-indicator');
const recTimer = $('rec-timer');
const recStopBtn = $('rec-stop-btn');
const recCancelBtn = $('rec-cancel-btn');
const replyIndicator = $('reply-indicator');
const replyTargetName = $('reply-target-name');
const replyTargetPreview = $('reply-target-preview');
const cancelReplyBtn = $('cancel-reply-btn');
const sidebarToggleBtn = $('sidebar-toggle-btn');
const usersToggleBtn = $('users-toggle-btn');
const drawerOverlay = $('drawer-overlay');
const panicBtn = $('panic-btn');
const panicModalOverlay = $('panic-modal-overlay');
const panicModalMessage = $('panic-modal-message');
const panicModalTime = $('panic-modal-time');
const panicModalOk = $('panic-modal-ok');
const panicModalClose = $('panic-modal-close');
const panicModalLocation = $('panic-modal-location');
const editLocationBtn = $('edit-location-btn');
const locationModalOverlay = $('location-modal-overlay');
const locationModalInput = $('location-modal-input');
const locationModalConfirm = $('location-modal-confirm');
const locationModalClear = $('location-modal-clear');
const locationModalClose = $('location-modal-close');
const locationModalError = $('location-modal-error');
const locationModalStatus = $('location-modal-status');

var panicAudio = new Audio('/sounds/alerta.mp3');
panicAudio.preload = 'auto';

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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

var EMOJIS = ['😀','😃','😄','😁','😅','😂','🤣','😊','😍','🥰','😘','😗','😉','🤩','😎','🥳','😢','😭','😤','😡','🤬','🥶','🤗','🤔','🙄','👍','👎','👊','✊','🤚','👋','🙏','💪','❤️','🧡','💛','💚','💙','💜','🖤','💔','🔥','⭐','🎉','🎊','🎁','💯','✅','❌','👀','🗣️','💬','📨','📌','🔒','🔓','⏰'];

EMOJIS.forEach(function(emoji) {
  var btn = document.createElement('button');
  btn.className = 'emoji-btn';
  btn.textContent = emoji;
  btn.type = 'button';
  btn.addEventListener('click', function() {
    var input = messageInput;
    var start = input.selectionStart;
    var end = input.selectionEnd;
    input.value = input.value.substring(0, start) + emoji + input.value.substring(end);
    input.selectionStart = input.selectionEnd = start + emoji.length;
    input.focus();
    emojiPicker.classList.add('hidden');
  });
  emojiGrid.appendChild(btn);
});

emojiBtn.addEventListener('click', function(e) {
  e.stopPropagation();
  emojiPicker.classList.toggle('hidden');
});

document.addEventListener('click', function(e) {
  if (!emojiPicker.classList.contains('hidden') && !emojiPicker.contains(e.target) && e.target !== emojiBtn && !emojiBtn.contains(e.target)) {
    emojiPicker.classList.add('hidden');
  }
});

attachBtn.addEventListener('click', function() {
  fileInput.click();
});

fileInput.addEventListener('change', function() {
  var file = fileInput.files[0];
  if (!file) return;

  if (file.size > 10 * 1024 * 1024) {
    showToast('El archivo es demasiado grande (máximo 10 MB)');
    fileInput.value = '';
    return;
  }

  var formData = new FormData();
  formData.append('file', file);

  fetch('/api/upload', { method: 'POST', body: formData })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.error) { showToast(data.error); return; }
      pendingFile = data;
      filePreviewName.textContent = data.name;
      filePreviewSize.textContent = formatFileSize(data.size);
      filePreview.classList.remove('hidden');
    })
    .catch(function() {
      showToast('Error al subir archivo');
    });
});

filePreviewRemove.addEventListener('click', function() {
  pendingFile = null;
  filePreview.classList.add('hidden');
  fileInput.value = '';
});

// ===================== AUDIO RECORDING =====================

var mediaRecorder = null;
var audioChunks = [];
var audioStream = null;
var recInterval = null;
var recSeconds = 0;

function formatRecTime(s) {
  var m = Math.floor(s / 60);
  var sec = s % 60;
  return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
}

function startRecording() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('Tu navegador no soporta grabación de audio');
    return;
  }
  navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
    audioStream = stream;
    audioChunks = [];
    recSeconds = 0;
    recTimer.textContent = '00:00';
    recordingIndicator.classList.remove('hidden');
    micBtn.style.color = 'var(--color-danger)';
    micBtn.disabled = true;

    mediaRecorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '' });
    mediaRecorder.ondataavailable = function(e) {
      if (e.data.size > 0) audioChunks.push(e.data);
    };
    mediaRecorder.onstop = function() {
      clearInterval(recInterval);
      micBtn.style.color = '';
      micBtn.disabled = false;
      recordingIndicator.classList.add('hidden');

      var blob = new Blob(audioChunks, { type: 'audio/webm' });
      if (blob.size < 100) return;

      var formData = new FormData();
      formData.append('file', blob, 'audio_' + Date.now() + '.webm');
      fetch('/api/upload', { method: 'POST', body: formData })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data.error) { showToast(data.error); return; }
          var payload = { content: '', file: data };
          if (replyingTo) payload.reply = replyingTo;
          if (privateRecipient) {
            payload.recipient = privateRecipient;
            socket.emit('private-message', payload);
            setTimeout(loadConversations, 100);
          } else if (currentRoom) {
            socket.emit('room-message', payload);
          }
          cancelReply();
          messageInput.focus();
        })
        .catch(function() { showToast('Error al subir audio'); });

      audioStream.getTracks().forEach(function(t) { t.stop(); });
      audioStream = null;
    };
    mediaRecorder.start();
    recInterval = setInterval(function() {
      recSeconds++;
      recTimer.textContent = formatRecTime(recSeconds);
    }, 1000);
  }).catch(function() {
    showToast('Permiso de micrófono denegado');
  });
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

function cancelRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.ondataavailable = null;
    mediaRecorder.onstop = null;
    mediaRecorder.stop();
  }
  clearInterval(recInterval);
  micBtn.style.color = '';
  micBtn.disabled = false;
  recordingIndicator.classList.add('hidden');
  if (audioStream) {
    audioStream.getTracks().forEach(function(t) { t.stop(); });
    audioStream = null;
  }
  audioChunks = [];
}

micBtn.addEventListener('click', startRecording);
recStopBtn.addEventListener('click', stopRecording);
recCancelBtn.addEventListener('click', cancelRecording);

function openImageModal(url) {
  imageModalImg.src = url;
  imageModalOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeImageModal() {
  imageModalOverlay.classList.add('hidden');
  imageModalImg.src = '';
  document.body.style.overflow = '';
}

imageModalClose.addEventListener('click', closeImageModal);
imageModalOverlay.addEventListener('click', function(e) {
  if (e.target === imageModalOverlay) closeImageModal();
});

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    if (!imageModalOverlay.classList.contains('hidden')) {
      closeImageModal();
    }
  }
});

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

function doLogin(username, password, callback) {
  loginBtn.disabled = true;
  loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Conectando...';

  socket.emit('login', { username, password }, (res) => {
    loginBtn.disabled = false;
    loginBtn.innerHTML = '<i class="fas fa-arrow-right"></i> Ingresar';

    if (!res.ok) {
      if (res.error && res.error.includes('ya está conectado')) {
        localStorage.removeItem('chat_user');
        localStorage.removeItem('chat_pass');
      }
      callback?.({ ok: false, error: res.error });
      return;
    }

    currentUser = username.toLowerCase();
    currentDisplayName = res.displayName || username;
    currentAvatar = res.avatar || null;
    currentLocation = res.location || '';
    currentRole = res.role || 'user';
    rooms = res.rooms || [];
    loginScreen.classList.add('hidden');
    chatScreen.classList.remove('hidden');
    displayName.textContent = currentDisplayName;
    updateHeaderAvatar();
    if (currentRole === 'admin') {
      adminTab.classList.remove('hidden');
    }
    localStorage.setItem('chat_user', username.toLowerCase());
    localStorage.setItem('chat_pass', password);
    initializeChat();
    socket.emit('get-room-unreads', function(counts) {
      roomUnreadCounts = counts || {};
      renderRooms();
      updateRoomTotalBadge();
    });
    callback?.({ ok: true });
  });
}

function tryAutoLogin() {
  var savedUser = localStorage.getItem('chat_user');
  var savedPass = localStorage.getItem('chat_pass');
  if (savedUser && savedPass) {
    loginBtn.disabled = true;
    loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Conectando...';
    socket.emit('login', { username: savedUser, password: savedPass }, (res) => {
      if (!res.ok) {
        localStorage.removeItem('chat_user');
        localStorage.removeItem('chat_pass');
        loginBtn.disabled = false;
        loginBtn.innerHTML = '<i class="fas fa-arrow-right"></i> Ingresar';
        loginUsername.focus();
        return;
      }
      currentUser = savedUser;
      currentDisplayName = res.displayName || savedUser;
      currentAvatar = res.avatar || null;
      currentLocation = res.location || '';
      currentRole = res.role || 'user';
      rooms = res.rooms || [];
      loginScreen.classList.add('hidden');
      chatScreen.classList.remove('hidden');
      displayName.textContent = currentDisplayName;
      updateHeaderAvatar();
      if (currentRole === 'admin') {
        adminTab.classList.remove('hidden');
      }
      initializeChat();
      socket.emit('get-room-unreads', function(counts) {
        roomUnreadCounts = counts || {};
        renderRooms();
        updateRoomTotalBadge();
      });
    });
    return true;
  }
  return false;
}

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
  if (e.key === 'Enter') registerPassword.focus();
});
registerPassword.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') registerConfirm.focus();
});
registerConfirm.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') registerBtn.click();
});

const TERMS_VERSION = '1.0';
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

  termsAcceptBtn.disabled = true;
  termsAcceptBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Registrando...';

  socket.emit('register', {
    username: regUsername,
    password: regPassword,
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
    registerPassword.value = '';
    registerConfirm.value = '';
    document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('[data-form="login"]').classList.add('active');
    document.querySelectorAll('.login-form-box').forEach(f => f.classList.add('hidden'));
    $('login-form').classList.remove('hidden');
    loginUsername.value = regUsername;
    loginPassword.focus();
    loginError.textContent = 'Cuenta creada. Ahora ingresa.';
  });
});

registerBtn.addEventListener('click', () => {
  const username = registerUsername.value.trim();
  const password = registerPassword.value;
  const confirm = registerConfirm.value;

  if (!username) { loginError.textContent = 'Ingresa un usuario'; return; }
  if (!password || password.length < 3) { loginError.textContent = 'Minimo 3 caracteres'; return; }
  if (password !== confirm) { loginError.textContent = 'No coinciden'; return; }

  pendingRegistration = { username, password };
  registerBtn.disabled = true;
  registerBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando...';
  loginError.textContent = '';
  openTermsModal();
});

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
  if (file.size > 5 * 1024 * 1024) {
    showToast('La imagen debe ser menor a 5 MB');
    avatarInput.value = '';
    return;
  }
  var formData = new FormData();
  formData.append('file', file);
  fetch('/api/upload', { method: 'POST', body: formData })
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
  avatarInput.click();
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
  if (!newPwd || newPwd.length < 3) { pwdChangeError.textContent = 'Mínimo 3 caracteres'; return; }
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
  localStorage.removeItem('chat_user');
  localStorage.removeItem('chat_pass');
  location.reload();
});

panicBtn.addEventListener('click', function() {
  panicModalMessage.textContent = 'Has enviado una alerta de asistencia';
  panicModalLocation.innerHTML = 'Ubicación: <strong>' + escapeHtml(currentLocation || 'Indeterminada') + '</strong>';
  panicModalTime.textContent = formatTime(new Date().toISOString());
  panicModalOverlay.classList.remove('hidden');
  socket.emit('panic-alert');
});

panicModalOk.addEventListener('click', closePanicModal);
panicModalClose.addEventListener('click', closePanicModal);
panicModalOverlay.addEventListener('click', function(e) {
  if (e.target === panicModalOverlay) closePanicModal();
});

// Triple clic rápido en zona gris del chat para activar alerta
var panicClickTimes = [];
var PANIC_CLICK_WINDOW = 800;
var PANIC_COOLDOWN_MS = 30000;
var panicLastTrigger = 0;

document.addEventListener('click', function(e) {
  if (!currentUser) return;
  if (Date.now() - panicLastTrigger < PANIC_COOLDOWN_MS) return;

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
    panicLastTrigger = Date.now();

    var flash = document.createElement('div');
    flash.style.cssText = 'position:fixed;inset:0;border:6px solid #ef4444;border-radius:0;pointer-events:none;z-index:1999;animation:fadeOut 0.6s forwards;';
    document.body.appendChild(flash);
    setTimeout(function() { flash.remove(); }, 700);

    panicModalMessage.textContent = 'Has enviado una alerta de asistencia';
    panicModalLocation.innerHTML = 'Ubicación: <strong>' + escapeHtml(currentLocation || 'Indeterminada') + '</strong>';
    panicModalTime.textContent = formatTime(new Date().toISOString());
    panicModalOverlay.classList.remove('hidden');
    socket.emit('panic-alert');
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

// ===================== MOBILE DRAWERS =====================

function closeDrawers() {
  document.getElementById('sidebar-rooms').classList.remove('left-open');
  document.getElementById('sidebar-users').classList.remove('right-open');
  drawerOverlay.classList.add('hidden');
  document.body.style.overflow = '';
}

sidebarToggleBtn.addEventListener('click', function(e) {
  e.stopPropagation();
  var leftOpen = document.getElementById('sidebar-rooms').classList.toggle('left-open');
  document.getElementById('sidebar-users').classList.remove('right-open');
  drawerOverlay.classList.toggle('hidden', !leftOpen);
  document.body.style.overflow = leftOpen ? 'hidden' : '';
});

usersToggleBtn.addEventListener('click', function(e) {
  e.stopPropagation();
  var rightOpen = document.getElementById('sidebar-users').classList.toggle('right-open');
  document.getElementById('sidebar-rooms').classList.remove('left-open');
  drawerOverlay.classList.toggle('hidden', !rightOpen);
  document.body.style.overflow = rightOpen ? 'hidden' : '';
});

drawerOverlay.addEventListener('click', closeDrawers);

function onActionCloseDrawers() {
  if (window.innerWidth <= 768) closeDrawers();
}

// ===================== NOTIFICATIONS =====================

function playNotification() {
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 520;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch(e) {}
}

function playPanicSound() {
  try {
    panicAudio.currentTime = 0;
    panicAudio.play();
  } catch(e) {}
}

function showPanicModal(data) {
  panicModalMessage.textContent = 'El usuario ' + (data.displayName || data.username) + ' está pidiendo asistencia';
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

function loadConversations() {
  socket.emit('get-conversations', function(conv) {
    conversations = conv || [];
    renderConversations();
  });
}

function initializeChat() {
  renderRooms();
  loadConversations();
  socket.emit('get-all-users', function(users) {
    renderAllUsers(users);
  });
  const defaultRoom = rooms.length > 0 ? rooms[0].name : 'general';
  joinRoom({ name: defaultRoom });
}

document.querySelectorAll('.sidebar-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    sidebarTab = tab.dataset.panel;
    document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.add('hidden'));
    $(sidebarTab + '-panel').classList.remove('hidden');
    if (sidebarTab === 'admin') renderAdminPanel();
  });
});

function renderRooms() {
  roomsList.innerHTML = rooms.map(function(r) {
    var icon = 'fas fa-hashtag';
    var extra = '';
    if (r.hasPassword) { icon = 'fas fa-lock'; extra = ' room-icon-lock'; }
    if (r.temporary) { icon = 'far fa-clock'; extra = ' room-icon-temp'; }
    var unread = roomUnreadCounts[r.name] || 0;
    var badgeHtml = unread > 0 ? '<span class="room-badge">' + unread + '</span>' : '';
    return '<div class="room-item' + (r.name === currentRoom ? ' active' : '') + (unread > 0 ? ' unread' : '') + '" data-room="' + escapeHtml(r.name) + '">' +
      '<i class="' + icon + extra + '"></i>' +
      '<span>' + escapeHtml(r.name) + '</span>' + badgeHtml + '</div>';
  }).join('');

  roomsList.querySelectorAll('.room-item').forEach(function(el) {
    el.addEventListener('click', function() {
      var room = el.dataset.room;
      if (room !== currentRoom || privateRecipient) {
        cancelPrivate();
        joinRoom({ name: room });
      }
    });
  });
}

function renderAdminPanel() {
  socket.emit('get-stats', function(stats) {
    if (stats) {
      adminStatUsers.textContent = stats.totalUsers;
      adminStatOnline.textContent = stats.connectedUsers;
      adminStatMsgs.textContent = stats.totalMessages;
      adminStatRooms.textContent = stats.totalRooms;
    }
  });

  socket.emit('get-all-registered-users', function(users) {
    adminUsersList.innerHTML = users.map(function(u) {
      var isAdmin = u.role === 'admin';
      return '<div class="admin-user-item">' +
        '<div class="admin-user-info">' +
          '<div class="admin-user-name">' + escapeHtml(u.displayName || u.username) + '</div>' +
          '<div class="admin-user-username">@' + escapeHtml(u.username) + '  <span class="admin-user-role' + (isAdmin ? ' admin-role-badge' : '') + '">' + (isAdmin ? 'Admin' : 'User') + '</span></div>' +
        '</div>' +
        '<button class="admin-user-edit-btn btn-icon" data-username="' + escapeHtml(u.username) + '" data-displayname="' + escapeHtml(u.displayName || u.username) + '" data-role="' + u.role + '" title="Editar usuario"><i class="fas fa-pen"></i></button>' +
      '</div>';
    }).join('');

    adminUsersList.querySelectorAll('.admin-user-edit-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        adminEditUsernameDisplay.textContent = btn.dataset.username;
        adminEditDisplayname.value = btn.dataset.displayname;
        adminEditRole.value = btn.dataset.role;
        adminEditPassword.value = '';
        adminEditPasswordConfirm.value = '';
        adminEditDeleteBtn.disabled = false;
        adminEditDeleteBtn.innerHTML = '<i class="fas fa-trash"></i> Eliminar usuario';
        adminEditError.textContent = '';
        adminEditOverlay.classList.remove('hidden');
        adminEditDisplayname.focus();
      });
    });
  });

  adminRoomsList.innerHTML = rooms.map(function(r) {
    var actions = '';
    if (r.name !== 'general') {
      if (!r.temporary) {
        actions += '<button class="admin-room-lock-btn btn-icon" data-room="' + escapeHtml(r.name) + '" data-haspassword="' + r.hasPassword + '" title="' + (r.hasPassword ? 'Cambiar contraseña' : 'Poner contraseña') + '"><i class="fas ' + (r.hasPassword ? 'fa-lock' : 'fa-unlock') + '"></i></button>';
      }
      actions += '<button class="admin-room-delete-btn btn-icon" data-room="' + escapeHtml(r.name) + '" title="Eliminar sala"><i class="fas fa-trash"></i></button>';
    }
    return '<div class="admin-room-item">' +
      '<div class="admin-room-info">' +
        '<span class="admin-room-name">#' + escapeHtml(r.name) + '</span>' +
        '<span class="admin-room-meta">' + (r.temporary ? 'Temporal' : 'Fija') + (r.hasPassword ? ' · 🔒' : '') + '</span>' +
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
    roomUnreadCounts[name] = 0;
    contextName.textContent = name;
    if (res.hasPassword) contextIcon.className = 'fas fa-lock';
    else if (res.temporary) contextIcon.className = 'far fa-clock';
    else contextIcon.className = 'fas fa-hashtag';
    contextBadge.classList.add('hidden');
    backToRoomBtn.classList.add('hidden');
    welcomeRoom.textContent = name;
    renderRooms();

    renderMessages(res.history);
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
  } else {
    createModalTemporary.checked = false;
    createModalTemporary.disabled = false;
    createModalInfo.classList.add('hidden');
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
    temporary: createModalTemporary.checked
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

// ===================== ADMIN EDIT USER MODAL =====================

adminEditConfirm.addEventListener('click', function() {
  var username = adminEditUsernameDisplay.textContent;
  var displayName = adminEditDisplayname.value.trim();
  var role = adminEditRole.value;
  var newPassword = adminEditPassword.value;
  var newPasswordConfirm = adminEditPasswordConfirm.value;

  if (!displayName) { adminEditError.textContent = 'Nombre requerido'; return; }

  if (newPassword || newPasswordConfirm) {
    if (newPassword.length < 3) { adminEditError.textContent = 'Contraseña: mínimo 3 caracteres'; return; }
    if (newPassword !== newPasswordConfirm) { adminEditError.textContent = 'Las contraseñas no coinciden'; return; }
  }

  adminEditConfirm.disabled = true;
  adminEditConfirm.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';

  socket.emit('update-user', { username, displayName, role }, function(res) {
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

adminEditPassword.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') adminEditPasswordConfirm.focus();
});
adminEditPasswordConfirm.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') adminEditConfirm.click();
});

// ===================== END ADMIN EDIT =====================

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

  conversationsList.querySelectorAll('.conv-item').forEach(function(el) {
    el.addEventListener('click', function() {
      var user = el.dataset.user;
      cancelPrivate();
      openPrivateChat(user);
      if (sidebarTab !== 'conversations') {
        document.querySelectorAll('.sidebar-tab').forEach(function(t) { t.classList.remove('active'); });
        document.querySelector('[data-panel="conversations"]').classList.add('active');
        sidebarTab = 'conversations';
        document.querySelectorAll('.sidebar-panel').forEach(function(p) { p.classList.add('hidden'); });
        $('conversations-panel').classList.remove('hidden');
      }
    });
  });
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

function renderMessages(messages) {
  messagesList.innerHTML = '';
  messagesStart.classList.toggle('hidden', messages.length > 0);
  if (messages.length === 0) return;

  var lastDate = null;
  messages.forEach(function(m) {
    renderMessage(m, false, lastDate);
    lastDate = m.created_at ? new Date(m.created_at).toDateString() : null;
  });
  scrollToBottom();
}

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

function renderMessage(msg, animate, lastDate) {
  if (animate === undefined) animate = true;
  var isPrivate = msg.type === 'private';
  var isSelf = msg.sender === currentUser;
  var msgDate = msg.created_at ? new Date(msg.created_at).toDateString() : null;

  if (lastDate !== msgDate && msgDate) {
    var divider = document.createElement('div');
    divider.className = 'message-divider';
    divider.textContent = new Date(msg.created_at).toLocaleDateString('es-CL', {
      weekday: 'long', day: 'numeric', month: 'long'
    });
    messagesList.appendChild(divider);
  }

  var el = document.createElement('div');
  el.className = 'message ' + (isSelf ? 'self' : 'other') + (isPrivate ? ' private' : '');
  if (!animate) el.style.animation = 'none';
  if (msg.id) el.dataset.messageId = msg.id;

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
  if (msg.file) {
    if (msg.file.type && msg.file.type.startsWith('image/')) {
      fileHtml = '<div class="msg-file"><img src="' + escapeHtml(msg.file.url) + '" alt="' + escapeHtml(msg.file.name) + '" class="msg-image" onclick="openImageModal(\'' + escapeHtml(msg.file.url) + '\')" loading="lazy" /></div>';
    } else if (msg.file.type && msg.file.type.startsWith('audio/')) {
      fileHtml = '<div class="msg-file msg-audio"><audio src="' + escapeHtml(msg.file.url) + '" controls preload="metadata"></audio></div>';
    } else {
      fileHtml = '<div class="msg-file"><i class="fas fa-file"></i> <a href="' + escapeHtml(msg.file.url) + '" target="_blank" download>' + escapeHtml(msg.file.name) + '</a> <span class="msg-file-size">' + formatFileSize(msg.file.size) + '</span></div>';
    }
  }

  var replyHtml = '';
  if (msg.reply) {
    var replyId = msg.reply.id ? ' data-reply-id="' + msg.reply.id + '"' : '';
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

  messagesList.appendChild(el);
  scrollToBottom();
}

// Navigate to replied message on click
messagesList.addEventListener('click', function(e) {
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

  if (privateRecipient) {
    payload.recipient = privateRecipient;
    socket.emit('private-message', payload);
    setTimeout(loadConversations, 100);
  } else if (currentRoom) {
    socket.emit('room-message', payload);
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
  privateRecipient = username;

  unreadCounts[username] = 0;
  updateConvTotalBadge();
  renderConversations();

  contextName.textContent = username;
  contextIcon.className = 'fas fa-lock';
  contextBadge.classList.remove('hidden');
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
  privateIndicator.classList.add('hidden');
  cancelReply();

  if (currentRoom) {
    contextName.textContent = currentRoom;
    var curRoomData = rooms.find(function(r) { return r.name === currentRoom; });
    if (curRoomData && curRoomData.hasPassword) contextIcon.className = 'fas fa-lock';
    else if (curRoomData && curRoomData.temporary) contextIcon.className = 'far fa-clock';
    else contextIcon.className = 'fas fa-hashtag';
    contextBadge.classList.add('hidden');
    backToRoomBtn.classList.add('hidden');
    messageInput.placeholder = 'Escribe en #' + currentRoom + '...';

    socket.emit('join-room', { name: currentRoom }, function(res) {
      if (res?.ok) {
        roomUnreadCounts[currentRoom] = 0;
        renderRooms();
        updateRoomTotalBadge();
        renderMessages(res.history);
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
  socket.emit('get-private-history', { with: username }, function(history) {
    renderMessages(history);
  });
}

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

  var currentObj = { username: currentUser, displayName: currentDisplayName || currentUser, avatar: currentAvatar };
  var currentEl = renderUserItem(currentObj, true);
  var otherUsers = users.filter(function(u) {
    var uname = typeof u === 'string' ? u : u.username;
    return uname !== currentUser;
  }).map(function(u) {
    return renderUserItem(u, false);
  }).join('');

  roomUsersList.innerHTML = currentEl + otherUsers;

  roomUsersList.querySelectorAll('.user-item[data-user]').forEach(function(el) {
    el.addEventListener('click', function() { openPrivateChat(el.dataset.user); });
    var pmIcon = el.querySelector('.pm-icon');
    if (pmIcon) pmIcon.addEventListener('click', function(e) {
      e.stopPropagation();
      openPrivateChat(el.dataset.user);
    });
  });
}

function renderAllUsers(users) {
  if (!users || !Array.isArray(users)) return;
  if (!currentUser) return;

  var currentObj = { username: currentUser, displayName: currentDisplayName || currentUser, avatar: currentAvatar };
  var currentEl = renderUserItem(currentObj, true);
  var otherUsers = users.filter(function(u) {
    var uname = typeof u === 'string' ? u : u.username;
    return uname !== currentUser;
  }).map(function(u) {
    return renderUserItem(u, false);
  }).join('');

  allUsersList.innerHTML = currentEl + otherUsers;

  allUsersList.querySelectorAll('.user-item[data-user]').forEach(function(el) {
    el.addEventListener('click', function() { openPrivateChat(el.dataset.user); });
    var pmIcon = el.querySelector('.pm-icon');
    if (pmIcon) pmIcon.addEventListener('click', function(e) {
      e.stopPropagation();
      openPrivateChat(el.dataset.user);
    });
  });
}

socket.on('room-message', function(msg) {
  if (msg.sender !== currentUser) playNotification();
  if (!privateRecipient) renderMessage(msg);
});

socket.on('room-unread-update', function(data) {
  roomUnreadCounts[data.room] = data.count;
  renderRooms();
  updateRoomTotalBadge();
});

socket.on('private-message', function(msg) {
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
    loadConversations();

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

socket.on('display-name-updated', function(data) {
  if (data.username === currentUser) {
    currentDisplayName = data.displayName;
    displayName.textContent = data.displayName;
  }
  loadConversations();
});

socket.on('avatar-updated', function(data) {
  if (data.username === currentUser) {
    currentAvatar = data.avatar;
    updateHeaderAvatar();
  }
  loadConversations();
});

socket.on('room-created', function(data) {
  rooms.push({ name: data.name, hasPassword: !!data.hasPassword, temporary: !!data.temporary });
  renderRooms();
  if (sidebarTab === 'admin') renderAdminPanel();
  showToast('Sala #' + data.name + ' creada');
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

socket.on('force-disconnect', function(data) {
  alert(data.reason || 'Has sido desconectado');
  localStorage.removeItem('chat_user');
  localStorage.removeItem('chat_pass');
  location.reload();
});

// Certificado banner logic
const certBanner = $('cert-banner');
const certDismissBtn = $('cert-dismiss-btn');
const certInstructBtn = $('cert-instruct-btn');
const certModalOverlay = $('cert-modal-overlay');
const certModalClose = $('cert-modal-close');
const certModalOk = $('cert-modal-ok');

function showCertBannerIfNeeded() {
  if (location.protocol !== 'https:') return;
  if (localStorage.getItem('cert_dismissed')) return;
  certBanner.classList.remove('hidden');
}

certDismissBtn.addEventListener('click', function() {
  certBanner.classList.add('hidden');
  localStorage.setItem('cert_dismissed', '1');
});

certInstructBtn.addEventListener('click', function() {
  certModalOverlay.classList.remove('hidden');
});

function closeCertModal() {
  certModalOverlay.classList.add('hidden');
}

certModalClose.addEventListener('click', closeCertModal);
certModalOk.addEventListener('click', closeCertModal);
certModalOverlay.addEventListener('click', function(e) {
  if (e.target === certModalOverlay) closeCertModal();
});

// Privacy banner
const privacyBanner = $('privacy-banner');
const privacyBannerClose = $('privacy-banner-close');

if (privacyBannerClose) {
  privacyBannerClose.addEventListener('click', function() {
    privacyBanner.classList.add('hidden');
  });
}

document.addEventListener('DOMContentLoaded', function() {
  showCertBannerIfNeeded();
  if (!tryAutoLogin()) {
    loginUsername.focus();
  }
  if (privacyBanner) {
    privacyBanner.classList.remove('hidden');
  }
});
