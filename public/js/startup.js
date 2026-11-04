// Arranque: desconexión forzada, reconexión, avisos de certificado y privacidad, y conexión al servidor.

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
// Tras un reinicio vuelven todos los navegadores casi a la vez: cada uno espera un momento al azar (hasta
// RELOAD_SPREAD_MS) y revisa que el servidor responda antes de recargar; si no responde, lo intenta más tarde.
// Así no llegan todos en el mismo segundo y nadie queda en la pantalla "No se puede acceder a este sitio".
var RELOAD_SPREAD_MS = 10000;
var hasConnectedOnce = false;
var reloadScheduled = false;
function reloadWhenServerReady(firstTry) {
  var wait = firstTry ? Math.random() * RELOAD_SPREAD_MS : 2000 + Math.random() * RELOAD_SPREAD_MS;
  setTimeout(function() {
    fetch('/', { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' })
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        location.reload();
      })
      .catch(function() { reloadWhenServerReady(false); });
  }, wait);
}
socket.on('connect', function() {
  if (hasConnectedOnce && currentUser && !sessionReplaced && getStoredSession()) {
    if (!reloadScheduled) {
      reloadScheduled = true;
      showToast('Conexión recuperada. Actualizando el chat…');
      reloadWhenServerReady(true);
    }
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
  // Solo en la red local (se entra por IP, con el certificado propio del chat). En la web, con dominio y
  // certificado real, nunca se pide instalar un certificado.
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(location.hostname) && location.hostname !== 'localhost') return;
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
  if (!tryAutoLogin() && !tryRestoreTwoFactor()) {
    loginUsername.focus();
  }
  if (privacyBanner) {
    privacyBanner.classList.remove('hidden');
  }
});

socket.connect();
