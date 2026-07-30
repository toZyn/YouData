import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { open, YouData } from '../src/index.js';
import { Schema } from '../src/schema.js';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'youdata-enterprise-'));

test('WAL crash safety', () => {
  const file = path.join(TMP, 'wal-test.ydb');
  const db = open(file);
  db.collection('t').set('k', { v: 1 });
  const walExists = fs.existsSync(db.wal.path);
  assert.ok(walExists);
  assert.ok(db.wal.size() > 0);
  db.close();
});

test('WAL recovery on reopen', () => {
  const file = path.join(TMP, 'wal-recovery.ydb');
  const db = open(file);
  db.collection('t').set('a', { x: 1 });
  db.collection('t').set('b', { x: 2 });
  // Don't close - simulate crash by not checkpointing
  const data = db.collection('t').get('a');
  const walPath = db.wal.path;
  const walSize = db.wal.size();
  // Close without checkpoint
  db.wal.close();
  db.lock.release();

  // Reopen - should replay WAL
  const db2 = open(file);
  assert.deepEqual(db2.collection('t').get('a'), { x: 1 });
  assert.deepEqual(db2.collection('t').get('b'), { x: 2 });
  assert.equal(db2.collection('t').size, 2);
  db2.close();
});

test('transactions', () => {
  const file = path.join(TMP, 'tx-test.ydb');
  const db = open(file);
  const tx = db.begin();
  tx.set('users', '1', { name: 'Alice' });
  tx.set('users', '2', { name: 'Bob' });
  tx.delete('users', '1');
  tx.commit();
  assert.equal(db.collection('users').size, 1);
  assert.deepEqual(db.collection('users').get('2'), { name: 'Bob' });
  assert.equal(db.collection('users').get('1'), undefined);
  db.close();
});

test('transaction rollback', () => {
  const file = path.join(TMP, 'tx-rollback.ydb');
  const db = open(file);
  db.collection('t').set('k', { v: 1 });
  const tx = db.begin();
  tx.set('t', 'k', { v: 999 });
  tx.rollback();
  assert.deepEqual(db.collection('t').get('k'), { v: 1 });
  db.close();
});

test('checkpoint flushes WAL', () => {
  const file = path.join(TMP, 'ckpt.ydb');
  const db = open(file);
  db.collection('t').set('k', { v: 1 });
  assert.ok(db.wal.size() > 0);
  db.checkpoint();
  assert.equal(db.wal.size(), 0);
  db.close();
});

test('backup creates consistent snapshot', () => {
  const file = path.join(TMP, 'backup-src.ydb');
  const db = open(file);
  db.collection('t').set('k', { v: 42 });
  const backupFile = path.join(TMP, 'backup-dest.ydb');
  const result = db.backup(backupFile);
  assert.ok(result.bytes > 0);
  db.close();

  const db2 = open(backupFile);
  assert.deepEqual(db2.collection('t').get('k'), { v: 42 });
  db2.close();
});

test('sorted queries', () => {
  const file = path.join(TMP, 'sort.ydb');
  const db = open(file);
  const c = db.collection('scores');
  c.set('a', { name: 'Alice', score: 30 });
  c.set('b', { name: 'Bob', score: 10 });
  c.set('c', { name: 'Charlie', score: 20 });

  const asc = c.find({}, { sort: { score: 'asc' } });
  assert.equal(asc[0].name, 'Bob');
  assert.equal(asc[2].name, 'Alice');

  const desc = c.find({}, { sort: { score: 'desc' } });
  assert.equal(desc[0].name, 'Alice');
  assert.equal(desc[2].name, 'Bob');

  const limit2 = c.find({}, { sort: { score: 'asc' }, limit: 2 });
  assert.equal(limit2.length, 2);

  const skip1 = c.find({}, { sort: { score: 'asc' }, skip: 1 });
  assert.equal(skip1.length, 2);
  assert.equal(skip1[0].name, 'Charlie');

  db.close();
});

test('projection (field selection)', () => {
  const file = path.join(TMP, 'project.ydb');
  const db = open(file);
  db.collection('t').set('k', { a: 1, b: 2, c: 3 });
  const res = db.collection('t').find({}, { fields: ['a', 'c'] });
  assert.deepEqual(res[0], { a: 1, c: 3 });
  db.close();
});

test('schema validation', () => {
  const file = path.join(TMP, 'schema.ydb');
  const db = open(file);
  const schema = new Schema({
    name: 'string',
    age: { type: 'integer', required: true },
    email: { type: 'email', required: true },
  });
  db.setSchema('users', schema);

  db.collection('users').set('1', { name: 'Alice', age: 30, email: 'alice@test.com' });
  assert.ok(true);

  assert.throws(() => {
    db.collection('users').set('2', { name: 'Bob', age: 'not-a-number', email: 'bob@test.com' });
  }, /must be of type/);

  assert.throws(() => {
    db.collection('users').set('3', { name: 'Charlie', age: 25 });
  }, /email.*required/);

  assert.throws(() => {
    db.collection('users').set('4', { name: 'Dave', age: 35, email: 'not-an-email' });
  }, /must be of type/);

  db.close();
});

test('schema persists across restart', () => {
  const file = path.join(TMP, 'schema-persist.ydb');
  const db = open(file);
  db.setSchema('items', new Schema({ title: 'string' }));
  db.close();

  const db2 = open(file);
  const s = db2.getSchema('items');
  assert.ok(s instanceof Schema);
  assert.ok(s.fields.title);
  db2.close();
});

test('index creation and indexed query', () => {
  const file = path.join(TMP, 'index.ydb');
  const db = open(file);
  const c = db.collection('people');
  c.set('1', { name: 'Alice', age: 30 });
  c.set('2', { name: 'Bob', age: 25 });
  c.set('3', { name: 'Charlie', age: 30 });

  c.createIndex('age');
  assert.deepEqual(c.listIndexes(), ['age']);

  const found = c.find({ age: 30 });
  assert.equal(found.length, 2);

  c.dropIndex('age');
  assert.deepEqual(c.listIndexes(), []);

  db.close();
});

test('file locking prevents multi-process', () => {
  const file = path.join(TMP, 'lock-test.ydb');
  const db = open(file);
  assert.throws(() => open(file), /Cannot acquire lock/);
  db.close();
  // Now should work
  const db2 = open(file);
  db2.close();
});

test('metrics collector', () => {
  const file = path.join(TMP, 'metrics.ydb');
  const db = open(file);
  db.collection('t').get('x');
  db.collection('t').set('x', { v: 1 });
  db.collection('t').delete('x');
  db.collection('t').find({});
  db.authenticate('nonexistent', 'x');

  const m = db.metricsSnapshot();
  assert.ok(m.uptime >= 0);
  assert.ok(m.operations.read >= 1);
  assert.ok(m.operations.write >= 1);
  assert.ok(m.operations.delete >= 1);
  assert.ok(m.operations.query >= 1);
  assert.ok(m.operations.auth >= 1);
  db.close();
});

test('auto-checkpoint on large WAL', () => {
  const file = path.join(TMP, 'auto-ckpt.ydb');
  const db = open(file, { maxWalSize: 1, autoCheckpoint: true });
  // With maxWalSize=1, every write triggers checkpoint
  db.collection('t').set('a', { data: 'x' });
  db.collection('t').set('b', { data: 'y' });
  // WAL should be empty after checkpoint
  assert.equal(db.wal.size(), 0);
  db.close();
});

test('gateway query params (sort/limit/skip)', async () => {
  const file = path.join(TMP, 'gw-query.ydb');
  const db = open(file);
  db.createAccount('api', 'key', 'admin');
  const { token } = db.authenticate('api', 'key');
  const c = db.collection('items');
  c.set('a', { name: 'Alpha', val: 3 });
  c.set('b', { name: 'Beta', val: 1 });
  c.set('c', { name: 'Gamma', val: 2 });

  const gw = db.gateway({ port: 0 });
  gw.start();
  await new Promise(r => gw.server.on('listening', r));
  const port = gw.server.address().port;
  const headers = { authorization: `Bearer ${token}` };

  const res = await fetch(`http://127.0.0.1:${port}/collections/items?sort=${encodeURIComponent('{"val":"asc"}')}&limit=2`, { headers });
  const data = await res.json();
  assert.equal(data.length, 2);
  assert.equal(data[0].name, 'Beta');
  assert.equal(data[1].name, 'Gamma');
  gw.stop();
  db.close();
});

test('RESP protocol', async () => {
  const file = path.join(TMP, 'resp.ydb');
  const db = open(file);
  db.createAccount('admin', 'pass', 'admin');
  const { token } = db.authenticate('admin', 'pass');

  const gw = db.gateway({ port: 0, resp: true });
  gw.start();
  await new Promise(r => gw.server.on('listening', r));
  const port = gw.server.address().port;
  const net = await import('node:net');

  function resp(cmd) {
    return new Promise((resolve, reject) => {
      const sock = new net.Socket();
      sock.connect(port, '127.0.0.1', () => sock.write(cmd + '\r\n'));
      let data = '';
      sock.on('data', d => { data += d.toString(); sock.end(); });
      sock.on('end', () => resolve(data));
      sock.on('error', reject);
    });
  }

  const pong = await resp('PING');
  assert.match(pong, /\+PONG/);

  const setRes = await resp(`SET ${token} test mykey {"value":42}`);
  assert.match(setRes, /\+OK/);

  const getRes = await resp(`GET ${token} test mykey`);
  assert.match(getRes, /\{"value":42\}/);

  gw.stop();
  db.close();
});

test('schema with default values', () => {
  const file = path.join(TMP, 'schema-defaults.ydb');
  const db = open(file);
  const schema = new Schema({
    name: 'string',
    role: { type: 'string', default: 'user' },
    active: { type: 'boolean', default: true },
  });
  db.setSchema('accounts', schema);
  db.collection('accounts').set('1', { name: 'Test' });
  const val = db.collection('accounts').get('1');
  assert.equal(val.role, 'user');
  assert.equal(val.active, true);
  db.close();
});

test('$regex and $exists operators', () => {
  const file = path.join(TMP, 'regex.ydb');
  const db = open(file);
  const c = db.collection('t');
  c.set('1', { name: 'Alice', email: 'alice@a.com' });
  c.set('2', { name: 'Bob', email: 'bob@b.com' });
  c.set('3', { name: 'Charlie' });

  const matching = c.find({ email: { $regex: '.*@a\\.com' } });
  assert.equal(matching.length, 1);
  assert.equal(matching[0].name, 'Alice');

  const hasEmail = c.find({ email: { $exists: true } });
  assert.equal(hasEmail.length, 2);

  const noEmail = c.find({ email: { $exists: false } });
  assert.equal(noEmail.length, 1);

  db.close();
});
