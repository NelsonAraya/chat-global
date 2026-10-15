// Migra los datos existentes de chat.db (SQLite / sql.js) hacia MySQL.
// Uso: node migrate-to-mysql.js
// Se puede ejecutar más de una vez sin duplicar datos (usa upsert / INSERT IGNORE).

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');
const mysql = require('mysql2/promise');

const DB_PATH = path.join(__dirname, 'chat.db');

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || 3306;
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'chat_cormudesi';

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.log('No se encontró chat.db en ' + DB_PATH + '. Nada que migrar.');
    process.exit(0);
  }

  console.log('Leyendo chat.db...');
  const SQL = await initSqlJs();
  const sqliteDb = new SQL.Database(fs.readFileSync(DB_PATH));

  const selectAll = (sql) => {
    const result = sqliteDb.exec(sql);
    if (!result.length) return [];
    const { columns, values } = result[0];
    return values.map(row => {
      const obj = {};
      columns.forEach((col, i) => { obj[col] = row[i]; });
      return obj;
    });
  };

  const mapUser = (r) => {
    let departments = [];
    if (r.departments) {
      try { departments = JSON.parse(r.departments) || []; } catch { departments = []; }
    } else if (r.department) {
      departments = [r.department];
    }
    return { username: r.username, password: r.password, displayName: r.display_name, avatar: r.avatar, role: r.role, location: r.location, departments, created_at: r.created_at };
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
  const mapConsent = (r) => ({ username: r.username, terms_version: r.terms_version, accepted_at: r.accepted_at, ip_address: r.ip_address });

  const users = selectAll('SELECT * FROM users').map(mapUser);
  const rooms = selectAll('SELECT * FROM rooms').map(mapRoom);
  const messages = selectAll('SELECT * FROM messages').map(mapMessage);
  const departments = selectAll('SELECT * FROM departments').map(mapDepartment);
  const consents = selectAll('SELECT * FROM consent_log').map(mapConsent);

  console.log(`Encontrados: ${users.length} usuarios, ${rooms.length} salas, ${messages.length} mensajes, ${departments.length} departamentos, ${consents.length} registros de consentimiento.`);

  console.log('Conectando a MySQL y creando tablas si hace falta (esto también siembra el usuario admin y la sala general por defecto, no afecta tus datos)...');
  // Reutiliza db.js para crear la base/tablas con el mismo esquema que usará la app.
  await require('./db');

  const pool = mysql.createPool({ host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASSWORD, database: DB_NAME });

  console.log('Migrando departamentos...');
  for (const d of departments) {
    await pool.query('INSERT IGNORE INTO departments (name, display_name, created_at) VALUES (?, ?, ?)', [d.name, d.displayName || null, d.created_at || null]);
  }

  console.log('Migrando usuarios...');
  for (const u of users) {
    await pool.query(
      `INSERT INTO users (username, password, display_name, avatar, role, location, departments, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE password=VALUES(password), display_name=VALUES(display_name), avatar=VALUES(avatar),
         role=VALUES(role), location=VALUES(location), departments=VALUES(departments)`,
      [u.username, u.password, u.displayName || null, u.avatar || null, u.role || 'user', u.location || null, JSON.stringify(u.departments || []), u.created_at || null]
    );
  }

  console.log('Migrando salas...');
  for (const r of rooms) {
    await pool.query(
      `INSERT INTO rooms (name, created_by, created_at, password, temporary, department)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE password=VALUES(password), temporary=VALUES(temporary), department=VALUES(department)`,
      [r.name, r.created_by, r.created_at || null, r.password || null, r.temporary ? 1 : 0, r.department || null]
    );
  }

  console.log('Migrando mensajes (puede tardar según el volumen)...');
  for (const m of messages) {
    await pool.query(
      `INSERT IGNORE INTO messages (id, room_name, sender, display_name, avatar, content, file_name, file_url, file_size, file_mimetype, reply, reactions, created_at, recipient, type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [m.id, m.room_name || null, m.sender, m.displayName || null, m.avatar || null,
        m.content || '', m.file?.name || null, m.file?.url || null, m.file?.size || null, m.file?.type || null,
        m.reply ? JSON.stringify(m.reply) : null,
        JSON.stringify(m.reactions || {}),
        m.created_at || null, m.recipient || null, m.type || 'room']
    );
  }

  console.log('Migrando registro de consentimiento (TyC)...');
  for (const c of consents) {
    await pool.query(
      'INSERT INTO consent_log (username, terms_version, accepted_at, ip_address) VALUES (?, ?, ?, ?)',
      [c.username, c.terms_version, c.accepted_at, c.ip_address || null]
    );
  }

  await pool.end();
  console.log('Migración completa. chat.db no se modificó; puedes conservarlo como respaldo.');
  process.exit(0);
}

main().catch(err => {
  console.error('Error durante la migración:', err);
  process.exit(1);
});
