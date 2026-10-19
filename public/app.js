const socket = io();

let currentUser = null;
let currentUploadToken = null;
let currentDisplayName = null;
let currentAvatar = null;
let currentLocation = '';
let currentRoom = null;
let privateRecipient = null;
let currentGroup = null; // id del grupo abierto
let groups = [];
let groupInvitations = [];
let groupUnreadCounts = {};
let lastRoomUsers = [];
let roomUsersHidden = false; // salas globales: el servidor no envía quiénes están (ni cuántos)
let allOnlineUsers = []; // lista "Conectados": llega completa al entrar y luego solo con cambios
let rooms = [];
let conversations = [];
let unreadCounts = {};
let roomUnreadCounts = {};
let unreadTotal = 0;
let pendingPasswordRoom = null;
let sidebarTab = 'rooms';
let roomPasswords = {};
let currentRole = 'user';
// Administrador general (admin sin departamentos asignados). Un admin con departamentos solo administra los suyos.
let currentSuperAdmin = false;
let currentDepartment = null;
let currentDepartmentDisplayName = null;
let pendingFile = null;
let replyingTo = null;
let departments = [];
let myDepartments = [];
let myAdminDepartments = []; // departamentos donde este usuario es admin (en los demás es usuario normal)
let friends = [];
let friendRequestsIncoming = [];
let pendingRegistrations = [];
let alertHistory = [];
let alertHistoryHasMore = false;
let loadingAlertHistory = false;

const $ = (id) => document.getElementById(id);

const loginScreen = $('login-screen');
const chatScreen = $('chat-screen');

const loginUsername = $('login-username');
const loginPassword = $('login-password');
const loginBtn = $('login-btn');
const loginError = $('login-error');

const registerUsername = $('register-username');
const registerEmail = $('register-email');
const registerPassword = $('register-password');
const registerConfirm = $('register-confirm');
const registerBtn = $('register-btn');

const displayName = $('display-name');
const headerDepartment = $('header-department');
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
const friendsList = $('friends-list');
const friendsTotalBadge = $('friends-total-badge');
const friendRequestsSection = $('friend-requests-section');
const friendRequestsList = $('friend-requests-list');
const addFriendBtn = $('add-friend-btn');
const addFriendModalOverlay = $('add-friend-modal-overlay');
const addFriendModalClose = $('add-friend-modal-close');
const addFriendSearch = $('add-friend-search');
const addFriendResults = $('add-friend-results');
const addFriendError = $('add-friend-error');
const roomTotalBadge = $('room-total-badge');
const allUsersList = $('all-users-list');
const adminTab = $('admin-tab');
const adminUsersList = $('admin-users-list');
const adminPendingSection = $('admin-pending-section');
const adminPendingList = $('admin-pending-list');
const adminPendingBadge = $('admin-pending-badge');
const adminAlertsList = $('admin-alerts-list');
const adminErrorsList = $('admin-errors-list');
const adminErrorsBadge = $('admin-errors-badge');
const adminErrorsOnlyPending = $('admin-errors-only-pending');
const adminErrorsRefresh = $('admin-errors-refresh');
const adminErrorsLoadMore = $('admin-errors-load-more');
const adminAlertsLoadMore = $('admin-alerts-load-more');
const adminRoomsList = $('admin-rooms-list');
const adminDepartmentsList = $('admin-departments-list');
const createDeptBtn = $('create-dept-btn');
const createDeptModalOverlay = $('create-dept-modal-overlay');
const createDeptDisplayname = $('create-dept-displayname');
const createDeptError = $('create-dept-error');
const createDeptConfirm = $('create-dept-confirm');
const createDeptCancel = $('create-dept-cancel');
const createDeptClose = $('create-dept-modal-close');
const adminEditOverlay = $('admin-edit-user-overlay');
const adminEditUsernameDisplay = $('admin-edit-username-display');
const adminEditDisplayname = $('admin-edit-displayname');
const adminEditEmail = $('admin-edit-email');
const adminEditRole = $('admin-edit-role');
const adminEditDepartments = $('admin-edit-departments');
const adminEditError = $('admin-edit-error');
const adminEditConfirm = $('admin-edit-confirm');
const adminEditCancel = $('admin-edit-cancel');
const adminEditClose = $('admin-edit-user-close');
const adminEditPassword = $('admin-edit-password');
const adminEditPasswordConfirm = $('admin-edit-password-confirm');
const adminEditDeleteBtn = $('admin-edit-delete-btn');
const adminEditBlockBtn = $('admin-edit-block-btn');
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
const contextGlobalBadge = $('context-global-badge');
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
const createModalDeptGroup = $('create-modal-dept-group');
const createModalDepartment = $('create-modal-department');
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
const switchDeptBtn = $('switch-dept-btn');
const departmentSelectOverlay = $('department-select-overlay');
const departmentSelectTitle = $('department-select-title');
const departmentSelectIntro = $('department-select-intro');
const departmentSelectList = $('department-select-list');
const departmentSelectError = $('department-select-error');
const departmentSelectClose = $('department-select-close');

var panicAudio = new Audio('/sounds/alerta.mp3');
panicAudio.preload = 'auto';

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
  showToast('Puedes adjuntar archivos de máximo 2 MB');
  fileInput.click();
});

fileInput.addEventListener('change', function() {
  var file = fileInput.files[0];
  if (!file) return;

  if (file.size > 2 * 1024 * 1024) {
    showToast('El archivo es demasiado grande (máximo 2 MB)');
    fileInput.value = '';
    return;
  }

  var formData = new FormData();
  formData.append('file', file);

  fetch('/api/upload', { method: 'POST', body: formData, headers: uploadHeaders() })
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
      fetch('/api/upload', { method: 'POST', body: formData, headers: uploadHeaders() })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data.error) { showToast(data.error); return; }
          var payload = { content: '', file: data };
          if (replyingTo) payload.reply = replyingTo;
          var onSent = function(res) {
            if (res && res.ok === false) showToast(res.error || 'No se pudo enviar el audio');
          };
          if (privateRecipient) {
            payload.recipient = privateRecipient;
            socket.emit('private-message', payload, onSent);
            setTimeout(loadConversations, 100);
          } else if (currentGroup) {
            payload.groupId = currentGroup;
            socket.emit('group-message', payload, onSent);
          } else if (currentRoom) {
            socket.emit('room-message', payload, onSent);
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

let twoFactorState = null; // { username, opts, callback, setup }
let twoFactorInterval = null;

function showLoginBox(formId) {
  document.querySelectorAll('.login-form-box').forEach(f => f.classList.add('hidden'));
  $(formId).classList.remove('hidden');
  document.querySelector('.login-tabs').classList.toggle('hidden', formId === 'twofactor-form');
}

function openTwoFactor(username, res, opts, callback) {
  twoFactorState = { username: username, opts: opts, callback: callback, setup: !!res.setup };
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
  startTwoFactorTimer((res.expiresInSeconds || 300) * 1000);
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
  socket.emit('two-factor-set-email', { email: email }, function(res) {
    twofactorEmailBtn.disabled = false;
    if (!res.ok) { loginError.textContent = res.error; return; }
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
  socket.emit('two-factor-verify', { code: code, remember: $('twofactor-remember').checked }, function(res) {
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
  socket.emit('two-factor-resend', function(res) {
    twofactorResendBtn.disabled = false;
    if (!res.ok) { loginError.textContent = res.error; return; }
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
  if (!password || password.length < 3) { loginError.textContent = 'Minimo 3 caracteres'; return; }
  if (password !== confirm) { loginError.textContent = 'No coinciden'; return; }

  pendingRegistration = { username, email, password };
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

function loadConversations() {
  socket.emit('get-conversations', function(conv) {
    conversations = conv || [];
    renderConversations();
  });
}

function initializeChat() {
  renderRooms();
  loadConversations();
  loadGroups();
  loadFriendRequests();
  if (currentSuperAdmin) loadPendingRegistrations();
  socket.emit('get-all-users', function(users) {
    renderAllUsers(users);
  });
  const defaultRoom = rooms.length > 0 ? rooms[0].name : 'general';
  joinRoom({ name: defaultRoom });
}

const adminView = $('admin-view');
const chatTopbar = $('chat-topbar');
const messagesContainer = $('messages-container');
const messageInputArea = $('message-input-area');
const sidebarUsers = $('sidebar-users');

function showAdminView() {
  document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.add('hidden'));
  chatTopbar.classList.add('hidden');
  messagesContainer.classList.add('hidden');
  messageInputArea.classList.add('hidden');
  sidebarUsers.classList.add('hidden');
  adminView.classList.remove('hidden');
  renderAdminPanel();
  onActionCloseDrawers();
}

function hideAdminView() {
  adminView.classList.add('hidden');
  chatTopbar.classList.remove('hidden');
  messagesContainer.classList.remove('hidden');
  messageInputArea.classList.remove('hidden');
  sidebarUsers.classList.remove('hidden');
}

document.querySelectorAll('.sidebar-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    sidebarTab = tab.dataset.panel;
    if (sidebarTab === 'admin') {
      showAdminView();
    } else {
      hideAdminView();
      document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.add('hidden'));
      $(sidebarTab + '-panel').classList.remove('hidden');
      if (sidebarTab === 'friends') {
        loadFriends();
        loadFriendRequests();
      }
      if (sidebarTab === 'groups') loadGroups();
    }
  });
});

document.querySelectorAll('.admin-subtab').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.admin-subtab').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    document.querySelectorAll('.admin-subtab-panel').forEach(function(p) { p.classList.add('hidden'); });
    $('admin-subtab-' + btn.dataset.adminTab).classList.remove('hidden');
  });
});

function filterAdminList(listEl, query) {
  var q = query.trim().toLowerCase();
  Array.from(listEl.children).forEach(function(row) {
    row.classList.toggle('hidden', !!q && row.textContent.toLowerCase().indexOf(q) === -1);
  });
}

$('admin-dept-search').addEventListener('input', function() { filterAdminList(adminDepartmentsList, this.value); });
$('admin-users-search').addEventListener('input', function() { filterAdminList(adminUsersList, this.value); });
$('admin-rooms-search').addEventListener('input', function() { filterAdminList(adminRoomsList, this.value); });

function renderRooms() {
  roomsList.innerHTML = rooms.map(function(r) {
    var icon = 'fas fa-hashtag';
    var extra = '';
    if (r.hasPassword) { icon = 'fas fa-lock'; extra = ' room-icon-lock'; }
    if (r.temporary) { icon = 'far fa-clock'; extra = ' room-icon-temp'; }
    var unread = roomUnreadCounts[r.name] || 0;
    var badgeHtml = unread > 0 ? '<span class="room-badge">' + unread + '</span>' : '';
    var globalHtml = !r.department ? '<span class="room-global-badge" title="Sala global: accesible desde todos los departamentos">Global</span>' : '';
    return '<div class="room-item' + (r.name === currentRoom ? ' active' : '') + (unread > 0 ? ' unread' : '') + '" data-room="' + escapeHtml(r.name) + '">' +
      '<i class="' + icon + extra + '"></i>' +
      '<span class="room-name">' + escapeHtml(r.name) + '</span>' + globalHtml + badgeHtml + '</div>';
  }).join('');

  roomsList.querySelectorAll('.room-item').forEach(function(el) {
    el.addEventListener('click', function() {
      var room = el.dataset.room;
      if (room !== currentRoom || privateRecipient || currentGroup) {
        cancelPrivate();
        joinRoom({ name: room });
      }
    });
  });
}

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

  socket.emit('get-all-registered-users', function(users) {
    adminUsersList.innerHTML = users.filter(function(u) { return u.status !== 'pending'; }).map(function(u) {
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
        '<button class="admin-user-edit-btn btn-icon" data-username="' + escapeHtml(u.username) + '" data-displayname="' + escapeHtml(u.displayName || u.username) + '" data-role="' + u.role + '" data-departments="' + escapeHtml((u.departments || []).join(',')) + '" data-admin-departments="' + escapeHtml(adminDepts.join(',')) + '" data-fully-managed="' + (u.fullyManaged ? '1' : '0') + '" data-email="' + escapeHtml(u.email || '') + '" data-status="' + escapeHtml(u.status || 'active') + '" title="Editar usuario"><i class="fas fa-pen"></i></button>' +
      '</div>';
    }).join('');

    adminUsersList.querySelectorAll('.admin-user-edit-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
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
    });
  });

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
    if (newPassword.length < 3) { adminEditError.textContent = 'Contraseña: mínimo 3 caracteres'; return; }
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

var historyOldestId = null;
var historyHasMore = false;
var loadingMoreHistory = false;

function renderMessages(messages, hasMore) {
  messagesList.innerHTML = '';
  historyOldestId = messages.length > 0 ? messages[0].id : null;
  historyHasMore = !!hasMore;
  loadingMoreHistory = false;
  messagesStart.classList.toggle('hidden', messages.length > 0);
  if (messages.length === 0) return;

  var lastDate = null;
  messages.forEach(function(m) {
    renderMessage(m, false, lastDate);
    lastDate = m.created_at ? new Date(m.created_at).toDateString() : null;
  });
  updateHistoryTopIndicator();
  scrollToBottom();
}

function loadMoreHistory() {
  if (loadingMoreHistory || !historyHasMore || historyOldestId === null) return;
  if (!currentRoom && !privateRecipient && !currentGroup) return;

  loadingMoreHistory = true;
  showHistoryLoadingIndicator(true);

  var payload = { beforeId: historyOldestId };
  if (privateRecipient) {
    payload.with = privateRecipient;
  } else if (currentGroup) {
    payload.group = currentGroup;
  } else {
    payload.room = currentRoom;
  }

  socket.emit('get-more-messages', payload, function(res) {
    loadingMoreHistory = false;
    showHistoryLoadingIndicator(false);
    if (!res || !res.messages) return;
    historyHasMore = !!res.hasMore;
    if (res.messages.length > 0) {
      historyOldestId = res.messages[0].id;
      prependMessages(res.messages);
    }
    updateHistoryTopIndicator();
  });
}

function prependMessages(olderMessages) {
  if (!olderMessages || olderMessages.length === 0) return;
  var prevScrollHeight = messagesContainer.scrollHeight;
  var prevScrollTop = messagesContainer.scrollTop;

  var oldFirstMsgEl = messagesList.querySelector('.message');
  var oldFirstDate = oldFirstMsgEl ? oldFirstMsgEl.dataset.messageDate : null;
  var oldLeadingDivider = messagesList.firstChild && messagesList.firstChild.classList && messagesList.firstChild.classList.contains('message-divider')
    ? messagesList.firstChild : null;

  var frag = document.createDocumentFragment();
  var lastDate = null;
  olderMessages.forEach(function(m) {
    var msgDate = m.created_at ? new Date(m.created_at).toDateString() : null;
    if (lastDate !== msgDate && msgDate) {
      frag.appendChild(buildDateDivider(m));
    }
    frag.appendChild(buildMessageElement(m, false));
    lastDate = msgDate;
  });

  if (oldLeadingDivider && lastDate && oldFirstDate === lastDate) {
    oldLeadingDivider.remove();
  }

  messagesList.insertBefore(frag, messagesList.firstChild);
  messagesContainer.scrollTop = prevScrollTop + (messagesContainer.scrollHeight - prevScrollHeight);
}

function updateHistoryTopIndicator() {
  var existing = $('history-top-msg');
  if (existing) existing.remove();
  if (historyHasMore || messagesList.children.length === 0) return;
  var marker = document.createElement('div');
  marker.id = 'history-top-msg';
  marker.className = 'history-top-indicator';
  marker.textContent = 'Inicio de la conversación';
  messagesList.insertBefore(marker, messagesList.firstChild);
}

function showHistoryLoadingIndicator(show) {
  var el = $('history-loading-indicator');
  if (show) {
    if (!el) {
      el = document.createElement('div');
      el.id = 'history-loading-indicator';
      el.className = 'history-loading-indicator';
      el.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cargando mensajes anteriores...';
      messagesList.insertBefore(el, messagesList.firstChild);
    }
  } else if (el) {
    el.remove();
  }
}

messagesContainer.addEventListener('scroll', function() {
  if (messagesContainer.scrollTop < 80) {
    loadMoreHistory();
  }
});

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

function buildDateDivider(msg) {
  var divider = document.createElement('div');
  divider.className = 'message-divider';
  divider.textContent = new Date(msg.created_at).toLocaleDateString('es-CL', {
    weekday: 'long', day: 'numeric', month: 'long'
  });
  return divider;
}

function buildMessageElement(msg, animate) {
  if (animate === undefined) animate = true;
  var isPrivate = msg.type === 'private';
  var isSelf = msg.sender === currentUser;
  var msgDate = msg.created_at ? new Date(msg.created_at).toDateString() : null;

  var el = document.createElement('div');
  el.className = 'message ' + (isSelf ? 'self' : 'other') + (isPrivate ? ' private' : '');
  if (!animate) el.style.animation = 'none';
  if (msg.id) el.dataset.messageId = msg.id;
  if (msgDate) el.dataset.messageDate = msgDate;

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
  var fileUrl = msg.file ? safeUploadUrl(msg.file.url) : null;
  if (fileUrl) {
    var fileType = String(msg.file.type || '');
    if (fileType.startsWith('image/')) {
      fileHtml = '<div class="msg-file"><img src="' + escapeHtml(fileUrl) + '" alt="' + escapeHtml(msg.file.name) + '" class="msg-image" loading="lazy" /></div>';
    } else if (fileType.startsWith('audio/')) {
      fileHtml = '<div class="msg-file msg-audio"><audio src="' + escapeHtml(fileUrl) + '" controls preload="metadata"></audio></div>';
    } else {
      fileHtml = '<div class="msg-file"><i class="fas fa-file"></i> <a href="' + escapeHtml(fileUrl) + '" target="_blank" download>' + escapeHtml(msg.file.name) + '</a> <span class="msg-file-size">' + formatFileSize(Number(msg.file.size) || 0) + '</span></div>';
    }
  }

  var replyHtml = '';
  if (msg.reply) {
    var replyIdNum = Number(msg.reply.id);
    var replyId = Number.isFinite(replyIdNum) && replyIdNum ? ' data-reply-id="' + replyIdNum + '"' : '';
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

  return el;
}

function renderMessage(msg, animate, lastDate) {
  var msgDate = msg.created_at ? new Date(msg.created_at).toDateString() : null;
  if (lastDate !== msgDate && msgDate) {
    messagesList.appendChild(buildDateDivider(msg));
  }
  messagesList.appendChild(buildMessageElement(msg, animate));
  scrollToBottom();
}

// Navigate to replied message on click
messagesList.addEventListener('click', function(e) {
  if (e.target.classList.contains('msg-image')) {
    openImageModal(e.target.getAttribute('src'));
    return;
  }
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
      } else {
        showToast('El mensaje original no está cargado, sube para verlo');
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

  // Si el servidor no pudo guardar el mensaje, avisa y devuelve el texto al cuadro para no perderlo.
  var onSent = function(res) {
    if (res && res.ok === false) {
      showToast(res.error || 'No se pudo enviar el mensaje');
      if (content && !messageInput.value) messageInput.value = content;
    }
  };

  if (privateRecipient) {
    payload.recipient = privateRecipient;
    socket.emit('private-message', payload, onSent);
    setTimeout(loadConversations, 100);
  } else if (currentGroup) {
    payload.groupId = currentGroup;
    socket.emit('group-message', payload, onSent);
  } else if (currentRoom) {
    socket.emit('room-message', payload, onSent);
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
  exitGroupMode();
  privateRecipient = username;

  unreadCounts[username] = 0;
  updateConvTotalBadge();
  renderConversations();

  contextName.textContent = username;
  contextIcon.className = 'fas fa-lock';
  contextBadge.classList.remove('hidden');
  contextGlobalBadge.classList.add('hidden');
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
  exitGroupMode();
  privateIndicator.classList.add('hidden');
  cancelReply();

  if (currentRoom) {
    contextName.textContent = currentRoom;
    var curRoomData = rooms.find(function(r) { return r.name === currentRoom; });
    if (curRoomData && curRoomData.hasPassword) contextIcon.className = 'fas fa-lock';
    else if (curRoomData && curRoomData.temporary) contextIcon.className = 'far fa-clock';
    else contextIcon.className = 'fas fa-hashtag';
    contextBadge.classList.add('hidden');
    contextGlobalBadge.classList.toggle('hidden', !!(curRoomData && curRoomData.department));
    backToRoomBtn.classList.add('hidden');
    messageInput.placeholder = 'Escribe en #' + currentRoom + '...';

    socket.emit('join-room', { name: currentRoom }, function(res) {
      if (res?.ok) {
        roomUnreadCounts[currentRoom] = 0;
        renderRooms();
        updateRoomTotalBadge();
        renderUsers(res.users || []);
        renderMessages(res.history, res.hasMoreHistory);
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
  socket.emit('get-private-history', { with: username }, function(res) {
    renderMessages(res.history, res.hasMoreHistory);
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
  if (!privateRecipient && !currentGroup) renderMessage(msg);
});

socket.on('room-unread-update', function(data) {
  roomUnreadCounts[data.room] = data.count;
  renderRooms();
  updateRoomTotalBadge();
});

// Mensaje nuevo en una sala que puedo ver pero en la que no estoy: suma uno a su contador.
socket.on('room-unread-increment', function(data) {
  if (!data || !data.room || data.room === currentRoom) return;
  roomUnreadCounts[data.room] = (roomUnreadCounts[data.room] || 0) + 1;
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
  roomUsersList.querySelectorAll('.user-item[data-user]').forEach(function(el) {
    el.addEventListener('click', function() { openPrivateChat(el.dataset.user); });
  });
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

var sessionReplaced = false;

socket.on('force-disconnect', function(data) {
  if (data.replaced) {
    // La misma sesión se abrió en otra pestaña: esta se desactiva sin borrar la sesión (la otra la sigue usando).
    sessionReplaced = true;
    chatScreen.classList.add('hidden');
    loginScreen.classList.add('hidden');
    var box = document.createElement('div');
    box.className = 'session-replaced';
    box.innerHTML = '<div class="modal-box"><div class="modal-body" style="text-align:center;">' +
      '<p style="margin-bottom:16px;"><i class="fas fa-clone"></i> ' + escapeHtml(data.reason) + '</p>' +
      '<button class="btn-primary" type="button">Usar el chat aquí</button></div></div>';
    box.querySelector('button').addEventListener('click', function() { location.reload(); });
    document.body.appendChild(box);
    return;
  }
  alert(data.reason || 'Has sido desconectado');
  clearStoredSession();
  location.reload();
});

// Si se corta la conexión (p. ej. se reinició el servidor), al volver se recarga la página:
// la sesión guardada permite reingresar solo, sin contraseña ni código.
var hasConnectedOnce = false;
socket.on('connect', function() {
  if (hasConnectedOnce && currentUser && !sessionReplaced && getStoredSession()) {
    location.reload();
    return;
  }
  hasConnectedOnce = true;
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
  loadDepartments();
  loadEmailDomains();
  if (!tryAutoLogin()) {
    loginUsername.focus();
  }
  if (privacyBanner) {
    privacyBanner.classList.remove('hidden');
  }
});
