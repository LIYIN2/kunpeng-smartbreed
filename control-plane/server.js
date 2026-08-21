const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROLE_ORDER = { member: 1, reviewer: 2, admin: 3, owner: 4 };
const USER_ROLES = new Set(Object.keys(ROLE_ORDER));
const OWNER_EMAIL = 'liyin59375@gmail.com';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 1024 * 1024;

function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function tokenHash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
function safeJson(value) { try { return JSON.stringify(value); } catch { return '{}'; } }

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, encoded) {
  const [, salt, expected] = String(encoded).split('$');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
}

function openDatabase(filename) {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('owner','admin','reviewer','member')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
      password_hash TEXT NOT NULL, must_change_password INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS knowledge_submissions (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, source_locator TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','withdrawn')),
      submitter_id TEXT NOT NULL REFERENCES users(id), reviewer_id TEXT REFERENCES users(id),
      review_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY, category TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','triaged','resolved','closed')),
      submitter_id TEXT NOT NULL REFERENCES users(id), assignee_id TEXT REFERENCES users(id),
      response TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL,
      entity_type TEXT NOT NULL, entity_id TEXT, details TEXT NOT NULL DEFAULT '{}', ip TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_status ON knowledge_submissions(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status, created_at);
  `);
  const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map(column => column.name));
  if (!userColumns.has('must_change_password')) db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 1');
  return db;
}

function json(res, status, body, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('请求内容超过 1 MB'), { status: 413 });
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('JSON 格式无效'), { status: 400 }); }
}

function createApplication(options = {}) {
  const db = openDatabase(options.dbPath || process.env.KUNPENG_DB_PATH || path.join(__dirname, 'data', 'kunpeng.sqlite'));
  const bootstrapToken = options.bootstrapToken ?? process.env.KUNPENG_BOOTSTRAP_TOKEN ?? '';
  const publicDir = options.publicDir || path.join(__dirname, 'public');
  const loginAttempts = new Map();

  function audit(actorId, action, entityType, entityId, details, ip) {
    db.prepare('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,details,ip,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(actorId || null, action, entityType, entityId || null, safeJson(details), ip || null, now());
  }

  function currentUser(req) {
    const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    if (!match) return null;
    const row = db.prepare(`SELECT u.id,u.email,u.name,u.role,u.status,u.must_change_password,s.expires_at
      FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`).get(tokenHash(match[1]));
    if (!row || row.status !== 'active' || Date.parse(row.expires_at) <= Date.now()) return null;
    return row;
  }

  function requireRole(req, res, minimum = 'member') {
    const user = currentUser(req);
    if (!user) { json(res, 401, { error: '请先登录' }); return null; }
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (user.must_change_password && !['/api/me', '/api/me/password', '/api/auth/logout'].includes(pathname)) { json(res, 403, { error: '首次登录必须先修改临时密码' }); return null; }
    if (ROLE_ORDER[user.role] < ROLE_ORDER[minimum]) { json(res, 403, { error: '权限不足' }); return null; }
    return user;
  }

  function listRows(sql, ...params) { return db.prepare(sql).all(...params); }

  async function api(req, res, url) {
    const ip = req.socket.remoteAddress;
    if (req.method === 'GET' && url.pathname === '/api/health') {
      const ownerCount = db.prepare("SELECT count(*) AS n FROM users WHERE role='owner'").get().n;
      return json(res, 200, { ok: true, service: 'kunpeng-control-plane', ownerConfigured: ownerCount === 1, time: now() });
    }
    if (req.method === 'POST' && url.pathname === '/api/setup/owner') {
      if (db.prepare('SELECT count(*) AS n FROM users').get().n > 0) return json(res, 409, { error: '系统已完成初始化' });
      if (!bootstrapToken || req.headers['x-bootstrap-token'] !== bootstrapToken) return json(res, 403, { error: '初始化令牌无效' });
      const body = await readBody(req); const email = normalizeEmail(body.email); const password = String(body.password || ''); const name = String(body.name || '').trim();
      if (email !== OWNER_EMAIL) return json(res, 400, { error: `系统所有者必须为 ${OWNER_EMAIL}` });
      if (name.length < 2 || password.length < 12) return json(res, 400, { error: '姓名至少 2 字符，密码至少 12 字符' });
      const userId = id('usr'); const stamp = now();
      db.prepare('INSERT INTO users(id,email,name,role,status,password_hash,must_change_password,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(userId, email, name, 'owner', 'active', hashPassword(password), 0, stamp, stamp);
      audit(userId, 'owner.bootstrap', 'user', userId, { email }, ip);
      return json(res, 201, { id: userId, email, name, role: 'owner' });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const key = ip || 'unknown'; const recent = (loginAttempts.get(key) || []).filter(time => Date.now() - time < 10 * 60 * 1000);
      if (recent.length >= 10) return json(res, 429, { error: '登录尝试过多，请稍后重试' });
      const body = await readBody(req); const email = normalizeEmail(body.email); const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
      if (!user || user.status !== 'active' || !verifyPassword(String(body.password || ''), user.password_hash)) {
        recent.push(Date.now()); loginAttempts.set(key, recent); audit(user?.id, 'auth.login_failed', 'user', user?.id, { email }, ip);
        return json(res, 401, { error: '邮箱或密码错误' });
      }
      loginAttempts.delete(key); const rawToken = crypto.randomBytes(32).toString('base64url'); const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
      db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(tokenHash(rawToken), user.id, expiresAt, now());
      audit(user.id, 'auth.login', 'session', null, {}, ip);
      return json(res, 200, { token: rawToken, expiresAt, user: { id: user.id, email: user.email, name: user.name, role: user.role, mustChangePassword: Boolean(user.must_change_password) } });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
      const user = requireRole(req, res); if (!user) return;
      const raw = String(req.headers.authorization).replace(/^Bearer\s+/i, ''); db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(raw));
      audit(user.id, 'auth.logout', 'session', null, {}, ip); return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/me') {
      const user = requireRole(req, res); if (!user) return; const account = db.prepare('SELECT id,email,name,role,status,must_change_password FROM users WHERE id=?').get(user.id); return json(res, 200, { user: { ...account, mustChangePassword: Boolean(account.must_change_password) } });
    }
    if (req.method === 'POST' && url.pathname === '/api/me/password') {
      const actor = requireRole(req, res); if (!actor) return; const body = await readBody(req); const current = String(body.currentPassword || ''); const next = String(body.newPassword || ''); const account = db.prepare('SELECT * FROM users WHERE id=?').get(actor.id);
      if (!verifyPassword(current, account.password_hash)) return json(res, 400, { error: '当前密码错误' });
      if (next.length < 12 || next === current) return json(res, 400, { error: '新密码至少 12 字符且不能与当前密码相同' });
      db.prepare('UPDATE users SET password_hash=?,must_change_password=0,updated_at=? WHERE id=?').run(hashPassword(next), now(), actor.id);
      const raw = String(req.headers.authorization).replace(/^Bearer\s+/i, ''); db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(actor.id, tokenHash(raw));
      audit(actor.id, 'user.password_change', 'user', actor.id, {}, ip); return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/users') {
      const actor = requireRole(req, res, 'admin'); if (!actor) return;
      return json(res, 200, { users: listRows('SELECT id,email,name,role,status,created_at,updated_at FROM users ORDER BY created_at') });
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/users') {
      const actor = requireRole(req, res, 'admin'); if (!actor) return;
      const body = await readBody(req); const role = String(body.role || 'member'); const email = normalizeEmail(body.email); const name = String(body.name || '').trim(); const password = String(body.password || '');
      if (!USER_ROLES.has(role) || role === 'owner' || (role === 'admin' && actor.role !== 'owner')) return json(res, 403, { error: '不能创建该角色' });
      if (!email.includes('@') || name.length < 2 || password.length < 12) return json(res, 400, { error: '请填写有效邮箱、姓名和至少 12 字符密码' });
      const userId = id('usr'); const stamp = now();
      try { db.prepare('INSERT INTO users(id,email,name,role,status,password_hash,must_change_password,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(userId, email, name, role, 'active', hashPassword(password), 1, stamp, stamp); }
      catch { return json(res, 409, { error: '邮箱已存在' }); }
      audit(actor.id, 'user.create', 'user', userId, { email, role }, ip); return json(res, 201, { id: userId });
    }
    const passwordResetMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/password$/);
    if (passwordResetMatch && req.method === 'POST') {
      const actor = requireRole(req, res, 'admin'); if (!actor) return; const target = db.prepare('SELECT * FROM users WHERE id=?').get(passwordResetMatch[1]); if (!target) return json(res, 404, { error: '用户不存在' });
      if (target.role === 'owner' || (target.role === 'admin' && actor.role !== 'owner')) return json(res, 403, { error: '无权重置该账号密码' });
      const body = await readBody(req); const password = String(body.password || ''); if (password.length < 12) return json(res, 400, { error: '临时密码至少 12 字符' });
      db.prepare('UPDATE users SET password_hash=?,must_change_password=1,updated_at=? WHERE id=?').run(hashPassword(password), now(), target.id); db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
      audit(actor.id, 'user.password_reset', 'user', target.id, {}, ip); return json(res, 200, { ok: true });
    }
    const userMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (userMatch && req.method === 'PATCH') {
      const actor = requireRole(req, res, 'admin'); if (!actor) return; const target = db.prepare('SELECT * FROM users WHERE id=?').get(userMatch[1]); if (!target) return json(res, 404, { error: '用户不存在' });
      const body = await readBody(req); const nextRole = body.role ?? target.role; const nextStatus = body.status ?? target.status;
      if (target.role === 'owner' || nextRole === 'owner' || (!USER_ROLES.has(nextRole)) || !['active','disabled'].includes(nextStatus)) return json(res, 403, { error: '系统所有者不可由此接口修改' });
      if ((target.role === 'admin' || nextRole === 'admin') && actor.role !== 'owner') return json(res, 403, { error: '只有系统所有者能管理管理员' });
      db.prepare('UPDATE users SET role=?,status=?,updated_at=? WHERE id=?').run(nextRole, nextStatus, now(), target.id); if (nextStatus === 'disabled') db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
      audit(actor.id, 'user.update', 'user', target.id, { from: { role: target.role, status: target.status }, to: { role: nextRole, status: nextStatus } }, ip); return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/api/knowledge') {
      const actor = requireRole(req, res); if (!actor) return;
      const sql = ROLE_ORDER[actor.role] >= ROLE_ORDER.reviewer ? `SELECT k.*,u.name submitter_name,r.name reviewer_name FROM knowledge_submissions k JOIN users u ON u.id=k.submitter_id LEFT JOIN users r ON r.id=k.reviewer_id ORDER BY k.created_at DESC` : `SELECT k.*,u.name submitter_name,r.name reviewer_name FROM knowledge_submissions k JOIN users u ON u.id=k.submitter_id LEFT JOIN users r ON r.id=k.reviewer_id WHERE k.submitter_id=? ORDER BY k.created_at DESC`;
      return json(res, 200, { submissions: ROLE_ORDER[actor.role] >= ROLE_ORDER.reviewer ? listRows(sql) : listRows(sql, actor.id) });
    }
    if (req.method === 'POST' && url.pathname === '/api/knowledge') {
      const actor = requireRole(req, res); if (!actor) return; const body = await readBody(req); const title = String(body.title || '').trim(); const content = String(body.content || '').trim(); const locator = String(body.sourceLocator || '').trim();
      if (!title || !content || !locator) return json(res, 400, { error: '标题、知识正文和来源定位均为必填' });
      const submissionId = id('knw'); const stamp = now(); db.prepare('INSERT INTO knowledge_submissions(id,title,content,source_locator,submitter_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(submissionId, title, content, locator, actor.id, stamp, stamp);
      audit(actor.id, 'knowledge.submit', 'knowledge', submissionId, { title }, ip); return json(res, 201, { id: submissionId, status: 'pending' });
    }
    const knowledgeMatch = url.pathname.match(/^\/api\/knowledge\/([^/]+)\/review$/);
    if (knowledgeMatch && req.method === 'PATCH') {
      const actor = requireRole(req, res, 'reviewer'); if (!actor) return; const body = await readBody(req); const status = String(body.status || ''); const note = String(body.note || '').trim();
      if (!['approved','rejected'].includes(status) || !note) return json(res, 400, { error: '审核结论和审核意见均为必填' });
      const item = db.prepare('SELECT * FROM knowledge_submissions WHERE id=?').get(knowledgeMatch[1]); if (!item) return json(res, 404, { error: '知识条目不存在' }); if (item.status !== 'pending') return json(res, 409, { error: '该条目已完成审核' }); if (item.submitter_id === actor.id) return json(res, 409, { error: '提交人不能审核自己的知识' });
      db.prepare('UPDATE knowledge_submissions SET status=?,reviewer_id=?,review_note=?,updated_at=? WHERE id=?').run(status, actor.id, note, now(), item.id); audit(actor.id, `knowledge.${status}`, 'knowledge', item.id, { note }, ip); return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/api/feedback') {
      const actor = requireRole(req, res); if (!actor) return; const elevated = ROLE_ORDER[actor.role] >= ROLE_ORDER.reviewer;
      const sql = `SELECT f.*,u.name submitter_name,a.name assignee_name FROM feedback f JOIN users u ON u.id=f.submitter_id LEFT JOIN users a ON a.id=f.assignee_id ${elevated ? '' : 'WHERE f.submitter_id=?'} ORDER BY f.created_at DESC`;
      return json(res, 200, { feedback: elevated ? listRows(sql) : listRows(sql, actor.id) });
    }
    if (req.method === 'POST' && url.pathname === '/api/feedback') {
      const actor = requireRole(req, res); if (!actor) return; const body = await readBody(req); const category = String(body.category || 'other').trim(); const title = String(body.title || '').trim(); const content = String(body.body || '').trim(); if (!title || !content) return json(res, 400, { error: '标题和内容为必填' });
      const feedbackId = id('fb'); const stamp = now(); db.prepare('INSERT INTO feedback(id,category,title,body,submitter_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(feedbackId, category, title, content, actor.id, stamp, stamp); audit(actor.id, 'feedback.submit', 'feedback', feedbackId, { category, title }, ip); return json(res, 201, { id: feedbackId });
    }
    const feedbackMatch = url.pathname.match(/^\/api\/feedback\/([^/]+)$/);
    if (feedbackMatch && req.method === 'PATCH') {
      const actor = requireRole(req, res, 'reviewer'); if (!actor) return; const item = db.prepare('SELECT * FROM feedback WHERE id=?').get(feedbackMatch[1]); if (!item) return json(res, 404, { error: '反馈不存在' }); const body = await readBody(req); const status = String(body.status || item.status); const response = String(body.response ?? item.response).trim(); if (!['open','triaged','resolved','closed'].includes(status)) return json(res, 400, { error: '状态无效' });
      db.prepare('UPDATE feedback SET status=?,assignee_id=?,response=?,updated_at=? WHERE id=?').run(status, actor.id, response, now(), item.id); audit(actor.id, 'feedback.update', 'feedback', item.id, { status }, ip); return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/audit') {
      const actor = requireRole(req, res, 'admin'); if (!actor) return; const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 100)));
      return json(res, 200, { logs: listRows(`SELECT a.*,u.name actor_name,u.email actor_email FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT ${limit}`) });
    }
    return json(res, 404, { error: '接口不存在' });
  }

  function staticFile(req, res, url) {
    const files = { '/': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css' }; const file = files[url.pathname];
    if (!file) return false; const full = path.join(publicDir, file); if (!fs.existsSync(full)) return false;
    const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8'; res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'" }); res.end(fs.readFileSync(full)); return true;
  }

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try { if (url.pathname.startsWith('/api/')) return await api(req, res, url); if (req.method === 'GET' && staticFile(req, res, url)) return; json(res, 404, { error: '页面不存在' }); }
    catch (error) { json(res, error.status || 500, { error: error.status ? error.message : '服务器内部错误' }); if (!error.status) console.error(error); }
  };
  return { db, handler, close: () => db.close() };
}

if (require.main === module) {
  const dataDir = path.join(__dirname, 'data'); fs.mkdirSync(dataDir, { recursive: true });
  const app = createApplication(); const host = process.env.KUNPENG_HOST || '127.0.0.1'; const port = Number(process.env.KUNPENG_PORT || 4789);
  http.createServer(app.handler).listen(port, host, () => {
    console.log(`鲲鹏管理中心: http://${host}:${port}`);
    if (!process.env.KUNPENG_BOOTSTRAP_TOKEN) console.log('尚未设置 KUNPENG_BOOTSTRAP_TOKEN，系统所有者初始化接口已禁用。');
  });
}

module.exports = { createApplication, hashPassword, verifyPassword, OWNER_EMAIL };
