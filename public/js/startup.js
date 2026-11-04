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
// En el celular la conexión se corta cada vez que el chat queda en segundo plano. Ese corte no es un reinicio
// del servidor (no vuelven todos a la vez), así que al volver se recarga casi enseguida en vez de esperar al azar.
// Cuenta como "volver del segundo plano" solo si el corte se detectó con la página oculta o en los primeros
// segundos tras volver a verla (en segundo plano el navegador congela la página y el aviso llega al volver).
// No basta con "estuvo oculta alguna vez": en un PC eso pasa al cambiar de pestaña, y tras un reinicio del
// servidor cientos de PC recargarían en el mismo medio segundo.
var BACKGROUND_RETURN_MS = 5000;
var visibleSince = 0; // 0 = la página no ha vuelto del segundo plano desde que se abrió
var cutInBackground = false;
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible') visibleSince = Date.now();
});
socket.on('disconnect', function() {
  cutInBackground = document.visibilityState === 'hidden' ||
    (visibleSince > 0 && Date.now() - visibleSince < BACKGROUND_RETURN_MS);
});
function reloadWhenServerReady(firstTry) {
  // Además debe estar a la vista: un PC con la ventana minimizada durante un reinicio sigue esperando al azar.
  var spread = cutInBackground && document.visibilityState === 'visible' ? 500 : RELOAD_SPREAD_MS;
  var wait = firstTry ? Math.random() * spread : 2000 + Math.random() * spread;
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
