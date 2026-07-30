import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { open } from '../src/index.js';

test('CRUD operations on collections', () => {
  const db = open(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'youdata-')), 'test.ydb'));
  const users = db.collection('users');

  users.set('alice', { name: 'Alice', age: 30 });
  users.set('bob', { name: 'Bob', age: 25 });
  assert.equal(users.size, 2);
  assert.deepEqual(users.get('alice'), { name: 'Alice', age: 30 });

  users.set('alice', { name: 'Alice', age: 31 });
  assert.equal(users.get('alice').age, 31);

  assert.equal(users.has('bob'), true);
  assert.equal(users.has('nonexistent'), false);

  assert.equal(users.delete('bob'), true);
  assert.equal(users.delete('bob'), false);
  assert.equal(users.size, 1);

  users.clear();
  assert.equal(users.size, 0);
});

test('add method auto-generates key', () => {
  const db = open(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'youdata-')), 'test.ydb'));
  const items = db.collection('items');
  const ret = items.add({ name: 'Test' });
  const keys = items.keys();
  assert.equal(keys.length, 1);
  assert.ok(typeof keys[0] === 'string');
  assert.deepEqual(items.get(keys[0]), { name: 'Test' });
});

test('add method uses id field as key', () => {
  const db = open(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'youdata-')), 'test.ydb'));
  const items = db.collection('items');
  items.add({ id: 'custom-1', name: 'Custom' });
  assert.deepEqual(items.get('custom-1'), { id: 'custom-1', name: 'Custom' });
});

test('find, first, count with query operators', () => {
  const db = open(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'youdata-')), 'test.ydb'));
  const scores = db.collection('scores');
  scores.set('a', { player: 'Alice', score: 100 });
  scores.set('b', { player: 'Bob', score: 200 });
  scores.set('c', { player: 'Charlie', score: 150 });

  assert.equal(scores.count({ score: { $gt: 120 } }), 2);
  assert.equal(scores.count({ score: { $gte: 150 } }), 2);
  assert.equal(scores.count({ score: { $lt: 150 } }), 1);
  assert.equal(scores.count({ score: { $lte: 150 } }), 2);
  assert.equal(scores.count({ score: { $ne: 100 } }), 2);
  assert.equal(scores.count({ score: { $in: [100, 300] } }), 1);

  assert.deepEqual(scores.first({ player: 'Alice' }), { player: 'Alice', score: 100 });
  assert.equal(scores.first({ player: 'Nobody' }), undefined);
});

test('iteration methods', () => {
  const db = open(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'youdata-')), 'test.ydb'));
  const col = db.collection('col');
  col.set('k1', { v: 1 });
  col.set('k2', { v: 2 });

  assert.deepEqual(col.keys(), ['k1', 'k2']);
  assert.deepEqual(col.values(), [{ v: 1 }, { v: 2 }]);
  assert.deepEqual(col.entries(), [['k1', { v: 1 }], ['k2', { v: 2 }]]);
});

test('persistence across open/close', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'youdata-')), 'persist.ydb');
  const db = open(file);
  db.collection('test').set('key', { data: 'hello' });
  db.close();

  const db2 = open(file);
  assert.deepEqual(db2.collection('test').get('key'), { data: 'hello' });
  assert.equal(db2.collection('test').size, 1);
});

test('compact reduces storage size', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'youdata-')), 'compact.ydb');
  const db = open(file);
  db.collection('x').set('a', { v: 1 });
  db.collection('x').set('b', { v: 2 });
  db.collection('x').delete('a');
  db.collection('x').set('b', { v: 3 });

  const walSizeBefore = db.wal.size();
  db.compact();
  const walSizeAfter = db.wal.size();

  assert.ok(walSizeAfter < walSizeBefore, `compacted WAL ${walSizeAfter} should be smaller than ${walSizeBefore}`);
  assert.equal(db.collection('x').size, 1);
  assert.deepEqual(db.collection('x').get('b'), { v: 3 });
});

test('account creation and authentication', () => {
  const db = open(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'youdata-')), 'auth.ydb'));
  const result = db.createAccount('admin', 'secret', 'admin');
  assert.equal(result.username, 'admin');
  assert.equal(result.role, 'admin');
  assert.ok(result.createdAt);

  assert.throws(() => db.createAccount('admin', 'x'), /already exists/);
  assert.throws(() => db.createAccount('', 'x'), /required/);
  assert.throws(() => db.createAccount('x', ''), /required/);

  assert.equal(db.authenticate('admin', 'wrong'), null);
  assert.equal(db.authenticate('nonexistent', 'x'), null);

  const session = db.authenticate('admin', 'secret');
  assert.equal(session.username, 'admin');
  assert.equal(session.role, 'admin');
  assert.ok(session.token);
});

test('account authorization', () => {
  const db = open(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'youdata-')), 'auth2.ydb'));
  db.createAccount('admin', 'pass', 'admin');
  db.createAccount('user1', 'pass', 'editor');

  const adminSession = db.authenticate('admin', 'pass');
  const userSession = db.authenticate('user1', 'pass');

  assert.ok(db.authorize(adminSession.token));
  assert.ok(db.authorize(adminSession.token, 'admin'));
  assert.ok(db.authorize(adminSession.token, 'editor')); // admin can do anything

  assert.ok(db.authorize(userSession.token));
  assert.equal(db.authorize(userSession.token, 'admin'), null); // editor cannot admin
  assert.equal(db.authorize('invalid-token'), null);
});

test('accounts persist across open/close', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'youdata-')), 'auth-persist.ydb');
  const db = open(file);
  db.createAccount('persist-user', 'mypass', 'user');
  db.close();

  const db2 = open(file);
  const session = db2.authenticate('persist-user', 'mypass');
  assert.ok(session);
  assert.equal(session.role, 'user');
});

test('stats method', () => {
  const db = open(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'youdata-')), 'stats.ydb'));
  db.collection('a').set('k', { v: 1 });
  db.collection('b').set('k', { v: 2 });
  const s = db.stats();
  assert.ok(s.file);
  assert.ok(s.bytes > 0);
  assert.deepEqual(s.collections, { a: 1, b: 1 });
  assert.equal(s.accounts, 0);
  assert.ok(s.updatedAt);
});

test('HTTP Gateway CRUD', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'youdata-')), 'gateway.ydb');
  const db = open(file);
  db.createAccount('api', 'key', 'admin');
  const { token } = db.authenticate('api', 'key');

  const gw = db.gateway({ port: 0 });
  gw.start();
  await new Promise(r => gw.server.on('listening', r));
  const port = gw.server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  // health
  const health = await (await fetch(`${base}/health`)).json();
  assert.deepEqual(health, { ok: true });

  // PUT
  const putRes = await fetch(`${base}/collections/users/testuser`, { method: 'PUT', headers, body: JSON.stringify({ name: 'Test' }) });
  assert.deepEqual(await putRes.json(), { ok: true });

  // GET single
  const getRes = await fetch(`${base}/collections/users/testuser`, { headers });
  assert.deepEqual(await getRes.json(), { name: 'Test' });

  // POST (add)
  const postRes = await fetch(`${base}/collections/users`, { method: 'POST', headers, body: JSON.stringify({ id: 'newuser', name: 'New' }) });
  assert.deepEqual(await postRes.json(), { ok: true });

  // GET all
  const allRes = await fetch(`${base}/collections/users`, { headers });
  const all = await allRes.json();
  assert.equal(all.length, 2);

  // DELETE
  const delRes = await fetch(`${base}/collections/users/testuser`, { method: 'DELETE', headers });
  assert.deepEqual(await delRes.json(), { ok: true });

  // stats
  const stats = await (await fetch(`${base}/stats`, { headers })).json();
  assert.ok(stats.bytes > 0);

  // unauthorized
  const unauthRes = await fetch(`${base}/collections/users`);
  assert.equal(unauthRes.status, 401);

  gw.stop();
});

test('Gateway 404 and 405', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'youdata-')), 'gateway2.ydb');
  const db = open(file);
  db.createAccount('api', 'key', 'admin');
  const { token } = db.authenticate('api', 'key');
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  const gw = db.gateway({ port: 0 });
  gw.start();
  await new Promise(r => gw.server.on('listening', r));
  const port = gw.server.address().port;
  const base = `http://127.0.0.1:${port}`;

  // 404
  const r404 = await fetch(`${base}/nonexistent`, { headers });
  assert.equal(r404.status, 404);

  // 405 on unknown method
  const r405 = await fetch(`${base}/collections/users`, { method: 'PATCH', headers });
  assert.equal(r405.status, 405);

  gw.stop();
});

test('CLI init, stats, compact', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'youdata-')), 'cli-test.ydb');
  const db = open(file);
  db.collection('data').set('x', { val: 1 });
  db.close();

  // init (on existing)
  const cli = 'node src/cli.js';

  const initOut = execSync(`${cli} init ${file}`, { cwd: '/data/data/com.termux/files/home/youdata-test' });
  assert.ok(initOut.toString().includes('ok'));

  const statsOut = JSON.parse(execSync(`${cli} stats ${file}`, { cwd: '/data/data/com.termux/files/home/youdata-test' }));
  assert.equal(statsOut.collections.data, 1);

  const compactOut = JSON.parse(execSync(`${cli} compact ${file}`, { cwd: '/data/data/com.termux/files/home/youdata-test' }));
  assert.ok(compactOut.ok);

  const statsAfter = JSON.parse(execSync(`${cli} stats ${file}`, { cwd: '/data/data/com.termux/files/home/youdata-test' }));
  assert.equal(statsAfter.collections.data, 1);
});
