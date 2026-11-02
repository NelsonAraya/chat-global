// Estructura de la pantalla: menús en el celular, notificaciones, pestañas y lista de salas.

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
}

// Las listas se redibujan seguido (no leídos, entradas y salidas): un solo manejador por lista en vez de uno
// por elemento en cada redibujo.
roomsList.addEventListener('click', function(e) {
  var el = e.target.closest('.room-item');
  if (!el) return;
  var room = el.dataset.room;
  if (room !== currentRoom || privateRecipient || currentGroup) {
    cancelPrivate();
    joinRoom({ name: room });
  }
});
