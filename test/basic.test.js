import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { open } from '../src/index.js';

test('persists collections and compacts', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'youdata-')), 'main.ydb');
  const db = open(file);
  db.collection('users').set('1', { name: 'Maycol', score: 10 });
  db.collection('users').set('2', { name: 'Ana', score: 20 });
  db.collection('users').delete('1');
  assert.equal(db.collection('users').count({ score: { $gte: 20 } }), 1);
  db.compact();
  db.close();
  const restored = open(file);
  assert.equal(restored.collection('users').get('1'), undefined);
  assert.equal(restored.collection('users').get('2').name, 'Ana');
});

test('authenticates accounts', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'youdata-')), 'main.ydb');
  const db = open(file);
  db.createAccount('admin', 'secret', 'admin');
  const session = db.authenticate('admin', 'secret');
  assert.equal(session.role, 'admin');
  assert.equal(db.authorize(session.token).username, 'admin');
  assert.equal(db.authenticate('admin', 'wrong'), null);
});
