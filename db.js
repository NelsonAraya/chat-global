const initSqlJs = require('sql.js');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'chat.db');

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

module.exports = (async () => {
  const SQL = await initSqlJs();

  let db;
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }

  db.run('CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, password TEXT NOT NULL, display_name TEXT, avatar TEXT, role TEXT DEFAULT \'user\', location TEXT, created_at TEXT)');
  db.run('CREATE TABLE IF NOT EXISTS rooms (name TEXT PRIMARY KEY, created_by TEXT NOT NULL, created_at TEXT, password TEXT, temporary INTEGER DEFAULT 0)');
  db.run('CREATE TABLE IF NOT EXISTS messages (id REAL PRIMARY KEY, room_name TEXT, sender TEXT NOT NULL, display_name TEXT, avatar TEXT, content TEXT DEFAULT \'\', file_name TEXT, file_url TEXT, file_size INTEGER, file_mimetype TEXT, reply TEXT, reactions TEXT DEFAULT \'{}\', created_at TEXT, recipient TEXT, type TEXT DEFAULT \'room\')');
  db.run('CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_name)');
  db.run('CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient)');
  db.run('CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender)');
  db.run('CREATE TABLE IF NOT EXISTS consent_log (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, terms_version TEXT NOT NULL, accepted_at TEXT NOT NULL, ip_address TEXT)');

  const now = new Date().toISOString();
  db.run('INSERT OR IGNORE INTO users (username, password, display_name, role, created_at) VALUES (?, ?, ?, ?, ?)', ['admin', hashPassword('admin'), 'admin', 'admin', now]);
  db.run('INSERT OR IGNORE INTO consent_log (username, terms_version, accepted_at, ip_address) VALUES (?, ?, ?, ?)', ['admin', '1.0', now, '127.0.0.1']);
  db.run('INSERT OR IGNORE INTO rooms (name, created_by, created_at, password, temporary) VALUES (?, ?, ?, ?, ?)', ['general', 'sistema', now, null, 0]);

  const selectAll = (sql) => {
    const result = db.exec(sql);
    if (!result.length) return [];
    const { columns, values } = result[0];
    return values.map(row => {
      const obj = {};
      columns.forEach((col, i) => { obj[col] = row[i]; });
      return obj;
    });
  };

  const mapUser = (r) => ({ username: r.username, password: r.password, displayName: r.display_name, avatar: r.avatar, role: r.role, location: r.location, created_at: r.created_at });
  const mapRoom = (r) => ({ name: r.name, created_by: r.created_by, created_at: r.created_at, password: r.password, temporary: !!r.temporary });
  const mapMessage = (m) => ({
    id: m.id, room_name: m.room_name, sender: m.sender, displayName: m.display_name, avatar: m.avatar,
    content: m.content,
    file: m.file_url ? { url: m.file_url, name: m.file_name, size: m.file_size, type: m.file_mimetype } : null,
    reply: m.reply ? JSON.parse(m.reply) : null,
    reactions: JSON.parse(m.reactions), created_at: m.created_at, recipient: m.recipient, type: m.type
  });

  let data = {
    users: selectAll('SELECT * FROM users ORDER BY username').map(mapUser),
    rooms: selectAll('SELECT * FROM rooms ORDER BY name').map(mapRoom),
    messages: selectAll('SELECT * FROM messages ORDER BY created_at').map(mapMessage)
  };

  const persist = () => {
    fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  };

  persist();

  const save = () => {
    db.run('DELETE FROM users');
    db.run('DELETE FROM rooms');
    db.run('DELETE FROM messages');

    const insUser = db.prepare('INSERT INTO users (username, password, display_name, avatar, role, location, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const insRoom = db.prepare('INSERT INTO rooms (name, created_by, created_at, password, temporary) VALUES (?, ?, ?, ?, ?)');
    const insMsg = db.prepare('INSERT INTO messages (id, room_name, sender, display_name, avatar, content, file_name, file_url, file_size, file_mimetype, reply, reactions, created_at, recipient, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');

    for (const u of data.users) {
      insUser.run([u.username, u.password, u.displayName || null, u.avatar || null, u.role || 'user', u.location || null, u.created_at || null]);
    }
    for (const r of data.rooms) {
      insRoom.run([r.name, r.created_by, r.created_at || null, r.password || null, r.temporary ? 1 : 0]);
    }
    for (const m of data.messages) {
      insMsg.run([m.id, m.room_name || null, m.sender, m.displayName || null, m.avatar || null,
        m.content || '', m.file?.name || null, m.file?.url || null, m.file?.size || null, m.file?.type || null,
        m.reply ? JSON.stringify(m.reply) : null,
        JSON.stringify(m.reactions || {}),
        m.created_at || null, m.recipient || null, m.type || 'room'
      ]);
    }

    insUser.free();
    insRoom.free();
    insMsg.free();

    persist();
  };

  const saveConsent = (username, termsVersion, acceptedAt, ipAddress) => {
    db.run('INSERT INTO consent_log (username, terms_version, accepted_at, ip_address) VALUES (?, ?, ?, ?)', [username, termsVersion, acceptedAt, ipAddress || null]);
    persist();
  };

  return { data, save, hashPassword, saveConsent };
})();
