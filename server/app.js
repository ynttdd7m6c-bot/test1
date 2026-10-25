import express from 'express';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, hashPassword, publicUser, validatePassword, validateUsername, ROLES } from './store.js';
import { verifyPassword } from './store.js';
import { dashboardData, PERIODS, SHOPS, CATEGORIES } from './demo-data.js';

const SESSION_MS = 8 * 60 * 60 * 1000;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const dummyPasswordHash = `scrypt$32768$8$3$00000000000000000000000000000000$${'0'.repeat(128)}`;
const mutations = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const error = (res, status, message) => res.status(status).json({ error: message });
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function cookieToken(req, name) {
  const value = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
function exactKeys(body, allowed) {
  return body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).every(key => allowed.includes(key));
}
function inputScope(req, res) {
  const period = req.query.period ?? '近30天';
  const shop = req.query.shop ?? '全部店铺';
  if (!PERIODS.includes(period) || !SHOPS.includes(shop)) { error(res, 400, '店铺或周期参数无效'); return null; }
  return { period, shop };
}
function loginLimiter({ maxAccount = 10, maxIp = 30, maxGlobal = 200, windowMs = 15 * 60 * 1000 } = {}, now) {
  const buckets = new Map();
  let global = { count: 0, until: now() + windowMs };
  return (req, res, next) => {
    const time = now();
    if (time >= global.until) global = { count: 0, until: time + windowMs };
    for (const [key, bucket] of buckets) if (time >= bucket.until) buckets.delete(key);
    const account = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase().slice(0, 40) : '';
    const keys = [[`ip:${req.ip}`, maxIp], [`account:${account}`, maxAccount]];
    if (++global.count > maxGlobal || buckets.size > 10000 || keys.some(([key, maximum]) => (buckets.get(key)?.count ?? 0) >= maximum)) {
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      return error(res, 429, '登录尝试过于频繁，请稍后再试');
    }
    for (const [key] of keys) {
      const bucket = buckets.get(key) ?? { count: 0, until: time + windowMs };
      bucket.count++; buckets.set(key, bucket);
    }
    next();
  };
}
export function createApp({ dbPath = resolve('data/ali-insight.sqlite'), production = false, origin = 'http://localhost:5173', trustProxy = false, now = Date.now, loginLimits, sessionMs = SESSION_MS, passwordHasher = hashPassword, staticDir = fileURLToPath(new URL('../dist', import.meta.url)) } = {}) {
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.origin !== origin || !['http:', 'https:'].includes(parsedOrigin.protocol) || (production && parsedOrigin.protocol !== 'https:')) throw new Error('APP_ORIGIN 必须是单个完整来源，生产环境必须使用 HTTPS（不带尾随斜杠）');
  const store = createStore(dbPath);
  const db = store.db;
  const app = express();
  const cookieName = production ? '__Host-ali_session' : 'ali_session';
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('Cache-Control', 'no-store');
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });
  app.use('/api', (req, res, next) => {
    // No CORS: browsers from another origin cannot read responses. Mutations also require Origin.
    if (mutations.has(req.method) && req.get('origin') !== origin) return error(res, 403, '请求来源不受信任');
    if (req.get('sec-fetch-site') === 'cross-site') return error(res, 403, '不允许跨站请求');
    next();
  });
  app.use('/api', express.json({ limit: '16kb', strict: true }));
  const readSession = tokenHash => {
    const session = tokenHash && db.prepare('SELECT s.*,u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=?').get(tokenHash);
    if (!session || !session.enabled || session.expires_at <= now()) {
      if (session) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(session.token_hash);
      return null;
    }
    return session;
  };
  const requireAuth = (req, res, next) => {
    const token = cookieToken(req, cookieName);
    const session = token && readSession(sha256(token));
    if (!session) return error(res, 401, '请先登录或重新登录');
    req.auth = { user: publicUser(session), tokenHash: session.token_hash, csrfToken: session.csrf_token };
    next();
  };
  // Recheck after asynchronous password hashing, under the same write transaction as the mutation.
  const stillAdmin = (req, res) => {
    const current = readSession(req.auth.tokenHash);
    if (!current) { error(res, 401, '请先登录或重新登录'); return false; }
    if (current.role !== 'admin') { error(res, 403, '当前账号没有此操作权限'); return false; }
    return true;
  };
  const requireRole = (...roles) => (req, res, next) => roles.includes(req.auth.user.role) ? next() : error(res, 403, '当前账号没有此操作权限');
  const requireCsrf = (req, res, next) => sameSecret(req.get('X-CSRF-Token'), req.auth.csrfToken) ? next() : error(res, 403, '请求验证失败，请刷新后重试');
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: production, path: '/' };

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  let activeLogins = 0;
  app.post('/api/auth/login', loginLimiter(loginLimits, now), async (req, res, next) => {
    if (activeLogins >= 8) return error(res, 429, '登录服务繁忙，请稍后再试');
    activeLogins++;
    try {
      const { username, password } = req.body ?? {};
      if (!exactKeys(req.body, ['username', 'password']) || typeof username !== 'string' || username.length > 80 || typeof password !== 'string' || password.length > 128) return error(res, 400, '请输入有效的账号和密码');
      const normalized = username.trim().toLowerCase();
      const account = db.prepare('SELECT * FROM users WHERE username=?').get(normalized);
      const valid = await verifyPassword(password, account?.password_hash ?? dummyPasswordHash);
      // Check enabled and role again after asynchronous hashing in case an admin revoked access meanwhile.
      const current = account && db.prepare('SELECT * FROM users WHERE id=?').get(account.id);
      if (!valid || !current || !current.enabled || current.password_hash !== account.password_hash) return error(res, 401, '账号或密码错误');
      const previous = cookieToken(req, cookieName);
      if (previous) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(previous));
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());
      const token = randomBytes(32).toString('base64url');
      const csrfToken = randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO sessions (token_hash,user_id,csrf_token,expires_at) VALUES (?,?,?,?)').run(sha256(token), current.id, csrfToken, now() + sessionMs);
      // Limit retained sessions per account, including successful automated login attempts.
      db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id=? ORDER BY expires_at DESC,rowid DESC LIMIT 5)').run(current.id, current.id);
      res.cookie(cookieName, token, { ...cookieOptions, maxAge: sessionMs });
      res.json({ user: publicUser(current), csrfToken });
    } catch (err) { next(err); } finally { activeLogins--; }
  });
  app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.auth.user, csrfToken: req.auth.csrfToken }));
  app.post('/api/auth/logout', requireAuth, requireCsrf, (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(req.auth.tokenHash);
    res.clearCookie(cookieName, cookieOptions);
    res.json({ ok: true });
  });
  app.get('/api/dashboard', requireAuth, (req, res) => {
    const scope = inputScope(req, res);
    if (!scope) return;
    res.json({ ...dashboardData(scope.period, scope.shop), workspaceName: db.prepare("SELECT value FROM settings WHERE key='workspaceName'").get().value });
  });
  app.get('/api/reports/export', requireAuth, requireRole('admin', 'analyst'), (req, res) => {
    const scope = inputScope(req, res);
    if (!scope) return;
    const query = req.query.query ?? '';
    const category = req.query.category ?? '全部品类';
    const sort = req.query.sort ?? 'desc';
    if (typeof query !== 'string' || query.length > 100 || !CATEGORIES.includes(category) || !['asc', 'desc'].includes(sort)) return error(res, 400, '商品筛选参数无效');
    const data = dashboardData(scope.period, scope.shop).products.filter(p => p[1].includes(query) && (category === '全部品类' || p[3] === category)).sort((a, b) => sort === 'asc' ? a[6] - b[6] : b[6] - a[6]);
    const csv = value => `"${String(value).replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`;
    const rows = [['店铺', '周期', '商品名称', '品类', '售价', '支付件数', '销售额', '增长率'], ...data.map(p => [scope.shop, scope.period, p[1], p[3], p[4], p[5], p[6], `${p[7]}%`])];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="ali-insight-report.csv"');
    res.send('\ufeff' + rows.map(row => row.map(csv).join(',')).join('\r\n'));
  });
  app.get('/api/settings', requireAuth, requireRole('admin'), (req, res) => res.json({ workspaceName: db.prepare("SELECT value FROM settings WHERE key='workspaceName'").get().value }));
  app.patch('/api/settings', requireAuth, requireRole('admin'), requireCsrf, (req, res) => {
    if (!exactKeys(req.body, ['workspaceName']) || typeof req.body.workspaceName !== 'string' || !req.body.workspaceName.trim() || req.body.workspaceName.trim().length > 80) return error(res, 400, '工作空间名称需要为 1–80 个字符');
    const workspaceName = req.body.workspaceName.trim();
    db.prepare("UPDATE settings SET value=? WHERE key='workspaceName'").run(workspaceName);
    res.json({ workspaceName });
  });
  app.get('/api/admin/users', requireAuth, requireRole('admin'), (req, res) => res.json({ users: db.prepare('SELECT * FROM users ORDER BY id').all().map(publicUser) }));
  app.post('/api/admin/users', requireAuth, requireRole('admin'), requireCsrf, async (req, res, next) => {
    try {
      if (!exactKeys(req.body, ['username', 'displayName', 'password', 'role'])) return error(res, 400, '用户资料不符合要求');
      const { username, displayName, password, role } = req.body;
      if (!validateUsername(username) || typeof displayName !== 'string' || !displayName.trim() || displayName.trim().length > 80 || !ROLES.includes(role) || !validatePassword(password)) return error(res, 400, '账号应为 3–40 位小写字母、数字或 ._-，密码需为 12–128 个字符');
      const passwordHash = await passwordHasher(password);
      db.exec('BEGIN IMMEDIATE');
      try {
        if (!stillAdmin(req, res)) { db.exec('ROLLBACK'); return; }
        const inserted = db.prepare('INSERT INTO users (username,display_name,password_hash,role,created_at) VALUES (?,?,?,?,?)').run(username, displayName.trim(), passwordHash, role, now());
        const user = publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(inserted.lastInsertRowid));
        db.exec('COMMIT');
        res.status(201).json({ user });
      } catch (err) { db.exec('ROLLBACK'); throw err; }
    } catch (err) {
      if (err.code?.startsWith('ERR_SQLITE') && String(err.message).includes('UNIQUE')) return error(res, 409, '账号名称已存在');
      next(err);
    }
  });
  app.patch('/api/admin/users/:id', requireAuth, requireRole('admin'), requireCsrf, async (req, res, next) => {
    try {
      if (!/^\d+$/.test(req.params.id) || !exactKeys(req.body, ['role', 'enabled', 'password']) || !Object.keys(req.body).length) return error(res, 400, '用户更新参数无效');
      const { role, enabled, password } = req.body;
      if ((role !== undefined && !ROLES.includes(role)) || (enabled !== undefined && typeof enabled !== 'boolean') || (password !== undefined && !validatePassword(password))) return error(res, 400, '用户更新参数无效');
      const passwordHash = password !== undefined ? await passwordHasher(password) : null;
      db.exec('BEGIN IMMEDIATE');
      try {
        if (!stillAdmin(req, res)) { db.exec('ROLLBACK'); return; }
        const account = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
        if (!account) { db.exec('ROLLBACK'); return error(res, 404, '账号不存在'); }
        const nextRole = role ?? account.role;
        const nextEnabled = enabled === undefined ? account.enabled : Number(enabled);
        const admins = db.prepare("SELECT count(*) AS n FROM users WHERE role='admin' AND enabled=1").get().n;
        if (account.role === 'admin' && account.enabled && (nextRole !== 'admin' || !nextEnabled) && admins <= 1) { db.exec('ROLLBACK'); return error(res, 409, '必须保留至少一名启用的管理员'); }
        db.prepare('UPDATE users SET role=?,enabled=?,password_hash=? WHERE id=?').run(nextRole, nextEnabled, passwordHash ?? account.password_hash, account.id);
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(account.id);
        db.exec('COMMIT');
        res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(account.id)) });
      } catch (err) { db.exec('ROLLBACK'); throw err; }
    } catch (err) { next(err); }
  });
  app.use('/api', (req, res) => error(res, 404, '接口不存在'));
  if (production) app.use(express.static(resolve(staticDir), { dotfiles: 'deny', index: 'index.html', etag: false, lastModified: false }));
  app.use((req, res) => error(res, 404, '页面不存在'));
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return error(res, 413, '请求内容过大');
    if (err instanceof SyntaxError && 'body' in err) return error(res, 400, 'JSON 格式无效');
    // Never log request bodies, cookies, credentials, password hashes, or session tokens.
    console.error('Request failed:', err.code ?? err.name ?? 'unknown');
    error(res, 500, '服务暂时不可用，请稍后重试');
  });
  return { app, store, close: () => store.close() };
}
