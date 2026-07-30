import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WAL } from '../src/wal.js';

test('WAL recovers complete records and ignores an incomplete tail', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'youdata-wal-'));
  const file = path.join(dir, 'db.ydb');
  const wal = new WAL(file).open();
  wal.append(Buffer.from(JSON.stringify({ op: 'set', key: 'a' })));
  wal.close();
  fs.appendFileSync(`${file}.wal`, Buffer.from([0, 0, 0, 20, 1]));
  assert.deepEqual(new WAL(file).readAll(), [{ op: 'set', key: 'a' }]);
});

test('WAL v2 reads legacy encode payloads inside frames', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'youdata-wal-'));
  const file = path.join(dir, 'db.ydb');
  const value = Buffer.from(JSON.stringify({ op: 'set', key: 'a' }));
  const encoded = Buffer.alloc(4 + value.length);
  encoded.writeUInt32BE(value.length, 0);
  value.copy(encoded, 4);
  const wal = new WAL(file).open();
  wal.append(encoded);
  wal.close();
  assert.deepEqual(new WAL(file).readAll(), [{ op: 'set', key: 'a' }]);
});

test('WAL rejects a checksum mismatch', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'youdata-wal-'));
  const file = path.join(dir, 'db.ydb');
  const wal = new WAL(file).open();
  wal.append(Buffer.from(JSON.stringify({ op: 'set', key: 'a' })));
  wal.close();
  const walFile = `${file}.wal`;
  const bytes = fs.readFileSync(walFile);
  bytes[bytes.length - 1] ^= 1;
  fs.writeFileSync(walFile, bytes);
  assert.throws(() => new WAL(file).readAll(), /checksum/i);
});
