process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engx-sections-voice-'));
process.env.DATABASE_PATH = path.join(dir, 'test.sqlite');
process.env.JWT_SECRET = 'sections-voice-test-secret-over-32-characters';
const {app, db} = await import('./server.mjs');
const server = http.createServer(app);
await new Promise(resolve => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}`;
async function req(url, token, body, method) {
  const response = await fetch(base + url, {method: method || (body ? 'POST' : 'GET'), headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})}, ...(body ? {body: JSON.stringify(body)} : {})});
  return [response.status, await response.json()];
}
async function register(email) {
  const [status, body] = await req('/api/auth/register', null, {name: email, email, password: 'long-password-1'});
  assert.equal(status, 201); return body;
}

test('owner section management and workspace/domain isolation', async () => {
  const owner = await register('sections-owner@example.com');
  const viewer = await register('sections-viewer@example.com');
  const workspace_id = owner.workspace.id;
  db.prepare('INSERT INTO memberships VALUES (?,?,?,?,?)').run(crypto.randomUUID(), workspace_id, viewer.user.id, 'viewer', 'active');
  const a = 'custom_' + crypto.randomUUID().replace(/-/g, '');
  const b = 'custom_' + crypto.randomUUID().replace(/-/g, '');
  let [status, body] = await req('/api/sections/' + a, owner.token, {workspace_id, label: 'قسم تجريبي أ'}, 'PUT');
  assert.equal(status, 200); assert.equal(body.section.id, a);
  [status] = await req('/api/sections/' + b, viewer.token, {workspace_id, label: 'ممنوع'}, 'PUT');
  assert.equal(status, 403);
  [status] = await req('/api/sections/' + b, owner.token, {workspace_id, label: 'قسم تجريبي ب'}, 'PUT'); assert.equal(status, 200);
  const makeRecord = domain => ({id: crypto.randomUUID(), type: 'device', workspace_id, created_by: owner.user.id, domain, data: {name: domain, asset_code: 'SHARED-CUSTOM'}, version: 1});
  const operations = [a, b].map(domain => ({id: crypto.randomUUID(), action: 'create', record: makeRecord(domain)}));
  [status, body] = await req('/api/sync', owner.token, {workspace_id, operations});
  assert.equal(status, 200); assert.equal(body.accepted.length, 2);
  for (const op of operations) assert.equal(db.prepare('SELECT domain FROM records WHERE id=?').get(op.record.id).domain, op.record.domain);
  const unknown = 'custom_' + crypto.randomUUID().replace(/-/g, '');
  [status, body] = await req('/api/sync', owner.token, {workspace_id, operations: [{id: crypto.randomUUID(), action: 'create', record: makeRecord(unknown)}]});
  assert.equal(status, 200); assert.equal(body.rejected[0].reason, 'INVALID_DOMAIN');
  [status] = await req(`/api/sections?workspace_id=${viewer.workspace.id}`, owner.token); assert.equal(status, 403);
  [status] = await req('/api/sections/' + a, owner.token, {workspace_id, label: 'اسم جديد', archived: true}, 'PUT'); assert.equal(status, 200);
  [status, body] = await req(`/api/sections?workspace_id=${workspace_id}`, viewer.token); assert.equal(status, 200);
  assert.ok(body.sections.some(d => d.id === a && d.archived && d.label === 'اسم جديد'));
});

test('voice audio file posts idempotently and stays inside its custom section', async () => {
  const owner = await register('voice-owner@example.com'); const workspace_id = owner.workspace.id;
  const domain = 'custom_' + crypto.randomUUID().replace(/-/g, '');
  let [status] = await req('/api/sections/' + domain, owner.token, {workspace_id, label: 'دردشة صوتية'}, 'PUT'); assert.equal(status, 200);
  for (const [mime, extension] of [['audio/mp4', 'mp4'], ['audio/webm;codecs=opus', 'webm']]) {
    const content = `data:${mime};base64,SGk=`;
    const payload = {workspace_id, domain, client_id: crypto.randomUUID(), text: '', file: {name: `voice.${extension}`, mime, size: 2, content}};
    let body; [status, body] = await req('/api/chat/messages', owner.token, payload);
    assert.equal(status, 201); const message = body.message;
    [status, body] = await req('/api/chat/messages', owner.token, payload); assert.equal(status, 200); assert.equal(body.message.id, message.id);
    [status] = await req(`/api/chat/files/${message.file.id}?workspace_id=${workspace_id}&domain=medical`, owner.token); assert.equal(status, 404);
    [status, body] = await req(`/api/chat/files/${message.file.id}?workspace_id=${workspace_id}&domain=${domain}`, owner.token); assert.equal(status, 200); assert.equal(body.content, content);
  }
});

test.after(() => {server.close(); db.close(); fs.rmSync(dir, {recursive: true, force: true});});
