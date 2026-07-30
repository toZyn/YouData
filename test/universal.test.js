import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { open } from '../src/index.js';

test('supports JSON scalar values and atomic counters', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'youdata-')), 'data.ydb');
  const db = open(file);
  const values = db.collection('values');
  values.set('string', 'hello');
  values.set('number', 2);
  values.set('boolean', true);
  assert.equal(values.get('string'), 'hello');
  assert.equal(values.incr('number', 3), 5);
  assert.equal(values.get('boolean'), true);
  assert.equal(values.setnx('string', 'changed'), false);
  assert.equal(values.setnx('new', 'value'), true);
  db.close();
});

test('supports TTL and batch reads', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'youdata-')), 'data.ydb');
  const db = open(file);
  const values = db.collection('values');
  values.setWithTTL('temporary', { ok: true }, 60_000);
  values.set('permanent', { ok: true });
  assert.equal(values.mget(['temporary', 'permanent']).length, 2);
  assert.equal(values.ttl('temporary') > 0, true);
  db.close();
});
