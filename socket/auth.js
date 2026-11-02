// Registro, inicio de sesión con doble factor, reanudar sesión, departamento activo y desconexión.
const crypto = require('crypto');
const { sendLoginCodeEmail } = require('../mailer');
const { clientIp, str, normalizeEmail, emailError, ALLOWED_EMAIL_DOMAINS, maskEmail } = require('./validation');
const { adminDeptsOf, isSuperAdmin } = require('./permissions');

module.exports = (ctx) => {
  const { hashToken, SESSION_REMEMBER_MS, SESSION_TTL_MS, isOnline, setSocketSession, uploadTokens, users,
    socketIdByUsername, visibilityRoomsFor, AUTH_ROOM, announceOnline, notifyFriendsOfStatusChange, data,
    getAllRooms, departmentOptions, findUser, emailInUse, io, ADMIN_ROOM, lockMinutesLeft, lockedError,
    registerFailure, LOGIN_MAX_FAILS_PER_USER, MIN_PASSWORD_LENGTH, PASSWORD_LENGTH_ERROR, clearFailures, SESSION_TOKEN_RE, onlineSid, kickUser, presenceRooms,
    movePresence, getAllUsers, leaveRoomIfNoAccess, roomUsers, isGlobalRoom, announceOffline, scheduleSessionClose,
    cleanupTemporaryRoom } = ctx;
  const { updateSessionDepartment, saveSession, hashPassword, saveUser, saveConsent, verifyPassword, isLegacyHash,
    saveUserFields, getSession, deleteSession } = ctx.db;

  // ===== Doble factor: código temporal enviado al correo registrado =====
  const OTP_TTL_MINUTES = 5;
  const OTP_TTL_MS = OTP_TTL_MINUTES * 60 * 1000;
  const OTP_MAX_ATTEMPTS = 5;
  const OTP_RESEND_COOLDOWN_MS = 30 * 1000;
  // Máximo de códigos que se envían a un mismo usuario por ventana: limita tanto adivinar
  // códigos (cada uno permite 5 intentos) como llenar de correos a una persona.
  const OTP_MAX_SENDS = 5;
  const OTP_SENDS_WINDOW_MS = 15 * 60 * 1000;
  const loginCodes = new Map(); // username -> { hash, email, expiresAt, attempts, sentAt }

  const codeSends = new Map(); // username -> [timestamps de envío]

  // Minutos que faltan para poder enviar otro código (0 = se puede).
  const codeSendWaitMinutes = (username) => {
    const now = Date.now();
    const recent = (codeSends.get(username) || []).filter(t => now - t < OTP_SENDS_WINDOW_MS);
    codeSends.set(username, recent);
    if (recent.length < OTP_MAX_SENDS) return 0;
    return Math.ceil((recent[0] + OTP_SENDS_WINDOW_MS - now) / 60000);
  };
  const tooManyCodesError = (minutes) => 'Se enviaron demasiados códigos. Espera ' + minutes + ' minuto' + (minutes === 1 ? '' : 's') + ' para pedir otro.';
  const codeSecondsLeft = (entry) => Math.max(1, Math.round((entry.expiresAt - Date.now()) / 1000));

  // Limpieza periódica de los códigos vencidos.
  setInterval(() => {
    const now = Date.now();
    for (const [k, e] of loginCodes) if (e.expiresAt <= now) loginCodes.delete(k);
    for (const [k, list] of codeSends) if (!list.some(t => now - t < OTP_SENDS_WINDOW_MS)) codeSends.delete(k);
  }, 10 * 60 * 1000).unref();

  const hashCode = (code) => crypto.createHash('sha256').update(code).digest('hex');

  const issueLoginCode = async (userRecord, email) => {
    const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
    codeSends.set(userRecord.username, [...(codeSends.get(userRecord.username) || []), Date.now()]);
    loginCodes.set(userRecord.username, { hash: hashCode(code), email, expiresAt: Date.now() + OTP_TTL_MS, attempts: 0, sentAt: Date.now() });
    const sent = await sendLoginCodeEmail(email, code, userRecord.displayName || userRecord.username, OTP_TTL_MINUTES);
    if (!sent && process.env.MODO_WEB === 'true') {
      // En la web el código nunca se deja en la consola: queda registrado el error (sin el código) en el panel.
      loginCodes.delete(userRecord.username);
      throw new Error('No se pudo enviar el código de acceso a ' + userRecord.username + ': el correo (SMTP) no está configurado en .env');
    }
    if (!sent) {
      // Sin SMTP configurado no hay forma de entregar el código: se deja en la consola del servidor
      // para que el administrador pueda dárselo al usuario.
      console.warn(`[2FA] SMTP no configurado. Código de acceso para ${userRecord.username} (${email}): ${code}`);
    }
  };

  // Registro: máximo de solicitudes por hora (en total, no por IP: ver arriba) y tope de cuentas esperando
  // aprobación, para que nadie llene el panel del administrador con solicitudes falsas.
  const REGISTER_MAX_PER_HOUR = 30;
  const REGISTER_WINDOW_MS = 60 * 60 * 1000;
  const MAX_PENDING_REGISTRATIONS = 150;
  let registrationTimes = [];
  const recentRegistrationCount = () => {
    const now = Date.now();
    registrationTimes = registrationTimes.filter(t => now - t < REGISTER_WINDOW_MS);
    return registrationTimes.length;
  };

  // Crea la sesión del navegador (o reutiliza la que se reanudó) y deja al usuario conectado.
  const finalizeLogin = async (socket, userRecord, department, callback) => {
    const role = userRecord.role || 'user';
    const assignedDepartments = userRecord.departments || [];

    let sessionHash = socket.resumedSessionHash || null;
    let sessionToken = null;
    let sessionRemember = !!socket.resumedSessionRemember;
    if (sessionHash) {
      updateSessionDepartment(sessionHash, department).catch(err => console.error('updateSessionDepartment error:', err));
    } else {
      sessionRemember = !!socket.loginRemember;
      sessionToken = crypto.randomBytes(32).toString('base64url');
      sessionHash = hashToken(sessionToken);
      try {
        await saveSession({
          tokenHash: sessionHash,
          username: userRecord.username,
          department,
          remember: sessionRemember,
          created_at: new Date().toISOString(),
          expiresAt: Date.now() + (sessionRemember ? SESSION_REMEMBER_MS : SESSION_TTL_MS),
          ip: clientIp(socket),
          userAgent: socket.handshake.headers?.['user-agent']
        });
      } catch (err) {
        // Sin sesión guardada igual puede entrar; solo tendrá que iniciar sesión otra vez al recargar.
        console.error('saveSession error:', err);
        sessionToken = null;
        sessionHash = null;
      }
    }
    socket.resumedSessionHash = null;
    socket.resumedSessionRemember = false;
    socket.loginRemember = false;

    if (isOnline(userRecord.username)) {
      setSocketSession(socket, null);
      return callback?.({ ok: false, error: 'Ese usuario ya está conectado' });
    }
    setSocketSession(socket, sessionHash);

    const uploadToken = crypto.randomUUID();
    uploadTokens.set(uploadToken, socket.id);
    users.set(socket.id, { username: userRecord.username, currentRoom: null, displayName: userRecord.displayName || userRecord.username, avatar: userRecord.avatar || null, location: userRecord.location || '', role, department, departments: assignedDepartments, adminDepartments: adminDeptsOf(userRecord), uploadToken, sessionHash, sessionRemember });
    socketIdByUsername.set(userRecord.username, socket.id);
    socket.username = userRecord.username;
    socket.displayName = userRecord.displayName || userRecord.username;
    socket.avatar = userRecord.avatar || null;
    socket.location = userRecord.location || '';
    socket.department = department;
    socket.pendingUser = null;
    const onlineUser = users.get(socket.id);
    socket.join(visibilityRoomsFor(onlineUser));
    socket.join(AUTH_ROOM);
    announceOnline(onlineUser);
    notifyFriendsOfStatusChange(userRecord.username);
    const deptRecord = department ? data.departments.find(d => d.name === department) : null;
    callback?.({
      ok: true,
      rooms: getAllRooms(onlineUser),
      superAdmin: isSuperAdmin(onlineUser),
      displayName: userRecord.displayName || userRecord.username,
      avatar: userRecord.avatar || null,
      location: userRecord.location || '',
      role,
      department,
      departmentDisplayName: deptRecord?.displayName || department,
      departments: departmentOptions(assignedDepartments),
      adminDepartments: adminDeptsOf(userRecord),
      uploadToken,
      username: userRecord.username,
      sessionToken,
      sessionRemember
    });
  };

  Object.assign(ctx, { loginCodes });

  return (socket) => {
    socket.on('register', async (data_, callback) => {
      const username = str(data_?.username);
      const password = str(data_?.password);
      const terms_version = data_?.terms_version;
      const email = normalizeEmail(str(data_?.email));
      if (!username.trim()) {
        return callback?.({ ok: false, error: 'Nombre de usuario requerido' });
      }
      if (!password || password.length < MIN_PASSWORD_LENGTH) {
        return callback?.({ ok: false, error: PASSWORD_LENGTH_ERROR });
      }
      const name = username.trim().toLowerCase();
      if (!/^[a-z0-9áéíóúüñ]+$/.test(name)) {
        return callback?.({ ok: false, error: 'Solo letras, números (sin espacios)' });
      }
      if (findUser(name)) {
        return callback?.({ ok: false, error: 'Ese usuario ya existe' });
      }
      const regEmailError = emailError(email);
      if (regEmailError) {
        return callback?.({ ok: false, error: regEmailError });
      }
      if (emailInUse(email)) {
        return callback?.({ ok: false, error: 'Ese correo ya está registrado en otra cuenta' });
      }
      if (!terms_version) {
        return callback?.({ ok: false, error: 'Debes aceptar los Términos y Condiciones' });
      }
      if (recentRegistrationCount() >= REGISTER_MAX_PER_HOUR) {
        return callback?.({ ok: false, error: 'Hay muchas solicitudes de registro en este momento. Inténtalo más tarde.' });
      }
      if (data.users.filter(u => u.status === 'pending').length >= MAX_PENDING_REGISTRATIONS) {
        return callback?.({ ok: false, error: 'Hay muchas solicitudes en revisión. Inténtalo más tarde.' });
      }

      const newUser = {
        username: name,
        password: await hashPassword(password),
        displayName: name,
        avatar: null,
        departments: [],
        adminDepartments: [],
        status: 'pending',
        email,
        twoFactorEnabled: false,
        created_at: new Date().toISOString()
      };
      // Mientras se calculaba la contraseña pudo registrarse alguien con el mismo nombre o correo.
      if (findUser(name)) return callback?.({ ok: false, error: 'Ese usuario ya existe' });
      if (emailInUse(email)) return callback?.({ ok: false, error: 'Ese correo ya está registrado en otra cuenta' });
      data.users.push(newUser);
      try {
        await saveUser(newUser);
        await saveConsent(name, terms_version, new Date().toISOString(), clientIp(socket));
      } catch (err) {
        console.error('register error:', err);
        data.users = data.users.filter(u => u !== newUser);
        return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
      }
      registrationTimes.push(Date.now());

      io.to(ADMIN_ROOM).emit('registration-pending', { username: name, displayName: name, email, created_at: newUser.created_at });

      callback?.({ ok: true, pending: true });
    });

    socket.on('get-email-domains', (callback) => {
      callback?.(ALLOWED_EMAIL_DOMAINS);
    });

    socket.on('get-departments', (callback) => {
      callback?.(data.departments.map(d => ({ name: d.name, displayName: d.displayName })));
    });

    socket.on('login', async (data_, callback) => {
      const username = str(data_?.username);
      const password = str(data_?.password);
      if (!username.trim()) {
        return callback?.({ ok: false, error: 'Nombre de usuario requerido' });
      }
      if (!password) {
        return callback?.({ ok: false, error: 'Contraseña requerida' });
      }
      const name = username.trim().toLowerCase();
      const userKey = 'login-user:' + name;
      const lockedFor = lockMinutesLeft(userKey);
      if (lockedFor > 0) {
        return callback?.({ ok: false, error: lockedError(lockedFor) });
      }

      // Mismo mensaje si el usuario no existe o la contraseña es incorrecta: no revela qué cuentas existen.
      const userRecord = findUser(name);
      if (!userRecord || !(await verifyPassword(String(password), userRecord.password))) {
        registerFailure(userKey, LOGIN_MAX_FAILS_PER_USER);
        const nowLocked = lockMinutesLeft(userKey);
        return callback?.({ ok: false, error: nowLocked > 0 ? lockedError(nowLocked) : 'Usuario o contraseña incorrectos' });
      }
      clearFailures(userKey);
      if (isLegacyHash(userRecord.password)) {
        // Actualiza la contraseña al formato seguro ahora que la conocemos.
        try {
          userRecord.password = await hashPassword(String(password));
          await saveUserFields(userRecord, ['password']);
        } catch (err) {
          console.error('password upgrade error:', err);
        }
      }
      if (userRecord.status === 'pending') {
        return callback?.({ ok: false, error: 'Tu cuenta está pendiente de aprobación por un administrador.' });
      }
      if (userRecord.status === 'rejected') {
        return callback?.({ ok: false, error: 'Tu solicitud de cuenta fue rechazada. Contacta a un administrador.' });
      }
      if (userRecord.status === 'blocked') {
        return callback?.({ ok: false, error: 'Tu cuenta está bloqueada. Contacta a un administrador.' });
      }
      if (isOnline(name)) {
        return callback?.({ ok: false, error: 'Ese usuario ya está conectado' });
      }

      // La contraseña es correcta: ahora se exige el código enviado al correo.
      // La primera vez (doble factor aún no activado) este mismo paso lo activa.
      socket.pendingUser = null;
      socket.resumedSessionHash = null;
      setSocketSession(socket, null);
      const setup = !userRecord.twoFactorEnabled;
      if (!userRecord.email) {
        // Cuentas antiguas sin correo: el usuario debe indicar uno antes de recibir el código.
        socket.twoFactor = { username: name, email: null, setup: true };
        return callback?.({ ok: true, requireTwoFactor: true, setup: true, needEmail: true });
      }

      socket.twoFactor = { username: name, email: userRecord.email, setup };
      // Si ya hay un código vigente (p. ej. recargó la página), se reutiliza en vez de enviar otro:
      // así repetir el login no da intentos nuevos para adivinar ni manda más correos.
      const existing = loginCodes.get(name);
      if (existing && existing.email === userRecord.email && existing.expiresAt > Date.now()) {
        return callback?.({ ok: true, requireTwoFactor: true, setup, maskedEmail: maskEmail(userRecord.email), expiresInSeconds: codeSecondsLeft(existing), reused: true });
      }
      const wait = codeSendWaitMinutes(name);
      if (wait > 0) {
        socket.twoFactor = null;
        return callback?.({ ok: false, error: tooManyCodesError(wait) });
      }
      try {
        await issueLoginCode(userRecord, userRecord.email);
      } catch (err) {
        console.error('issueLoginCode error:', err);
        socket.twoFactor = null;
        return callback?.({ ok: false, error: 'No se pudo enviar el código a tu correo. Intenta de nuevo o contacta a un administrador.' });
      }
      callback?.({ ok: true, requireTwoFactor: true, setup, maskedEmail: maskEmail(userRecord.email), expiresInSeconds: OTP_TTL_MINUTES * 60 });
    });

    socket.on('two-factor-set-email', async (data_, callback) => {
      const pending = socket.twoFactor;
      if (!pending || !pending.setup) return callback?.({ ok: false, error: 'No hay una sesión pendiente' });
      const userRecord = findUser(pending.username);
      if (!userRecord) return callback?.({ ok: false, error: 'Usuario no encontrado' });
      if (userRecord.email) return callback?.({ ok: false, error: 'Tu cuenta ya tiene un correo registrado' });
      // Un administrador no elige su correo al ingresar (quien supiera su contraseña pondría el suyo y
      // quedaría como administrador): se lo registra el administrador general o ADMIN_EMAIL_INICIAL.
      if (userRecord.role === 'admin') {
        return callback?.({ ok: false, error: 'Las cuentas de administrador necesitan un correo registrado por el administrador general' });
      }

      const email = normalizeEmail(str(data_?.email));
      const setEmailError = emailError(email);
      if (setEmailError) return callback?.({ ok: false, error: setEmailError });
      if (emailInUse(email, userRecord.username)) return callback?.({ ok: false, error: 'Ese correo ya está registrado en otra cuenta' });

      const prev = loginCodes.get(userRecord.username);
      if (prev && Date.now() - prev.sentAt < OTP_RESEND_COOLDOWN_MS) {
        return callback?.({ ok: false, error: 'Espera unos segundos antes de pedir otro código' });
      }
      const wait = codeSendWaitMinutes(userRecord.username);
      if (wait > 0) return callback?.({ ok: false, error: tooManyCodesError(wait) });
      pending.email = email;
      try {
        await issueLoginCode(userRecord, email);
      } catch (err) {
        console.error('issueLoginCode error:', err);
        return callback?.({ ok: false, error: 'No se pudo enviar el código a ese correo' });
      }
      callback?.({ ok: true, maskedEmail: maskEmail(email), expiresInSeconds: OTP_TTL_MINUTES * 60 });
    });

    socket.on('two-factor-resend', async (callback) => {
      const pending = socket.twoFactor;
      if (!pending || !pending.email) return callback?.({ ok: false, error: 'No hay una sesión pendiente' });
      const userRecord = findUser(pending.username);
      if (!userRecord) return callback?.({ ok: false, error: 'Usuario no encontrado' });

      const prev = loginCodes.get(userRecord.username);
      if (prev && Date.now() - prev.sentAt < OTP_RESEND_COOLDOWN_MS) {
        return callback?.({ ok: false, error: 'Espera unos segundos antes de pedir otro código' });
      }
      const wait = codeSendWaitMinutes(userRecord.username);
      if (wait > 0) return callback?.({ ok: false, error: tooManyCodesError(wait) });
      try {
        await issueLoginCode(userRecord, pending.email);
      } catch (err) {
        console.error('issueLoginCode error:', err);
        return callback?.({ ok: false, error: 'No se pudo reenviar el código' });
      }
      callback?.({ ok: true, maskedEmail: maskEmail(pending.email), expiresInSeconds: OTP_TTL_MINUTES * 60 });
    });

    socket.on('two-factor-verify', async (data_, callback) => {
      const pending = socket.twoFactor;
      if (!pending || !pending.email) return callback?.({ ok: false, error: 'No hay una sesión pendiente' });
      const userRecord = findUser(pending.username);
      if (!userRecord || userRecord.status !== 'active') {
        socket.twoFactor = null;
        return callback?.({ ok: false, error: 'Tu cuenta no está habilitada', restart: true });
      }

      const entry = loginCodes.get(userRecord.username);
      if (!entry || entry.email !== pending.email) {
        return callback?.({ ok: false, error: 'Solicita un código nuevo' });
      }
      if (Date.now() > entry.expiresAt) {
        loginCodes.delete(userRecord.username);
        return callback?.({ ok: false, error: 'El código venció. Solicita uno nuevo.' });
      }
      const code = str(data_?.code).trim();
      const match = /^\d{6}$/.test(code) &&
        crypto.timingSafeEqual(Buffer.from(hashCode(code), 'hex'), Buffer.from(entry.hash, 'hex'));
      if (!match) {
        entry.attempts++;
        if (entry.attempts >= OTP_MAX_ATTEMPTS) {
          loginCodes.delete(userRecord.username);
          return callback?.({ ok: false, error: 'Demasiados intentos. Solicita un código nuevo.' });
        }
        return callback?.({ ok: false, error: 'Código incorrecto' });
      }
      loginCodes.delete(userRecord.username);
      socket.loginRemember = !!data_?.remember;

      if (pending.setup) {
        if (!userRecord.email && emailInUse(pending.email, userRecord.username)) {
          socket.twoFactor = null;
          return callback?.({ ok: false, error: 'Ese correo ya está registrado en otra cuenta', restart: true });
        }
        const prevEmail = userRecord.email;
        const prevEnabled = userRecord.twoFactorEnabled;
        userRecord.email = pending.email;
        userRecord.twoFactorEnabled = true;
        try {
          await saveUserFields(userRecord, ['email', 'twoFactorEnabled']);
        } catch (err) {
          console.error('saveUser error:', err);
          userRecord.email = prevEmail;
          userRecord.twoFactorEnabled = prevEnabled;
          return callback?.({ ok: false, error: 'Error al guardar en la base de datos' });
        }
      }
      socket.twoFactor = null;

      if (isOnline(userRecord.username)) {
        return callback?.({ ok: false, error: 'Ese usuario ya está conectado', restart: true });
      }

      const assignedDepartments = userRecord.departments || [];
      if (assignedDepartments.length > 1) {
        socket.pendingUser = { username: userRecord.username };
        return callback?.({
          ok: true,
          twoFactorActivated: pending.setup,
          requireDepartment: true,
          departments: departmentOptions(assignedDepartments)
        });
      }

      finalizeLogin(socket, userRecord, assignedDepartments[0] || null, (res) => {
        callback?.({ ...res, twoFactorActivated: pending.setup });
      });
    });

    // Reanuda una sesión con el token guardado en el navegador (recarga de página, reapertura del navegador
    // con "Recordar este equipo", o reconexión tras reiniciar el servidor). No pide contraseña ni código.
    socket.on('resume-session', async (data_, callback) => {
      const token = typeof data_?.token === 'string' ? data_.token : '';
      if (!SESSION_TOKEN_RE.test(token)) return callback?.({ ok: false, expired: true });
      const tokenHash = hashToken(token);

      let session;
      try {
        session = await getSession(tokenHash);
      } catch (err) {
        console.error('getSession error:', err);
        return callback?.({ ok: false, error: 'Error al consultar la base de datos' });
      }
      if (!session || session.expiresAt <= Date.now()) {
        if (session) deleteSession(tokenHash).catch(() => {});
        return callback?.({ ok: false, expired: true });
      }

      const userRecord = findUser(session.username);
      if (!userRecord || userRecord.status !== 'active') {
        deleteSession(tokenHash).catch(() => {});
        return callback?.({ ok: false, expired: true });
      }

      const existingSid = onlineSid(userRecord.username);
      if (existingSid) {
        if (users.get(existingSid).sessionHash !== tokenHash) {
          return callback?.({ ok: false, error: 'Ese usuario ya está conectado en otro equipo' });
        }
        // Misma sesión abierta en otra pestaña (o la conexión vieja de una recarga): se reemplaza.
        kickUser(userRecord.username, 'Abriste el chat en otra pestaña o ventana.', { replaced: true });
      }

      socket.twoFactor = null;
      socket.resumedSessionHash = tokenHash;
      setSocketSession(socket, tokenHash);
      socket.resumedSessionRemember = session.remember;
      const assignedDepartments = userRecord.departments || [];
      if (session.department && assignedDepartments.includes(session.department)) {
        return finalizeLogin(socket, userRecord, session.department, callback);
      }
      if (assignedDepartments.length > 1) {
        socket.pendingUser = { username: userRecord.username };
        return callback?.({ ok: true, username: userRecord.username, requireDepartment: true, departments: departmentOptions(assignedDepartments) });
      }
      finalizeLogin(socket, userRecord, assignedDepartments[0] || null, callback);
    });

    socket.on('logout', async (callback) => {
      const user = users.get(socket.id);
      if (user?.sessionHash) {
        try {
          await deleteSession(user.sessionHash);
        } catch (err) {
          console.error('deleteSession error:', err);
        }
      }
      callback?.({ ok: true });
    });

    socket.on('select-department', (data_, callback) => {
      if (!socket.pendingUser) return callback?.({ ok: false, error: 'No hay una sesión pendiente' });

      const { department } = data_ || {};
      const userRecord = findUser(socket.pendingUser.username);
      if (!userRecord) return callback?.({ ok: false, error: 'Usuario no encontrado' });
      if (userRecord.status !== 'active') {
        socket.pendingUser = null;
        return callback?.({ ok: false, error: 'Tu cuenta no está habilitada' });
      }

      const assignedDepartments = userRecord.departments || [];
      if (!department || !assignedDepartments.includes(department)) {
        return callback?.({ ok: false, error: 'Departamento no válido' });
      }
      if (isOnline(userRecord.username)) {
        return callback?.({ ok: false, error: 'Ese usuario ya está conectado' });
      }

      finalizeLogin(socket, userRecord, department, callback);
    });

    socket.on('switch-department', (data_, callback) => {
      const user = users.get(socket.id);
      if (!user) return callback?.({ ok: false, error: 'No autenticado' });

      const { department } = data_ || {};
      if (!department || !(user.departments || []).includes(department)) {
        return callback?.({ ok: false, error: 'No tienes acceso a ese departamento' });
      }
      if (department === user.department) {
        return callback?.({ ok: false, error: 'Ya estás en ese departamento' });
      }

      // Sale de la vista del departamento anterior y aparece en la del nuevo; recibe la lista del nuevo.
      // (Los departamentos donde es admin los sigue viendo siempre.)
      const prevRooms = visibilityRoomsFor(user);
      const prevPresence = presenceRooms(user);
      user.department = department;
      const newRooms = visibilityRoomsFor(user);
      for (const r of prevRooms) if (!newRooms.includes(r)) socket.leave(r);
      socket.join(newRooms);
      movePresence(user, prevPresence);
      io.to(socket.id).emit('all-users', { users: getAllUsers(user) });
      leaveRoomIfNoAccess(socket.id, user);
      socket.department = department;
      if (user.sessionHash) {
        updateSessionDepartment(user.sessionHash, department).catch(err => console.error('updateSessionDepartment error:', err));
      }
      notifyFriendsOfStatusChange(user.username);

      const deptRecord = data.departments.find(d => d.name === department);
      io.to(socket.id).emit('profile-updated', {
        role: user.role,
        superAdmin: isSuperAdmin(user),
        department: user.department,
        departmentDisplayName: deptRecord?.displayName || department,
        departments: departmentOptions(user.departments || []),
        adminDepartments: adminDeptsOf(user),
        rooms: getAllRooms(user)
      });

      callback?.({ ok: true });
    });

    socket.on('disconnect', () => {
      const user = users.get(socket.id);
      if (!user) return;

      if (user.uploadToken) uploadTokens.delete(user.uploadToken);
      const oldRoom = user.currentRoom;

      const sockets = oldRoom && roomUsers.get(oldRoom);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) roomUsers.delete(oldRoom);
        else if (!isGlobalRoom(oldRoom)) io.to(oldRoom).emit('room-user-left', { room: oldRoom, username: user.username });
      }

      users.delete(socket.id);
      if (socketIdByUsername.get(user.username) === socket.id) socketIdByUsername.delete(user.username);
      announceOffline(user);
      notifyFriendsOfStatusChange(user.username);

      if (user.sessionHash && !user.sessionRemember) scheduleSessionClose(user.sessionHash);

      if (oldRoom) {
        cleanupTemporaryRoom(oldRoom).catch(err => console.error('cleanupTemporaryRoom error:', err));
      }
    });
  };
};
