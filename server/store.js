import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
// OWASP's scrypt N=2^15, r=8, p=3 profile; encoded parameters permit future upgrades.
const SCRYPT = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
export const ROLES = ['admin', 'analyst', 'viewer'];
export const publicUser = row => ({ id: row.id, username: row.username, displayName: row.display_name, role: row.role, enabled: Boolean(row.enabled) });
export function validatePassword(password) {
  return typeof password === 'string' && password.length >= 12 && password.length <= 128;
}
export function validateUsername(username) {
  return typeof username === 'string' && /^[a-z0-9][a-z0-9_.-]{2,39}$/.test(username);
}
export async function hashPassword(password) {
  if (!validatePassword(password)) throw new Error('密码长度需要为 12–128 个字符');
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  const [algorithm, n, r, p, salt, expectedHex] = encoded.split('$');
  if (algorithm !== 'scrypt' || n !== String(SCRYPT.N) || r !== String(SCRYPT.r) || p !== String(SCRYPT.p) || !/^[a-f0-9]{32}$/.test(salt ?? '') || !/^[a-f0-9]{128}$/.test(expectedHex ?? '')) return false;
  const actual = await scrypt(password, salt, 64, SCRYPT);
  const expected = Buffer.from(expectedHex, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function createStore(dbPath) {
  if (dbPath !== ':memory:') {
    const parent = dirname(resolve(dbPath));
    mkdirSync(parent, { recursive: true, mode: 0o700 });
  }
  const db = new DatabaseSync(dbPath);
  if (dbPath !== ':memory:') chmodSync(dbPath, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','analyst','viewer')),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT OR IGNORE INTO settings (key,value) VALUES ('workspaceName','云上商业工作空间');
  `);
  return {
    db,
    async createUser({ username, displayName, password, role }) {
      username = typeof username === 'string' ? username.trim().toLowerCase() : username;
      displayName = typeof displayName === 'string' ? displayName.trim() : '';
      if (!validateUsername(username) || !displayName || displayName.length > 80 || !ROLES.includes(role)) throw new Error('用户资料不符合要求');
      const passwordHash = await hashPassword(password);
      const inserted = db.prepare('INSERT INTO users (username,display_name,password_hash,role,created_at) VALUES (?,?,?,?,?)')
        .run(username, displayName, passwordHash, role, Date.now());
      return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(inserted.lastInsertRowid));
    },
    close() { db.close(); }
  };
}
