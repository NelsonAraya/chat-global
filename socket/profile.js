// Perfil propio: nombre, foto, contraseña y ubicación.
const { str } = require('./validation');

module.exports = (ctx) => {
  const { users, findUser, announceUserUpdate, takeUpload, returnUpload, lockMinutesLeft, lockedError,
    registerFailure, LOGIN_MAX_FAILS_PER_USER, clearFailures, MIN_PASSWORD_LENGTH, PASSWORD_LENGTH_ERROR } = ctx;
  const { saveUserFields, verifyPassword, hashPassword, deleteUserSessions } = ctx.db;

  return (socket) => {
    socket.on('update-display-name', (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.({ ok: false, error: 'No autenticado' });

      const displayName = str(data_?.displayName).trim();
      if (!displayName) return callback?.({ ok: false, error: 'Nombre requerido' });
      if (displayName.length > 40) return callback?.({ ok: false, error: 'Maximo 40 caracteres' });

      user.displayName = displayName;
      const record = findUser(user.username);
      if (record) {
        record.displayName = displayName;
        saveUserFields(record, ['displayName']).catch(err => console.error('saveUser error:', err));
      }
      socket.displayName = displayName;
      announceUserUpdate(user);
      callback?.({ ok: true, displayName });
    });

    socket.on('update-avatar', (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.({ ok: false, error: 'No autenticado' });

      const avatar = data_?.avatar || null;
      // La foto debe ser una imagen que subió esta misma persona (ver "Archivos subidos").
      if (avatar !== null && avatar !== user.avatar) {
        const upload = takeUpload(avatar, user.username);
        if (!upload || !upload.file.type.startsWith('image/')) {
          returnUpload(upload);
          return callback?.({ ok: false, error: 'Imagen no válida' });
        }
      }
      user.avatar = avatar;
      const record = findUser(user.username);
      if (record) {
        record.avatar = avatar;
        saveUserFields(record, ['avatar']).catch(err => console.error('saveUser error:', err));
      }
      socket.avatar = avatar;
      announceUserUpdate(user);
      callback?.({ ok: true, avatar });
    });

    socket.on('change-password', async (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.({ ok: false, error: 'No autenticado' });

      const currentPassword = str(data_?.currentPassword);
      const newPassword = str(data_?.newPassword);
      if (!currentPassword) return callback?.({ ok: false, error: 'Contraseña actual requerida' });
      if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) return callback?.({ ok: false, error: PASSWORD_LENGTH_ERROR });

      const record = findUser(user.username);
      if (!record) return callback?.({ ok: false, error: 'Usuario no encontrado' });
      const pwdKey = 'change-pwd:' + user.username;
      const pwdLocked = lockMinutesLeft(pwdKey);
      if (pwdLocked > 0) return callback?.({ ok: false, error: lockedError(pwdLocked) });
      if (!(await verifyPassword(String(currentPassword), record.password))) {
        registerFailure(pwdKey, LOGIN_MAX_FAILS_PER_USER);
        return callback?.({ ok: false, error: 'Contraseña actual incorrecta' });
      }
      clearFailures(pwdKey);

      const previousPassword = record.password;
      record.password = await hashPassword(String(newPassword));
      try {
        await saveUserFields(record, ['password']);
      } catch (err) {
        console.error('saveUser error:', err);
        record.password = previousPassword;
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }
      // Cierra las sesiones recordadas en otros equipos; la actual sigue abierta.
      deleteUserSessions(user.username, user.sessionHash).catch(err => console.error('deleteUserSessions error:', err));
      callback?.({ ok: true });
    });

    socket.on('update-location', (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return;

      const location = str(data_?.location).trim();
      if (location.length > 100) {
        return callback?.({ ok: false, error: 'Máximo 100 caracteres' });
      }

      user.location = location;
      const record = findUser(user.username);
      if (record) {
        record.location = location || null;
        saveUserFields(record, ['location']).catch(err => console.error('saveUser error:', err));
      }
      callback?.({ ok: true, location });
    });
  };
};
