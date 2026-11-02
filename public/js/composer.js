// Caja de mensaje: emojis, adjuntar archivos, grabar audio y ver imágenes en grande.

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
