const crypto = require('crypto');
const util = require('util');

const scryptAsync = util.promisify(crypto.scrypt);
const SCRYPT_KEYLEN = 64;

// Contraseñas: scrypt con sal aleatoria ("scrypt$<sal>$<hash>"). Es lento a propósito para que,
// si alguien obtiene la base de datos, no pueda probar millones de contraseñas por segundo.
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scryptAsync(String(password), salt, SCRYPT_KEYLEN);
  return 'scrypt$' + salt.toString('hex') + '$' + hash.toString('hex');
}

// Formato antiguo: SHA-256 sin sal. Se sigue aceptando para no romper cuentas ni salas existentes,
// y se reemplaza por scrypt la próxima vez que la contraseña se usa correctamente.
const isLegacyHash = (stored) => !!stored && !String(stored).startsWith('scrypt$');

async function verifyPassword(password, stored) {
  if (!stored || typeof password !== 'string') return false;
  if (isLegacyHash(stored)) {
    const actual = Buffer.from(crypto.createHash('sha256').update(password).digest('hex'));
    const expected = Buffer.from(String(stored));
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = { hashPassword, verifyPassword, isLegacyHash };
