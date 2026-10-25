import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/store.js';

const ORIGIN = 'http://localhost:5173';
const password = () => randomBytes(24).toString('base64url');
async function fixture(t, options = {}) {
  const instance = createApp({ dbPath: ':memory:', origin: ORIGIN, ...options });
  const server = instance.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); instance.close(); });
  const request = (path, { method = 'GET', body, cookie, csrf, origin = options.origin ?? ORIGIN, headers = {} } = {}) => fetch(url + path, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(origin !== null ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const create = async (role, username = role) => {
    const secret = password();
    const user = await instance.store.createUser({ username, displayName: `${role} 测试账号`, password: secret, role });
    return { ...user, password: secret };
  };
  const login = async account => {
    const response = await request('/api/auth/login', { method: 'POST', body: { username: account.username, password: account.password } });
    assert.equal(response.status, 200);
    const data = await response.json();
    return { cookie: response.headers.get('set-cookie').split(';')[0], csrf: data.csrfToken, user: data.user, response };
  };
  return { ...instance, server, request, create, login };
}

test('anonymous requests cannot read protected APIs or fake a user through headers', async t => {
  const f = await fixture(t);
  for (const path of ['/api/dashboard', '/api/reports/export', '/api/settings', '/api/admin/users', '/api/auth/me']) {
    const response = await f.request(path, { headers: { 'X-User-Role': 'admin', Authorization: 'Bearer fake' } });
    assert.equal(response.status, 401, path);
  }
  assert.equal((await f.request('/api/health')).status, 200);
  const absent = await f.request('/api/does-not-exist');
  assert.equal(absent.status, 404);
  assert.match(absent.headers.get('content-type'), /application\/json/);
});

test('login hashes passwords, sets opaque HttpOnly cookies and resumes sessions', async t => {
  const f = await fixture(t);
  const admin = await f.create('admin');
  const session = await f.login(admin);
  const cookie = session.response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=28800/);
  assert.equal(session.response.headers.get('cache-control'), 'no-store');
  assert.equal(session.response.headers.get('x-powered-by'), null);
  const dbUser = f.store.db.prepare('SELECT * FROM users').get();
  assert.match(dbUser.password_hash, /^scrypt\$/); assert.ok(!dbUser.password_hash.includes(admin.password));
  assert.equal(session.user.password_hash, undefined);
  const token = session.cookie.split('=')[1];
  const row = f.store.db.prepare('SELECT * FROM sessions').get();
  assert.notEqual(row.token_hash, token);
  assert.equal(row.token_hash, createHash('sha256').update(token).digest('hex'));
  const me = await f.request('/api/auth/me', session);
  assert.equal(me.status, 200); assert.equal((await me.json()).user.id, admin.id);
});

test('login is generic, rotates an existing session and does not accept role injection', async t => {
  const f = await fixture(t);
  const account = await f.create('viewer');
  const wrong = await f.request('/api/auth/login', { method: 'POST', body: { username: account.username, password: password() } });
  const unknown = await f.request('/api/auth/login', { method: 'POST', body: { username: 'missing', password: password() } });
  assert.equal(wrong.status, 401); assert.equal(unknown.status, 401); assert.deepEqual(await wrong.json(), await unknown.json());
  const original = await f.login(account);
  const rotated = await f.request('/api/auth/login', { method: 'POST', cookie: original.cookie, body: { username: account.username, password: account.password } });
  assert.equal(rotated.status, 200);
  assert.notEqual(rotated.headers.get('set-cookie').split(';')[0], original.cookie);
  assert.equal((await f.request('/api/auth/me', original)).status, 401);
  const injection = await f.request('/api/auth/login', { method: 'POST', body: { username: account.username, password: account.password, role: 'admin' } });
  assert.equal(injection.status, 400);
});

test('dashboard uses server-side scoped data and rejects invalid scopes', async t => {
  const f = await fixture(t);
  const session = await f.login(await f.create('viewer'));
  const response = await f.request('/api/dashboard?' + new URLSearchParams({ period: '近7天', shop: '天猫旗舰店' }), session);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.products[0][5], Math.round(1286 * .27 * .64));
  assert.equal(data.products[0][6], Math.round(371654 * .27 * .64));
  assert.equal(data.metrics.paymentAmount, Math.round(1286590 * .27 * .64));
  assert.equal(data.workspaceName, '云上商业工作空间');
  assert.equal((await f.request('/api/dashboard?shop=untrusted', session)).status, 400);
});

test('viewer cannot export, access settings, list users or create admins; analyst can export', async t => {
  const f = await fixture(t);
  const viewer = await f.login(await f.create('viewer'));
  for (const path of ['/api/reports/export', '/api/settings', '/api/admin/users']) assert.equal((await f.request(path, viewer)).status, 403, path);
  assert.equal((await f.request('/api/admin/users', { ...viewer, method: 'POST', body: { username: 'attacker', password: password(), displayName: '攻击', role: 'admin' } })).status, 403);
  assert.equal((await f.request('/api/settings', { ...viewer, method: 'PATCH', body: { workspaceName: 'unauthorized' } })).status, 403);
  const analyst = await f.login(await f.create('analyst'));
  const report = await f.request('/api/reports/export?' + new URLSearchParams({ query: '耳机', category: '数码家电', sort: 'asc' }), analyst);
  assert.equal(report.status, 200); assert.match(report.headers.get('content-type'), /text\/csv/);
  const text = await report.text(); assert.match(text, /无线降噪蓝牙耳机/); assert.doesNotMatch(text, /托特包/);
  assert.equal((await f.request('/api/settings', analyst)).status, 403);
  assert.equal((await f.request('/api/admin/users', analyst)).status, 403);
});

test('all writes enforce Origin and authenticated writes enforce CSRF', async t => {
  const f = await fixture(t);
  const account = await f.create('admin');
  for (const origin of [null, 'https://evil.example']) {
    assert.equal((await f.request('/api/auth/login', { method: 'POST', origin, body: { username: account.username, password: account.password } })).status, 403);
  }
  const session = await f.login(account);
  for (const change of [{ csrf: null }, { csrf: 'wrong' }, { csrf: 'é'.repeat(43) }, { origin: 'https://evil.example' }, { origin: null }]) {
    const response = await f.request('/api/settings', { ...session, ...change, method: 'PATCH', body: { workspaceName: 'Blocked' } });
    assert.equal(response.status, 403);
  }
  const saved = await f.request('/api/settings', { ...session, method: 'PATCH', body: { workspaceName: '可信工作空间' } });
  assert.equal(saved.status, 200);
  const settings = await f.request('/api/settings', session); assert.equal((await settings.json()).workspaceName, '可信工作空间');
  const crossSite = await f.request('/api/dashboard', { ...session, headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(crossSite.status, 403);
});

test('admin manages users without mass assignment, weak passwords or leaking hashes', async t => {
  const f = await fixture(t);
  const session = await f.login(await f.create('admin'));
  const body = { username: 'member', displayName: '普通成员', password: password(), role: 'viewer' };
  const created = await f.request('/api/admin/users', { ...session, method: 'POST', body });
  assert.equal(created.status, 201);
  const user = (await created.json()).user;
  assert.equal(user.role, 'viewer'); assert.equal(user.password, undefined); assert.equal(user.password_hash, undefined);
  assert.equal((await f.request('/api/admin/users', { ...session, method: 'POST', body })).status, 409);
  assert.equal((await f.request('/api/admin/users', { ...session, method: 'POST', body: { ...body, username: 'weak', password: '123456' } })).status, 400);
  assert.equal((await f.request('/api/admin/users', { ...session, method: 'POST', body: { ...body, username: 'mass', enabled: true } })).status, 400);
  assert.equal((await f.request(`/api/admin/users/${user.id}`, { ...session, method: 'PATCH', body: { username: 'admin' } })).status, 400);
  const listing = await f.request('/api/admin/users', session);
  assert.equal(listing.status, 200); assert.doesNotMatch(JSON.stringify(await listing.json()), /password|csrf|token/);
});

test('last enabled admin cannot be demoted or disabled', async t => {
  const f = await fixture(t);
  const account = await f.create('admin');
  const session = await f.login(account);
  for (const body of [{ role: 'viewer' }, { enabled: false }]) {
    const response = await f.request(`/api/admin/users/${account.id}`, { ...session, method: 'PATCH', body });
    assert.equal(response.status, 409);
  }
  assert.equal((await f.request('/api/admin/users', session)).status, 200);
});

test('role changes and disabled accounts revoke all sessions immediately', async t => {
  const f = await fixture(t);
  const admin = await f.login(await f.create('admin'));
  const account = await f.create('analyst');
  const first = await f.login(account); const second = await f.login(account);
  assert.equal((await f.request(`/api/admin/users/${account.id}`, { ...admin, method: 'PATCH', body: { role: 'viewer' } })).status, 200);
  assert.equal((await f.request('/api/auth/me', first)).status, 401);
  assert.equal((await f.request('/api/auth/me', second)).status, 401);
  const renewed = await f.login(account); assert.equal(renewed.user.role, 'viewer');
  assert.equal((await f.request('/api/reports/export', renewed)).status, 403);
  assert.equal((await f.request(`/api/admin/users/${account.id}`, { ...admin, method: 'PATCH', body: { enabled: false } })).status, 200);
  assert.equal((await f.request('/api/dashboard', renewed)).status, 401);
  const denied = await f.request('/api/auth/login', { method: 'POST', body: { username: account.username, password: account.password } });
  assert.equal(denied.status, 401);
});

test('password resets invalidate prior password and active sessions', async t => {
  const f = await fixture(t);
  const admin = await f.login(await f.create('admin'));
  const account = await f.create('viewer'); const session = await f.login(account);
  const replacement = password();
  assert.equal((await f.request(`/api/admin/users/${account.id}`, { ...admin, method: 'PATCH', body: { password: replacement } })).status, 200);
  assert.equal((await f.request('/api/auth/me', session)).status, 401);
  assert.equal((await f.request('/api/auth/login', { method: 'POST', body: { username: account.username, password: account.password } })).status, 401);
  const updated = await f.login({ ...account, password: replacement }); assert.equal(updated.user.id, account.id);
});

test('logout destroys the server session and expired sessions fail closed', async t => {
  let time = Date.now();
  const f = await fixture(t, { now: () => time, sessionMs: 1000 });
  const account = await f.create('viewer');
  const original = await f.login(account);
  const logout = await f.request('/api/auth/logout', { ...original, method: 'POST' });
  assert.equal(logout.status, 200); assert.match(logout.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  assert.equal((await f.request('/api/dashboard', original)).status, 401);
  const replacement = await f.login(account); time += 1001;
  assert.equal((await f.request('/api/auth/me', replacement)).status, 401);
});

test('login throttling covers valid passwords and ignores spoofed forwarded IP', async t => {
  const f = await fixture(t, { loginLimits: { maxAccount: 20, maxIp: 2 } });
  const account = await f.create('viewer');
  await f.login(account); await f.login(account);
  const limited = await f.request('/api/auth/login', { method: 'POST', body: { username: account.username, password: account.password }, headers: { 'X-Forwarded-For': '8.8.8.8' } });
  assert.equal(limited.status, 429); assert.ok(limited.headers.get('retry-after'));
});

test('SQLite users, sessions and settings survive a process-equivalent reopen', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'ali-auth-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const dbPath = join(directory, 'persistent.sqlite');
  const one = createApp({ dbPath, origin: ORIGIN });
  const secret = password();
  const account = await one.store.createUser({ username: 'admin', displayName: '管理员', password: secret, role: 'admin' });
  const server = one.app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(url + '/api/auth/login', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: account.username, password: secret }) });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const csrf = (await response.json()).csrfToken;
  const updated = await fetch(url + '/api/settings', { method: 'PATCH', headers: { Origin: ORIGIN, Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ workspaceName: '持久化工作空间' }) });
  assert.equal(updated.status, 200);
  await new Promise(resolve => server.close(resolve)); one.close();
  const two = await fixture(t, { dbPath });
  const session = { cookie };
  const me = await two.request('/api/auth/me', session); assert.equal(me.status, 200); assert.equal((await me.json()).user.id, account.id);
  const settings = await two.request('/api/settings', session); assert.equal((await settings.json()).workspaceName, '持久化工作空间');
});

test('production enforces HTTPS, Secure cookies and does not expose backend files', async t => {
  assert.throws(() => createApp({ dbPath: ':memory:', production: true, origin: 'http://example.com' }), /HTTPS/);
  const dir = mkdtempSync(join(tmpdir(), 'ali-static-test-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'assets')); writeFileSync(join(dir, 'index.html'), '<!doctype html><title>login</title>');
  const f = await fixture(t, { production: true, origin: 'https://insight.example', staticDir: dir });
  const session = await f.login(await f.create('admin'));
  assert.match(session.response.headers.get('set-cookie'), /^__Host-ali_session=/); assert.match(session.response.headers.get('set-cookie'), /; Secure/);
  assert.equal((await f.request('/')).status, 200);
  for (const path of ['/server/app.js', '/.env', '/data/ali-insight.sqlite', '/package.json']) assert.equal((await f.request(path)).status, 404, path);
  const unknown = await f.request('/api/unknown'); assert.equal(unknown.status, 404); assert.match(unknown.headers.get('content-type'), /json/);
  assert.equal((await f.request('/api/health')).headers.get('access-control-allow-origin'), null);
});

test('malformed and oversized JSON bodies are rejected without stack leaks', async t => {
  const f = await fixture(t);
  const response = await f.request('/api/auth/login', { method: 'POST', body: { username: 'abc', password: 'x'.repeat(20000) } });
  assert.equal(response.status, 413); assert.deepEqual(await response.json(), { error: '请求内容过大' });
});


test('in-flight admin creates and password updates stop after actor session revocation', async t => {
  for (const action of ['create', 'update']) {
    let enteredHash;
    const started = new Promise(resolve => { enteredHash = resolve; });
    let releaseHash;
    const pendingHash = new Promise(resolve => { releaseHash = resolve; });
    const f = await fixture(t, { passwordHasher: async value => { enteredHash(); await pendingHash; return hashPassword(value); } });
    const account = await f.create('admin');
    const admin = await f.login(account);
    const target = await f.create('viewer');
    const originalHash = f.store.db.prepare('SELECT password_hash FROM users WHERE id=?').get(target.id).password_hash;
    const call = action === 'create'
      ? f.request('/api/admin/users', { ...admin, method: 'POST', body: { username: 'blocked', displayName: '不得创建', password: password(), role: 'admin' } })
      : f.request(`/api/admin/users/${target.id}`, { ...admin, method: 'PATCH', body: { role: 'admin', password: password() } });
    await started;
    f.store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(account.id);
    releaseHash();
    const response = await call;
    assert.equal(response.status, 401, action);
    assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM users WHERE username='blocked'").get().n, 0);
    const unchanged = f.store.db.prepare('SELECT * FROM users WHERE id=?').get(target.id);
    assert.equal(unchanged.role, 'viewer'); assert.equal(unchanged.password_hash, originalHash);
  }
});
