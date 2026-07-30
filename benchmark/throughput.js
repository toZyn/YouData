import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { open } from '../src/index.js';

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'youdata-bench-')), 'bench.ydb');
const db = open(file, { autosync: false, autoCheckpoint: false });
const collection = db.collection('bench');
const total = Number(process.env.OPS || 10000);
const start = process.hrtime.bigint();
for (let i = 0; i < total; i++) collection.set(String(i), { value: i });
const elapsed = Number(process.hrtime.bigint() - start) / 1e9;
process.stdout.write(JSON.stringify({ engine: 'youdata', operations: total, seconds: elapsed, opsPerSecond: total / elapsed }) + '\n');
db.close();
