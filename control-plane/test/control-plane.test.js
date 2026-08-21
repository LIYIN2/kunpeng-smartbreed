const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApplication } = require('../server.js');

test('owner, roles, review separation, feedback, and audit', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kunpeng-control-plane-'));
  const app = createApplication({ dbPath: path.join(dir, 'test.sqlite'), bootstrapToken: 'test-bootstrap-token' });
  const server = http.createServer(app.handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); app.close(); });

  async function call(route, { token, headers, ...options } = {}) {
    const response = await fetch(base + route, { ...options, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
    return { status: response.status, body: await response.json() };
  }
  async function login(email, password) {
    const result = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }); assert.equal(result.status, 200); return result.body;
  }

  let result = await call('/api/setup/owner', { method: 'POST', headers: { 'x-bootstrap-token': 'test-bootstrap-token' }, body: JSON.stringify({ email: 'liyin59375@gmail.com', name: '李寅', password: 'Owner-password-2026' }) });
  assert.equal(result.status, 201); const owner = (await login('liyin59375@gmail.com', 'Owner-password-2026')).token;

  result = await call('/api/admin/users', { token: owner, method: 'POST', body: JSON.stringify({ email: 'reviewer@example.com', name: '审核同学', role: 'reviewer', password: 'Reviewer-pass-2026' }) }); assert.equal(result.status, 201);
  result = await call('/api/admin/users', { token: owner, method: 'POST', body: JSON.stringify({ email: 'member@example.com', name: '普通同学', role: 'member', password: 'Member-pass-2026' }) }); assert.equal(result.status, 201); const memberId = result.body.id;
  const reviewerLogin = await login('reviewer@example.com', 'Reviewer-pass-2026'); const memberLogin = await login('member@example.com', 'Member-pass-2026');
  assert.equal(reviewerLogin.user.mustChangePassword, true); assert.equal(memberLogin.user.mustChangePassword, true);
  result = await call('/api/knowledge', { token: reviewerLogin.token }); assert.equal(result.status, 403);
  result = await call('/api/me/password', { token: reviewerLogin.token, method: 'POST', body: JSON.stringify({ currentPassword: 'Reviewer-pass-2026', newPassword: 'Reviewer-new-pass-2026' }) }); assert.equal(result.status, 200);
  result = await call('/api/me/password', { token: memberLogin.token, method: 'POST', body: JSON.stringify({ currentPassword: 'Member-pass-2026', newPassword: 'Member-new-pass-2026' }) }); assert.equal(result.status, 200);
  const reviewer = reviewerLogin.token; const member = memberLogin.token;

  result = await call('/api/admin/users', { token: reviewer }); assert.equal(result.status, 403);
  result = await call('/api/knowledge', { token: reviewer, method: 'POST', body: JSON.stringify({ title: '审核员自己的条目', content: '内容', sourceLocator: '内部文件 p.1' }) }); assert.equal(result.status, 201); const ownKnowledge = result.body.id;
  result = await call(`/api/knowledge/${ownKnowledge}/review`, { token: reviewer, method: 'PATCH', body: JSON.stringify({ status: 'approved', note: '通过' }) }); assert.equal(result.status, 409);

  result = await call('/api/knowledge', { token: member, method: 'POST', body: JSON.stringify({ title: 'RNA 样本规范', content: '样本 ID 必须唯一。', sourceLocator: 'SOP 第 2 节' }) }); assert.equal(result.status, 201); const knowledgeId = result.body.id;
  result = await call(`/api/knowledge/${knowledgeId}/review`, { token: reviewer, method: 'PATCH', body: JSON.stringify({ status: 'approved', note: '已核对 SOP 原文' }) }); assert.equal(result.status, 200);
  result = await call('/api/knowledge', { token: member }); assert.equal(result.body.submissions[0].status, 'approved');

  result = await call('/api/feedback', { token: member, method: 'POST', body: JSON.stringify({ category: '问题报告', title: '导入失败', body: 'CSV 无法导入' }) }); assert.equal(result.status, 201); const feedbackId = result.body.id;
  result = await call(`/api/feedback/${feedbackId}`, { token: reviewer, method: 'PATCH', body: JSON.stringify({ status: 'resolved', response: '已修复并复测' }) }); assert.equal(result.status, 200);
  result = await call('/api/feedback', { token: member }); assert.equal(result.body.feedback[0].status, 'resolved');

  result = await call(`/api/admin/users/${memberId}/password`, { token: owner, method: 'POST', body: JSON.stringify({ password: 'Member-reset-2026' }) }); assert.equal(result.status, 200);
  result = await call('/api/me', { token: member }); assert.equal(result.status, 401);
  const resetLogin = await login('member@example.com', 'Member-reset-2026'); assert.equal(resetLogin.user.mustChangePassword, true);
  result = await call('/api/feedback', { token: resetLogin.token }); assert.equal(result.status, 403);

  result = await call('/api/audit?limit=200', { token: owner }); assert.equal(result.status, 200); assert.ok(result.body.logs.some(log => log.action === 'knowledge.approved')); assert.ok(result.body.logs.some(log => log.action === 'feedback.update'));
  assert.ok(result.body.logs.some(log => log.action === 'user.password_reset'));
});
