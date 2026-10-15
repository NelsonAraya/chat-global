const mysql = require('mysql2/promise');
const crypto = require('crypto');

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || 3306;
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'chat_cormudesi';

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

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
    connectionLimit: 10,
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
    created_at VARCHAR(40)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Migración: las cuentas existentes antes de este cambio quedan activas automáticamente.
  try { await pool.query("ALTER TABLE users ADD COLUMN status VARCHAR(20) DEFAULT 'active'"); } catch {}

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
    INDEX idx_messages_room (room_name),
    INDEX idx_messages_recipient (recipient),
    INDEX idx_messages_sender (sender)
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
    ['admin', hashPassword('admin'), 'admin', 'admin', now]
  );
  await pool.query(
    'INSERT IGNORE INTO consent_log (username, terms_version, accepted_at, ip_address) VALUES (?, ?, ?, ?)',
    ['admin', '1.0', now, '127.0.0.1']
  );
  await pool.query(
    'INSERT IGNORE INTO rooms (name, created_by, created_at, password, temporary) VALUES (?, ?, ?, ?, ?)',
    ['general', 'sistema', now, null, 0]
  );

  const mapUser = (r) => {
    let departments = [];
    if (r.departments) {
      try { departments = JSON.parse(r.departments) || []; } catch { departments = []; }
    }
    return { username: r.username, password: r.password, displayName: r.display_name, avatar: r.avatar, role: r.role, location: r.location, departments, status: r.status || 'active', created_at: r.created_at };
  };
  const mapRoom = (r) => ({ name: r.name, created_by: r.created_by, created_at: r.created_at, password: r.password, temporary: !!r.temporary, department: r.department || null });
  const mapDepartment = (r) => ({ name: r.name, displayName: r.display_name, created_at: r.created_at });
  const mapMessage = (m) => ({
    id: m.id, room_name: m.room_name, sender: m.sender, displayName: m.display_name, avatar: m.avatar,
    content: m.content,
    file: m.file_url ? { url: m.file_url, name: m.file_name, size: m.file_size, type: m.file_mimetype } : null,
    reply: m.reply ? JSON.parse(m.reply) : null,
    reactions: m.reactions ? JSON.parse(m.reactions) : {}, created_at: m.created_at, recipient: m.recipient, type: m.type
  });

  const mapFriend = (r) => ({ id: r.id, requester: r.requester, recipient: r.recipient, status: r.status, created_at: r.created_at, responded_at: r.responded_at });

  const [userRows] = await pool.query('SELECT * FROM users ORDER BY username');
  const [roomRows] = await pool.query('SELECT * FROM rooms ORDER BY name');
  const [messageRows] = await pool.query('SELECT * FROM messages ORDER BY created_at');
  const [deptRows] = await pool.query('SELECT * FROM departments ORDER BY name');
  const [friendRows] = await pool.query('SELECT * FROM friends ORDER BY id');

  let data = {
    users: userRows.map(mapUser),
    rooms: roomRows.map(mapRoom),
    messages: messageRows.map(mapMessage),
    departments: deptRows.map(mapDepartment),
    friends: friendRows.map(mapFriend)
  };

  // ===== Persistencia incremental: cada función escribe solo la fila que cambió =====

  const saveUser = async (u) => {
    await pool.query(
      `INSERT INTO users (username, password, display_name, avatar, role, location, departments, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE password=VALUES(password), display_name=VALUES(display_name), avatar=VALUES(avatar),
         role=VALUES(role), location=VALUES(location), departments=VALUES(departments), status=VALUES(status)`,
      [u.username, u.password, u.displayName || null, u.avatar || null, u.role || 'user', u.location || null, JSON.stringify(u.departments || []), u.status || 'active', u.created_at || null]
    );
  };

  const deleteUser = async (username) => {
    await pool.query('DELETE FROM users WHERE username = ?', [username]);
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
      `INSERT INTO messages (id, room_name, sender, display_name, avatar, content, file_name, file_url, file_size, file_mimetype, reply, reactions, created_at, recipient, type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [m.id, m.room_name || null, m.sender, m.displayName || null, m.avatar || null,
        m.content || '', m.file?.name || null, m.file?.url || null, m.file?.size || null, m.file?.type || null,
        m.reply ? JSON.stringify(m.reply) : null,
        JSON.stringify(m.reactions || {}),
        m.created_at || null, m.recipient || null, m.type || 'room']
    );
  };

  const updateMessageReactions = async (id, reactions) => {
    await pool.query('UPDATE messages SET reactions = ? WHERE id = ?', [JSON.stringify(reactions || {}), id]);
  };

  const deleteMessagesByRoom = async (roomName) => {
    await pool.query('DELETE FROM messages WHERE room_name = ?', [roomName]);
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

  const saveAlert = async (a) => {
    await pool.query(
      'INSERT INTO alerts (username, display_name, department, department_display_name, location, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [a.username, a.displayName || null, a.department || null, a.departmentDisplayName || null, a.location || null, a.created_at || null]
    );
  };

  const getAlertHistory = async (limit, offset) => {
    const [rows] = await pool.query(
      'SELECT * FROM alerts ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [limit, offset]
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
    data, hashPassword,
    saveUser, deleteUser,
    saveRoom, deleteRoom,
    saveMessage, updateMessageReactions, deleteMessagesByRoom,
    saveDepartment, deleteDepartment,
    saveConsent,
    saveFriendRequest, updateFriendStatus, deleteFriendRow,
    saveAlert, getAlertHistory
  };
})();
