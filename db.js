const mysql = require('mysql2/promise');
const { hashPassword, verifyPassword, isLegacyHash } = require('./passwords');

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || 3306;
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'chat_cormudesi';

module.exports = (async () => {
  // Crea la base de datos si no existe (requiere conexión sin seleccionar schema)
  const bootstrap = await mysql.createConnection({ host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASSWORD });
  await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await bootstrap.end();

  const pool = mysql.createPool({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    waitForConnections: true,
    // Cada ingreso hace varias consultas (sesión, conversaciones, historial): con 10 conexiones la hora punta
    // hacía cola. MySQL acepta 151 por defecto.
    connectionLimit: Number(process.env.DB_POOL_SIZE) || 30,
    charset: 'utf8mb4_unicode_ci'
  });

  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    username VARCHAR(64) PRIMARY KEY,
    password VARCHAR(255) NOT NULL,
    display_name VARCHAR(100),
    avatar TEXT,
    role VARCHAR(20) DEFAULT 'user',
    location VARCHAR(255),
    departments TEXT,
    status VARCHAR(20) DEFAULT 'active',
    email VARCHAR(255),
    two_factor_enabled TINYINT(1) DEFAULT 0,
    created_at VARCHAR(40)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Migración: las cuentas existentes antes de este cambio quedan activas automáticamente.
  try { await pool.query("ALTER TABLE users ADD COLUMN status VARCHAR(20) DEFAULT 'active'"); } catch {}
  // Migración: correo de registro y estado del doble factor (código por correo).
  try { await pool.query('ALTER TABLE users ADD COLUMN email VARCHAR(255)'); } catch {}
  try { await pool.query('ALTER TABLE users ADD COLUMN two_factor_enabled TINYINT(1) DEFAULT 0'); } catch {}
  // Migración: departamentos donde la cuenta es administradora (en el resto de sus departamentos es usuario).
  // Los administradores que ya existían lo siguen siendo en todos sus departamentos.
  try { await pool.query('ALTER TABLE users ADD COLUMN admin_departments TEXT'); } catch {}
  await pool.query("UPDATE users SET admin_departments = COALESCE(departments, '[]') WHERE admin_departments IS NULL AND role = 'admin'");

  await pool.query(`CREATE TABLE IF NOT EXISTS rooms (
    name VARCHAR(64) PRIMARY KEY,
    created_by VARCHAR(64) NOT NULL,
    created_at VARCHAR(40),
    password VARCHAR(255),
    temporary TINYINT(1) DEFAULT 0,
    department VARCHAR(64)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await pool.query(`CREATE TABLE IF NOT EXISTS messages (
    id DOUBLE PRIMARY KEY,
    room_name VARCHAR(64),
    sender VARCHAR(64) NOT NULL,
    display_name VARCHAR(100),
    avatar TEXT,
    content TEXT,
    file_name VARCHAR(255),
    file_url VARCHAR(500),
    file_size INT,
    file_mimetype VARCHAR(100),
    reply TEXT,
    reactions TEXT,
    created_at VARCHAR(40),
    recipient VARCHAR(64),
    type VARCHAR(20) DEFAULT 'room',
    group_id INT,
    INDEX idx_messages_room (room_name),
    INDEX idx_messages_recipient (recipient),
    INDEX idx_messages_sender (sender)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Migración: mensajes de grupo.
  try { await pool.query('ALTER TABLE messages ADD COLUMN group_id INT'); } catch {}
  try { await pool.query('ALTER TABLE messages ADD INDEX idx_messages_group (group_id)'); } catch {}
  // Migración: índices para leer el historial por páginas directo de la base (sin cargarlo entero en memoria).
  try { await pool.query('ALTER TABLE messages ADD INDEX idx_messages_room_id (room_name, id)'); } catch {}
  try { await pool.query('ALTER TABLE messages ADD INDEX idx_messages_group_id (group_id, id)'); } catch {}
  try { await pool.query('ALTER TABLE messages ADD INDEX idx_messages_pair_id (sender, recipient, id)'); } catch {}

  // Conversaciones privadas: una fila por usuario y persona con quien conversa, con el id de su último mensaje.
  // Así la lista de conversaciones se lee directo, sin recorrer todos los mensajes privados del usuario.
  await pool.query(`CREATE TABLE IF NOT EXISTS conversations (
    username VARCHAR(64) NOT NULL,
    other VARCHAR(64) NOT NULL,
    last_message_id DOUBLE NOT NULL,
    PRIMARY KEY (username, other),
    INDEX idx_conversations_user_last (username, last_message_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  // Migración (solo la primera vez): se arma a partir de los mensajes privados que ya existen.
  const [[{ hasConversations }]] = await pool.query('SELECT EXISTS(SELECT 1 FROM conversations) AS hasConversations');
  if (!hasConversations) {
    await pool.query(
      `INSERT INTO conversations (username, other, last_message_id)
       SELECT sender, recipient, MAX(id) FROM messages WHERE recipient IS NOT NULL GROUP BY sender, recipient
       ON DUPLICATE KEY UPDATE last_message_id = GREATEST(last_message_id, VALUES(last_message_id))`
    );
    await pool.query(
      `INSERT INTO conversations (username, other, last_message_id)
       SELECT recipient, sender, MAX(id) FROM messages WHERE recipient IS NOT NULL GROUP BY recipient, sender
       ON DUPLICATE KEY UPDATE last_message_id = GREATEST(last_message_id, VALUES(last_message_id))`
    );
  }

  await pool.query(`CREATE TABLE IF NOT EXISTS chat_groups (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    created_by VARCHAR(64) NOT NULL,
    created_at VARCHAR(40)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // role: owner | admin | member. status: invited (debe aceptar) | member.
  await pool.query(`CREATE TABLE IF NOT EXISTS group_members (
    group_id INT NOT NULL,
    username VARCHAR(64) NOT NULL,
    role VARCHAR(20) DEFAULT 'member',
    status VARCHAR(20) DEFAULT 'invited',
    invited_by VARCHAR(64),
    created_at VARCHAR(40),
    PRIMARY KEY (group_id, username),
    INDEX idx_group_members_user (username)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Sesiones: se guarda solo el hash del token (el token en sí queda únicamente en el navegador).
  await pool.query(`CREATE TABLE IF NOT EXISTS sessions (
    token_hash CHAR(64) PRIMARY KEY,
    username VARCHAR(64) NOT NULL,
    department VARCHAR(64),
    remember TINYINT(1) DEFAULT 0,
    created_at VARCHAR(40),
    expires_at BIGINT NOT NULL,
    ip_address VARCHAR(64),
    user_agent VARCHAR(255),
    INDEX idx_sessions_user (username),
    INDEX idx_sessions_expires (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await pool.query(`CREATE TABLE IF NOT EXISTS departments (
    name VARCHAR(64) PRIMARY KEY,
    display_name VARCHAR(100),
    created_at VARCHAR(40)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await pool.query(`CREATE TABLE IF NOT EXISTS consent_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL,
    terms_version VARCHAR(20) NOT NULL,
    accepted_at VARCHAR(40) NOT NULL,
    ip_address VARCHAR(64)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await pool.query(`CREATE TABLE IF NOT EXISTS friends (
    id INT AUTO_INCREMENT PRIMARY KEY,
    requester VARCHAR(64) NOT NULL,
    recipient VARCHAR(64) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    created_at VARCHAR(40),
    responded_at VARCHAR(40),
    UNIQUE KEY uniq_pair (requester, recipient),
    INDEX idx_friends_requester (requester),
    INDEX idx_friends_recipient (recipient)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Errores del sistema (servidor y navegador) para que los administradores los revisen en el panel.
  await pool.query(`CREATE TABLE IF NOT EXISTS error_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    source VARCHAR(120),
    message TEXT,
    stack TEXT,
    username VARCHAR(64),
    occurrences INT DEFAULT 1,
    created_at VARCHAR(40),
    last_at VARCHAR(40),
    resolved TINYINT(1) DEFAULT 0,
    resolved_by VARCHAR(64),
    resolved_at VARCHAR(40),
    INDEX idx_error_log_last (last_at),
    INDEX idx_error_log_resolved (resolved)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await pool.query(`CREATE TABLE IF NOT EXISTS alerts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL,
    display_name VARCHAR(100),
    department VARCHAR(64),
    department_display_name VARCHAR(100),
    location VARCHAR(255),
    created_at VARCHAR(40),
    INDEX idx_alerts_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  const now = new Date().toISOString();
  await pool.query(
    'INSERT IGNORE INTO users (username, password, display_name, role, created_at) VALUES (?, ?, ?, ?, ?)',
    ['admin', await hashPassword('admin'), 'admin', 'admin', now]
  );
  await pool.query(
    'INSERT IGNORE INTO consent_log (username, terms_version, accepted_at, ip_address) VALUES (?, ?, ?, ?)',
    ['admin', '1.0', now, '127.0.0.1']
  );
  await pool.query(
    'INSERT IGNORE INTO rooms (name, created_by, created_at, password, temporary) VALUES (?, ?, ?, ?, ?)',
    ['general', 'sistema', now, null, 0]
  );

  const parseList = (text) => {
    if (!text) return [];
    try { return JSON.parse(text) || []; } catch { return []; }
  };
  const mapUser = (r) => {
    const departments = parseList(r.departments);
    const adminDepartments = r.role === 'admin' ? parseList(r.admin_departments).filter(d => departments.includes(d)) : [];
    return { username: r.username, password: r.password, displayName: r.display_name, avatar: r.avatar, role: r.role, location: r.location, departments, adminDepartments, status: r.status || 'active', email: r.email || null, twoFactorEnabled: !!r.two_factor_enabled, created_at: r.created_at };
  };
  const mapRoom = (r) => ({ name: r.name, created_by: r.created_by, created_at: r.created_at, password: r.password, temporary: !!r.temporary, department: r.department || null });
  const mapDepartment = (r) => ({ name: r.name, displayName: r.display_name, created_at: r.created_at });
  const mapMessage = (m) => ({
    id: m.id, room_name: m.room_name, sender: m.sender, displayName: m.display_name, avatar: m.avatar,
    content: m.content,
    file: m.file_url ? { url: m.file_url, name: m.file_name, size: m.file_size, type: m.file_mimetype } : null,
    reply: m.reply ? JSON.parse(m.reply) : null,
    reactions: m.reactions ? JSON.parse(m.reactions) : {}, created_at: m.created_at, recipient: m.recipient, type: m.type,
    group_id: m.group_id || null
  });
  const mapGroup = (r) => ({ id: r.id, name: r.name, created_by: r.created_by, created_at: r.created_at });
  const mapGroupMember = (r) => ({ group_id: r.group_id, username: r.username, role: r.role || 'member', status: r.status || 'invited', invited_by: r.invited_by, created_at: r.created_at });

  const mapFriend = (r) => ({ id: r.id, requester: r.requester, recipient: r.recipient, status: r.status, created_at: r.created_at, responded_at: r.responded_at });

  const [userRows] = await pool.query('SELECT * FROM users ORDER BY username');
  const [roomRows] = await pool.query('SELECT * FROM rooms ORDER BY name');
  const [deptRows] = await pool.query('SELECT * FROM departments ORDER BY name');
  const [friendRows] = await pool.query('SELECT * FROM friends ORDER BY id');
  const [groupRows] = await pool.query('SELECT * FROM chat_groups ORDER BY id');
  const [groupMemberRows] = await pool.query('SELECT * FROM group_members ORDER BY created_at');
  const [[{ maxMessageId }]] = await pool.query('SELECT MAX(id) AS maxMessageId FROM messages');

  let data = {
    users: userRows.map(mapUser),
    rooms: roomRows.map(mapRoom),
    departments: deptRows.map(mapDepartment),
    friends: friendRows.map(mapFriend),
    groups: groupRows.map(mapGroup),
    groupMembers: groupMemberRows.map(mapGroupMember)
  };

  // ===== Persistencia incremental: cada función escribe solo la fila que cambió =====

  const saveUser = async (u) => {
    await pool.query(
      `INSERT INTO users (username, password, display_name, avatar, role, location, departments, admin_departments, status, email, two_factor_enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE password=VALUES(password), display_name=VALUES(display_name), avatar=VALUES(avatar),
         role=VALUES(role), location=VALUES(location), departments=VALUES(departments), admin_departments=VALUES(admin_departments),
         status=VALUES(status), email=VALUES(email), two_factor_enabled=VALUES(two_factor_enabled)`,
      [u.username, u.password, u.displayName || null, u.avatar || null, u.role || 'user', u.location || null, JSON.stringify(u.departments || []), JSON.stringify(u.adminDepartments || []), u.status || 'active', u.email || null, u.twoFactorEnabled ? 1 : 0, u.created_at || null]
    );
  };

  // Guarda solo los campos indicados de una cuenta existente. saveUser reescribe la fila completa: dos
  // guardados casi simultáneos (p. ej. el usuario cambia su foto mientras el admin lo bloquea) podían
  // terminar en desorden y el último devolvía el valor viejo de lo que cambió el otro.
  const USER_FIELD_COLUMNS = {
    password: ['password', v => v],
    displayName: ['display_name', v => v || null],
    avatar: ['avatar', v => v || null],
    role: ['role', v => v || 'user'],
    location: ['location', v => v || null],
    departments: ['departments', v => JSON.stringify(v || [])],
    adminDepartments: ['admin_departments', v => JSON.stringify(v || [])],
    status: ['status', v => v || 'active'],
    email: ['email', v => v || null],
    twoFactorEnabled: ['two_factor_enabled', v => (v ? 1 : 0)]
  };
  const saveUserFields = async (u, fields) => {
    const columns = fields.map(f => USER_FIELD_COLUMNS[f]);
    if (!columns.length || columns.some(c => !c)) throw new Error('saveUserFields: campo no válido');
    await pool.query(
      `UPDATE users SET ${columns.map(([col]) => col + ' = ?').join(', ')} WHERE username = ?`,
      [...fields.map((f, i) => columns[i][1](u[f])), u.username]
    );
  };

  const deleteUser = async (username) => {
    await pool.query('DELETE FROM users WHERE username = ?', [username]);
    await pool.query('DELETE FROM sessions WHERE username = ?', [username]);
    await pool.query('DELETE FROM friends WHERE requester = ? OR recipient = ?', [username, username]);
  };

  const saveRoom = async (r) => {
    await pool.query(
      `INSERT INTO rooms (name, created_by, created_at, password, temporary, department)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE password=VALUES(password), temporary=VALUES(temporary), department=VALUES(department)`,
      [r.name, r.created_by, r.created_at || null, r.password || null, r.temporary ? 1 : 0, r.department || null]
    );
  };

  const deleteRoom = async (name) => {
    await pool.query('DELETE FROM rooms WHERE name = ?', [name]);
  };

  const saveMessage = async (m) => {
    await pool.query(
      `INSERT INTO messages (id, room_name, sender, display_name, avatar, content, file_name, file_url, file_size, file_mimetype, reply, reactions, created_at, recipient, type, group_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [m.id, m.room_name || null, m.sender, m.displayName || null, m.avatar || null,
        m.content || '', m.file?.name || null, m.file?.url || null, m.file?.size || null, m.file?.type || null,
        m.reply ? JSON.stringify(m.reply) : null,
        JSON.stringify(m.reactions || {}),
        m.created_at || null, m.recipient || null, m.type || 'room', m.group_id || null]
    );
    adjustMessageCount(1);
    if (m.recipient) {
      // Mantiene al día la lista de conversaciones de ambos.
      await pool.query(
        `INSERT INTO conversations (username, other, last_message_id) VALUES (?, ?, ?), (?, ?, ?)
         ON DUPLICATE KEY UPDATE last_message_id = GREATEST(last_message_id, VALUES(last_message_id))`,
        [m.sender, m.recipient, m.id, m.recipient, m.sender, m.id]
      );
    }
  };

  // ===== Total de mensajes =====
  // COUNT(*) recorre toda la tabla (segundos con millones de filas). Se cuenta una sola vez al arrancar, en
  // segundo plano, y luego se lleva la cuenta en memoria con cada mensaje guardado o borrado.
  let messageCount = null;
  let messageCountDelta = 0; // cambios ocurridos mientras se hacía el conteo inicial
  const adjustMessageCount = (delta) => {
    if (messageCount === null) messageCountDelta += delta;
    else messageCount += delta;
  };
  pool.query('SELECT COUNT(*) AS n FROM messages')
    .then(([[row]]) => { messageCount = Number(row.n) + messageCountDelta; })
    .catch(err => console.error('countMessages error:', err));

  const updateMessageReactions = async (id, reactions) => {
    await pool.query('UPDATE messages SET reactions = ? WHERE id = ?', [JSON.stringify(reactions || {}), id]);
  };

  const deleteMessagesByRoom = async (roomName) => {
    const [result] = await pool.query('DELETE FROM messages WHERE room_name = ?', [roomName]);
    adjustMessageCount(-result.affectedRows);
  };

  // ===== Lectura del historial: se consulta a la base solo la página que se necesita =====
  // Devuelve hasta `limit` mensajes anteriores a `beforeId` (o los más recientes), en orden cronológico,
  // y si quedan más antiguos por cargar.
  const pageOfMessages = async (where, params, beforeId, limit) => {
    const before = Number(beforeId);
    const useBefore = beforeId !== undefined && beforeId !== null && Number.isFinite(before);
    const [rows] = await pool.query(
      `SELECT * FROM messages WHERE ${where}${useBefore ? ' AND id < ?' : ''} ORDER BY id DESC LIMIT ?`,
      [...params, ...(useBefore ? [before] : []), limit + 1]
    );
    const hasMore = rows.length > limit;
    return { messages: rows.slice(0, limit).reverse().map(mapMessage), hasMore };
  };

  const getRoomMessages = (roomName, beforeId, limit) =>
    pageOfMessages('room_name = ? AND recipient IS NULL', [roomName], beforeId, limit);

  // Con "(A→B) OR (B→A)" MySQL puede no usar bien el índice (sender, recipient, id) y revisar muchas más filas.
  // Se piden los dos sentidos por separado (cada uno lee solo su página por el índice) y se juntan.
  const getPrivateMessages = async (userA, userB, beforeId, limit) => {
    if (userA === userB) return pageOfMessages('sender = ? AND recipient = ?', [userA, userA], beforeId, limit);
    const before = Number(beforeId);
    const useBefore = beforeId !== undefined && beforeId !== null && Number.isFinite(before);
    const oneWay = `(SELECT * FROM messages WHERE sender = ? AND recipient = ?${useBefore ? ' AND id < ?' : ''} ORDER BY id DESC LIMIT ?)`;
    const params = (from, to) => [from, to, ...(useBefore ? [before] : []), limit + 1];
    const [rows] = await pool.query(
      `SELECT * FROM (${oneWay} UNION ALL ${oneWay}) t ORDER BY id DESC LIMIT ?`,
      [...params(userA, userB), ...params(userB, userA), limit + 1]
    );
    const hasMore = rows.length > limit;
    return { messages: rows.slice(0, limit).reverse().map(mapMessage), hasMore };
  };

  const getGroupMessages = (groupId, beforeId, limit) =>
    pageOfMessages('group_id = ?', [groupId], beforeId, limit);

  const getMessage = async (id) => {
    const [rows] = await pool.query('SELECT * FROM messages WHERE id = ?', [id]);
    return rows[0] ? mapMessage(rows[0]) : null;
  };

  // Último mensaje de cada conversación privada del usuario (para la lista de conversaciones).
  const getLastPrivateMessages = async (username) => {
    const [rows] = await pool.query(
      `SELECT m.* FROM conversations c
       JOIN messages m ON m.id = c.last_message_id
       WHERE c.username = ?
       ORDER BY c.last_message_id DESC`,
      [username]
    );
    return rows.map(mapMessage);
  };

  // Último mensaje de cada grupo (se carga una vez al arrancar y luego se mantiene en memoria).
  const getLastGroupMessages = async () => {
    const [rows] = await pool.query(
      `SELECT m.* FROM messages m
       JOIN (SELECT group_id, MAX(id) AS max_id FROM messages WHERE group_id IS NOT NULL GROUP BY group_id) t
         ON m.id = t.max_id`
    );
    return rows.map(mapMessage);
  };

  // URLs de los archivos adjuntos de una sala o grupo (para borrarlos del disco junto con los mensajes).
  const getRoomFileUrls = async (roomName) => {
    const [rows] = await pool.query('SELECT file_url FROM messages WHERE room_name = ? AND file_url IS NOT NULL', [roomName]);
    return rows.map(r => r.file_url);
  };

  const getGroupFileUrls = async (groupId) => {
    const [rows] = await pool.query('SELECT file_url FROM messages WHERE group_id = ? AND file_url IS NOT NULL', [groupId]);
    return rows.map(r => r.file_url);
  };

  // Mientras el conteo inicial no termina se usa la estimación de MySQL (instantánea, aproximada).
  const countMessages = async () => {
    if (messageCount !== null) return messageCount;
    const [[row]] = await pool.query(
      "SELECT TABLE_ROWS AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages'"
    );
    return Number(row?.n) || 0;
  };

  const saveDepartment = async (d) => {
    await pool.query('INSERT INTO departments (name, display_name, created_at) VALUES (?, ?, ?)', [d.name, d.displayName || null, d.created_at || null]);
  };

  const deleteDepartment = async (name) => {
    await pool.query('DELETE FROM departments WHERE name = ?', [name]);
  };

  const saveConsent = async (username, termsVersion, acceptedAt, ipAddress) => {
    await pool.query('INSERT INTO consent_log (username, terms_version, accepted_at, ip_address) VALUES (?, ?, ?, ?)', [username, termsVersion, acceptedAt, ipAddress || null]);
  };

  const saveFriendRequest = async (f) => {
    const [result] = await pool.query(
      'INSERT INTO friends (requester, recipient, status, created_at) VALUES (?, ?, ?, ?)',
      [f.requester, f.recipient, f.status || 'pending', f.created_at || null]
    );
    f.id = result.insertId;
    return f;
  };

  const updateFriendStatus = async (id, status, respondedAt) => {
    await pool.query('UPDATE friends SET status = ?, responded_at = ? WHERE id = ?', [status, respondedAt || null, id]);
  };

  const deleteFriendRow = async (id) => {
    await pool.query('DELETE FROM friends WHERE id = ?', [id]);
  };

  const saveGroup = async (g) => {
    const [result] = await pool.query(
      'INSERT INTO chat_groups (name, created_by, created_at) VALUES (?, ?, ?)',
      [g.name, g.created_by, g.created_at || null]
    );
    g.id = result.insertId;
    return g;
  };

  const renameGroup = async (id, name) => {
    await pool.query('UPDATE chat_groups SET name = ? WHERE id = ?', [name, id]);
  };

  // Borra el grupo, sus miembros y sus mensajes.
  const deleteGroup = async (id) => {
    const [result] = await pool.query('DELETE FROM messages WHERE group_id = ?', [id]);
    adjustMessageCount(-result.affectedRows);
    await pool.query('DELETE FROM group_members WHERE group_id = ?', [id]);
    await pool.query('DELETE FROM chat_groups WHERE id = ?', [id]);
  };

  const saveGroupMember = async (m) => {
    await pool.query(
      `INSERT INTO group_members (group_id, username, role, status, invited_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE role=VALUES(role), status=VALUES(status)`,
      [m.group_id, m.username, m.role || 'member', m.status || 'invited', m.invited_by || null, m.created_at || null]
    );
  };

  const deleteGroupMember = async (groupId, username) => {
    await pool.query('DELETE FROM group_members WHERE group_id = ? AND username = ?', [groupId, username]);
  };

  const saveSession = async (s) => {
    await pool.query(
      'INSERT INTO sessions (token_hash, username, department, remember, created_at, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [s.tokenHash, s.username, s.department || null, s.remember ? 1 : 0, s.created_at, s.expiresAt, s.ip || null, (s.userAgent || '').slice(0, 255) || null]
    );
  };

  const getSession = async (tokenHash) => {
    const [rows] = await pool.query('SELECT * FROM sessions WHERE token_hash = ?', [tokenHash]);
    const r = rows[0];
    if (!r) return null;
    return { tokenHash: r.token_hash, username: r.username, department: r.department, remember: !!r.remember, created_at: r.created_at, expiresAt: Number(r.expires_at) };
  };

  const updateSessionDepartment = async (tokenHash, department) => {
    await pool.query('UPDATE sessions SET department = ? WHERE token_hash = ?', [department || null, tokenHash]);
  };

  const deleteSession = async (tokenHash) => {
    await pool.query('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
  };

  // Cierra todas las sesiones de un usuario, salvo (opcionalmente) la actual.
  const deleteUserSessions = async (username, exceptTokenHash) => {
    await pool.query('DELETE FROM sessions WHERE username = ? AND token_hash <> ?', [username, exceptTokenHash || '']);
  };

  const deleteExpiredSessions = async () => {
    await pool.query('DELETE FROM sessions WHERE expires_at < ?', [Date.now()]);
  };

  const saveAlert = async (a) => {
    await pool.query(
      'INSERT INTO alerts (username, display_name, department, department_display_name, location, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [a.username, a.displayName || null, a.department || null, a.departmentDisplayName || null, a.location || null, a.created_at || null]
    );
  };

  // ===== Registro de errores =====
  const saveErrorLog = async (e) => {
    const [result] = await pool.query(
      'INSERT INTO error_log (source, message, stack, username, occurrences, created_at, last_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
      [e.source, e.message, e.stack || null, e.username || null, e.created_at, e.created_at]
    );
    return result.insertId;
  };

  // El mismo error se repitió: suma una ocurrencia (y si estaba marcado como revisado, vuelve a pendiente).
  const bumpErrorLog = async (id, at) => {
    await pool.query('UPDATE error_log SET occurrences = occurrences + 1, last_at = ?, resolved = 0, resolved_by = NULL, resolved_at = NULL WHERE id = ?', [at, id]);
  };

  const getErrorLog = async (limit, offset, onlyPending) => {
    const [rows] = await pool.query(
      `SELECT * FROM error_log ${onlyPending ? 'WHERE resolved = 0' : ''} ORDER BY last_at DESC, id DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    return rows.map(r => ({
      id: r.id, source: r.source, message: r.message, stack: r.stack, username: r.username,
      occurrences: Number(r.occurrences) || 1, created_at: r.created_at, last_at: r.last_at,
      resolved: !!r.resolved, resolvedBy: r.resolved_by, resolvedAt: r.resolved_at
    }));
  };

  const countPendingErrors = async () => {
    const [[row]] = await pool.query('SELECT COUNT(*) AS n FROM error_log WHERE resolved = 0');
    return Number(row.n);
  };

  const setErrorResolved = async (id, resolved, by) => {
    await pool.query('UPDATE error_log SET resolved = ?, resolved_by = ?, resolved_at = ? WHERE id = ?',
      [resolved ? 1 : 0, resolved ? by : null, resolved ? new Date().toISOString() : null, id]);
  };

  // Limpieza: los errores revisados se borran después de un tiempo.
  const deleteOldResolvedErrors = async (beforeIso) => {
    await pool.query('DELETE FROM error_log WHERE resolved = 1 AND last_at < ?', [beforeIso]);
  };

  // `departments`: null = todas las alertas (administrador general); una lista = solo las de esos departamentos.
  const getAlertHistory = async (limit, offset, departments = null) => {
    if (Array.isArray(departments) && departments.length === 0) return [];
    const filter = departments ? 'WHERE department IN (?)' : '';
    const [rows] = await pool.query(
      `SELECT * FROM alerts ${filter} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      departments ? [departments, limit, offset] : [limit, offset]
    );
    return rows.map(r => ({
      id: r.id,
      username: r.username,
      displayName: r.display_name,
      department: r.department,
      departmentDisplayName: r.department_display_name,
      location: r.location,
      created_at: r.created_at
    }));
  };

  return {
    data, hashPassword, verifyPassword, isLegacyHash,
    saveUser, saveUserFields, deleteUser,
    saveRoom, deleteRoom,
    saveMessage, updateMessageReactions, deleteMessagesByRoom,
    getRoomMessages, getPrivateMessages, getGroupMessages, getMessage, getLastPrivateMessages, getLastGroupMessages,
    getRoomFileUrls, getGroupFileUrls, countMessages,
    saveDepartment, deleteDepartment,
    saveConsent,
    saveFriendRequest, updateFriendStatus, deleteFriendRow,
    saveGroup, renameGroup, deleteGroup, saveGroupMember, deleteGroupMember,
    saveSession, getSession, updateSessionDepartment, deleteSession, deleteUserSessions, deleteExpiredSessions,
    saveAlert, getAlertHistory,
    saveErrorLog, bumpErrorLog, getErrorLog, countPendingErrors, setErrorResolved, deleteOldResolvedErrors,
    maxMessageId: Number(maxMessageId) || 0
  };
})();
