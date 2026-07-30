import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { WAL, FileLock } from './wal.js';
import { Schema } from './schema.js';

const MAGIC = Buffer.from('YDATA02');
const VERSION = 2;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encode(value) {
  const body = Buffer.from(JSON.stringify(value));
  const out = Buffer.allocUnsafe(4 + body.length);
  out.writeUInt32BE(body.length, 0);
  body.copy(out, 4);
  return out;
}

function decode(buffer, offset) {
  if (offset + 4 > buffer.length) throw new Error('Corrupt database record');
  const size = buffer.readUInt32BE(offset);
  const start = offset + 4;
  const end = start + size;
  if (end > buffer.length) throw new Error('Corrupt database record');
  return { value: JSON.parse(decoder.decode(buffer.subarray(start, end))), next: end };
}

const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${key}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) {
    const expected = crypto.createHash('sha256').update(password).digest('hex');
    const actual = Buffer.from(stored || '', 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    if (actual.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(actual, expectedBuf);
  }
  const [salt, key] = stored.split(':');
  const derived = crypto.scryptSync(password, salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(derived), Buffer.from(key));
}

function stripProto(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj;
  const safe = {};
  for (const k of Object.keys(obj)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    safe[k] = obj[k];
  }
  return safe;
}

const COMPARE = {
  asc: (a, b) => a < b ? -1 : a > b ? 1 : 0,
  desc: (a, b) => a > b ? -1 : a < b ? 1 : 0,
};

export class Collection {
  constructor(db, name) {
    this.db = db;
    this.name = name;
    this._tx = null;
  }

  get size() { return this.db._collection(this.name).size; }

  get(key) {
    this.db.metrics.record('read');
    return clone(this.db._collection(this.name).get(String(key))?.value);
  }

  has(key) { return this.db._collection(this.name).has(String(key)); }

  set(key, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new TypeError('Value must be an object');
    const schema = this.db._schemas.get(this.name);
    if (schema) schema.validate(value);
    const sk = String(key);
    if (this._tx) {
      this._tx.records.push({ op: 'set', collection: this.name, key: sk, value });
      this._tx._apply({ op: 'set', collection: this.name, key: sk, value });
    } else {
      this.db._write({ op: 'set', collection: this.name, key: sk, value });
    }
    return this;
  }

  add(value, key = value.id ?? crypto.randomUUID()) { return this.set(key, value); }

  delete(key) {
    if (!this.has(key)) return false;
    const sk = String(key);
    if (this._tx) {
      this._tx.records.push({ op: 'delete', collection: this.name, key: sk });
      this._tx._apply({ op: 'delete', collection: this.name, key: sk });
    } else {
      this.db._write({ op: 'delete', collection: this.name, key: sk });
    }
    return true;
  }

  clear() { for (const key of this.keys()) this.delete(key); return this; }
  keys() { return [...this.db._collection(this.name).keys()]; }

  values() {
    return [...this.db._collection(this.name).values()].map(item => clone(item.value));
  }

  entries() {
    return [...this.db._collection(this.name)].map(([key, item]) => [key, clone(item.value)]);
  }

  _matchAll(items, query) {
    return query && Object.keys(query).length
      ? items.filter(item => matches(item, query))
      : items;
  }

  find(query = {}, opts = {}) {
    this.db.metrics.record('query');
    let items = this.values();
    if (query && Object.keys(query).length) {
      const idx = this.db._indexes.get(this.name);
      const indexedField = idx && Object.keys(query).find(f => idx.has(f));
      if (indexedField && typeof query[indexedField] === 'string') {
        const idxMap = idx.get(indexedField);
        const keys = idxMap.get(query[indexedField]);
        if (keys) {
          items = [...keys].map(k => this.get(k)).filter(Boolean);
          const rest = { ...query };
          delete rest[indexedField];
          if (Object.keys(rest).length) items = items.filter(item => matches(item, rest));
        } else {
          items = [];
        }
      } else {
        items = items.filter(item => matches(item, query));
      }
    }
    if (opts.sort) {
      const [field, dir] = Object.entries(opts.sort)[0];
      const cmp = COMPARE[dir] || COMPARE.asc;
      items.sort((a, b) => cmp(a[field], b[field]));
    }
    if (opts.skip) items = items.slice(opts.skip);
    if (opts.limit) items = items.slice(0, opts.limit);
    if (opts.fields) {
      items = items.map(item => {
        const proj = {};
        for (const f of opts.fields) if (f in item) proj[f] = item[f];
        return proj;
      });
    }
    return items;
  }

  first(query = {}, opts = {}) { return this.find(query, { ...opts, limit: 1 })[0]; }
  count(query = {}) { return this.find(query).length; }

  createIndex(field) {
    if (!field || typeof field !== 'string') throw new TypeError('Field name required');
    const idx = this.db._indexes.get(this.name) || new Map();
    if (idx.has(field)) return;
    idx.set(field, new Map());
    this.db._indexes.set(this.name, idx);
    for (const [key, item] of this.db._collection(this.name)) {
      const val = item.value[field];
      if (val !== undefined) {
        const sk = String(val);
        if (!idx.get(field).has(sk)) idx.get(field).set(sk, new Set());
        idx.get(field).get(sk).add(key);
      }
    }
    this.db._write({ op: 'index-create', collection: this.name, field });
  }

  dropIndex(field) {
    const idx = this.db._indexes.get(this.name);
    if (!idx || !idx.has(field)) return;
    idx.delete(field);
    if (idx.size === 0) this.db._indexes.delete(this.name);
    this.db._write({ op: 'index-drop', collection: this.name, field });
  }

  listIndexes() {
    const idx = this.db._indexes.get(this.name);
    return idx ? [...idx.keys()] : [];
  }
}

function matches(value, query = {}) {
  return Object.entries(query).every(([key, expected]) => {
    const actual = value?.[key];
    if (!expected || typeof expected !== 'object' || Array.isArray(expected)) return actual === expected;
    return Object.entries(expected).every(([op, operand]) => ({
      $gt: actual > operand, $gte: actual >= operand, $lt: actual < operand,
      $lte: actual <= operand, $ne: actual !== operand,
      $in: Array.isArray(operand) && operand.includes(actual),
      $regex: typeof operand === 'string' && typeof actual === 'string' && new RegExp(operand).test(actual),
      $exists: operand ? actual !== undefined : actual === undefined,
    })[op] ?? false);
  });
}

class Transaction {
  constructor(db) {
    this.db = db;
    this.records = [];
    this._snapshots = [];
    this.closed = false;
  }

  _apply(record) {
    const col = this.db._collection(record.collection);
    if (record.op === 'set') {
      const oldEntry = col.get(record.key);
      this._snapshots.push({ collection: record.collection, key: record.key, old: oldEntry ? { value: JSON.parse(JSON.stringify(oldEntry.value)), timestamp: oldEntry.timestamp } : null });
      this.db._apply(record);
    }
    if (record.op === 'delete') {
      const oldEntry = col.get(record.key);
      this._snapshots.push({ collection: record.collection, key: record.key, old: oldEntry ? { value: JSON.parse(JSON.stringify(oldEntry.value)), timestamp: oldEntry.timestamp } : null });
      this.db._apply(record);
    }
  }

  set(collection, key, value) {
    if (this.closed) throw new Error('Transaction is closed');
    const col = this.db.collection(collection);
    col._tx = this;
    try { col.set(key, value); } finally { col._tx = null; }
    return this;
  }

  delete(collection, key) {
    if (this.closed) throw new Error('Transaction is closed');
    const col = this.db.collection(collection);
    col._tx = this;
    try { col.delete(key); } finally { col._tx = null; }
    return this;
  }

  commit() {
    if (this.closed) throw new Error('Transaction is closed');
    this.closed = true;
    if (this.records.length === 0) return;
    this.db._persistBatch(this.records);
  }

  rollback() {
    if (this.closed) throw new Error('Transaction is closed');
    this.closed = true;
    for (const snap of this._snapshots.reverse()) {
      const col = this.db._collection(snap.collection);
      const current = col.get(snap.key);
      if (snap.old) { col.set(snap.key, snap.old); this.db._updateIndexes(snap.collection, snap.key, snap.old.value, current?.value); }
      else { col.delete(snap.key); this.db._updateIndexes(snap.collection, snap.key, null, current?.value); }
    }
  }
}

class MetricsCollector {
  constructor() {
    this.reset();
  }

  reset() {
    this.ops = { read: 0, write: 0, delete: 0, query: 0, transaction: 0, auth: 0, gateway: 0 };
    this.startTime = Date.now();
    this.lastCheckpoint = Date.now();
  }

  record(op) {
    this.ops[op] = (this.ops[op] || 0) + 1;
  }

  snapshot() {
    return {
      uptime: Date.now() - this.startTime,
      operations: { ...this.ops },
      timeSinceLastCheckpoint: Date.now() - this.lastCheckpoint,
    };
  }
}

export class YouData {
  constructor(file, options = {}) {
    this.file = path.resolve(file);
    this.options = {
      autosync: true, tokenTTL: 86_400_000, rateLimitMax: 10,
      rateLimitWindow: 60_000, maxNameLength: 100, maxBodySize: 10_485_760,
      maxWalSize: 10_485_760, autoCheckpoint: true,
      ...options
    };
    this.collections = new Map();
    this._indexes = new Map();
    this._schemas = new Map();
    this.meta = { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: VERSION };
    this.accounts = new Map();
    this.sessions = new Map();
    this._rateLimits = new Map();
    this._walRecords = [];
    this._writeCount = 0;
    this.metrics = new MetricsCollector();
    this.lock = new FileLock(this.file);
    if (!this.lock.acquire()) throw new Error(`Cannot acquire lock on ${this.file}. Another process may be using it.`);
    this.wal = new WAL(this.file);
    try { this._open(); } catch (error) { this.lock.release(); throw error; }
  }

  _open() {
    if (!fs.existsSync(this.file)) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const init = Buffer.concat([MAGIC, Buffer.from([VERSION]), encode({ op: 'meta', meta: this.meta })]);
      fs.writeFileSync(this.file, init);
      fs.fdatasyncSync(fs.openSync(this.file, fs.constants.O_RDONLY));
      this.wal.open();
      return;
    }
    const staleWal = fs.existsSync(this.wal.path);
    const buffer = fs.readFileSync(this.file);
    const hdr = buffer.subarray(0, MAGIC.length);
    if (hdr.compare(MAGIC) !== 0 || buffer[MAGIC.length] < 1)
      throw new Error('Invalid YouData file');
    let offset = MAGIC.length + 1;
    while (offset < buffer.length) {
      const record = decode(buffer, offset);
      this._apply(record.value);
      offset = record.next;
    }
    if (staleWal) {
      this.wal.open();
      const walRecords = this.wal.readAll();
      for (const r of walRecords) this._apply(r);
      this._walRecords = walRecords;
      this._writeCount = walRecords.length;
      if (this.options.autoCheckpoint) this.checkpoint();
    } else {
      this.wal.open();
    }
  }

  _apply(record) {
    if (record.op === 'meta') { this.meta = record.meta; return; }
    if (record.op === 'set') {
      const collection = this._collection(record.collection);
      const old = collection.get(record.key);
      collection.set(record.key, { value: record.value, timestamp: Date.now() });
      this._updateIndexes(record.collection, record.key, record.value, old?.value);
      return;
    }
    if (record.op === 'delete') {
      const col = this._collection(record.collection);
      const old = col.get(record.key);
      col.delete(record.key);
      if (old) this._updateIndexes(record.collection, record.key, null, old.value);
      return;
    }
    if (record.op === 'account') this.accounts.set(record.username, record.account);
    if (record.op === 'account-delete') this.accounts.delete(record.username);
    if (record.op === 'schema') {
      this._schemas.set(record.collection, new Schema(record.fields));
    }
    if (record.op === 'schema-delete') this._schemas.delete(record.collection);
    if (record.op === 'index-create') {
      const idx = this._indexes.get(record.collection) || new Map();
      if (!idx.has(record.field)) idx.set(record.field, new Map());
      this._indexes.set(record.collection, idx);
    }
    if (record.op === 'index-drop') {
      const idx = this._indexes.get(record.collection);
      if (idx) { idx.delete(record.field); if (idx.size === 0) this._indexes.delete(record.collection); }
    }
  }

  _updateIndexes(collection, key, newVal, oldVal) {
    const idx = this._indexes.get(collection);
    if (!idx) return;
    for (const [field, idxMap] of idx) {
      if (oldVal && oldVal[field] !== undefined) {
        const sk = String(oldVal[field]);
        if (idxMap.has(sk)) { idxMap.get(sk).delete(key); if (idxMap.get(sk).size === 0) idxMap.delete(sk); }
      }
      if (newVal && newVal[field] !== undefined) {
        const sk = String(newVal[field]);
        if (!idxMap.has(sk)) idxMap.set(sk, new Set());
        idxMap.get(sk).add(key);
      }
    }
  }

  _collection(name) {
    if (!this.collections.has(name)) this.collections.set(name, new Map());
    return this.collections.get(name);
  }

  collection(name) {
    if (!name || typeof name !== 'string') throw new TypeError('Collection name is required');
    return new Collection(this, name);
  }

  _write(record) {
    const body = encode(record);
    this.wal.append(body);
    this._walRecords.push(record);
    this._writeCount++;
    this._apply(record);
    this.meta.updatedAt = new Date().toISOString();
    this.metrics.record(record.op === 'delete' ? 'delete' : 'write');
    if (this.options.autoCheckpoint && this.wal.size() > this.options.maxWalSize) {
      this.checkpoint();
    }
  }

  _persistBatch(records) {
    const buffers = records.map(r => encode(r));
    this.wal.appendBatch(buffers);
    this._walRecords.push(...records);
    this._writeCount += records.length;
    for (const record of records) this._apply(record);
    this.meta.updatedAt = new Date().toISOString();
    this.metrics.record('transaction');
    if (this.options.autoCheckpoint && this.wal.size() > this.options.maxWalSize) {
      this.checkpoint();
    }
  }

  begin() { return new Transaction(this); }

  checkpoint() {
    const records = [{ op: 'meta', meta: this.meta }];
    for (const [collection, items] of this.collections) {
      for (const [key, item] of items) {
        records.push({ op: 'set', collection, key, value: item.value });
      }
    }
    for (const [username, account] of this.accounts) {
      records.push({ op: 'account', username, account });
    }
    for (const [collection, schema] of this._schemas) {
      records.push({ op: 'schema', collection, fields: schema.fields });
    }
    for (const [collection, idxFields] of this._indexes) {
      for (const field of idxFields.keys()) {
        records.push({ op: 'index-create', collection, field });
      }
    }
    const temp = `${this.file}.${crypto.randomUUID()}.ckpt`;
    try {
      fs.writeFileSync(temp, Buffer.concat([MAGIC, Buffer.from([VERSION]), ...records.map(encode)]));
      fs.fdatasyncSync(fs.openSync(temp, fs.constants.O_RDONLY));
      fs.renameSync(temp, this.file);
      this.wal.clear();
      this._walRecords = [];
      this._writeCount = 0;
      this.metrics.lastCheckpoint = Date.now();
    } catch (e) {
      try { fs.unlinkSync(temp); } catch {}
      throw e;
    }
  }

  backup(dest) {
    this.checkpoint();
    const destPath = path.resolve(dest);
    fs.copyFileSync(this.file, destPath);
    fs.fdatasyncSync(fs.openSync(destPath, fs.constants.O_RDONLY));
    return { file: destPath, bytes: fs.statSync(destPath).size };
  }

  setSchema(collection, schema) {
    if (schema === null || schema === undefined) {
      this._schemas.delete(collection);
      this._write({ op: 'schema-delete', collection });
      return;
    }
    const normalized = schema instanceof Schema ? schema : new Schema(schema);
    this._schemas.set(collection, normalized);
    this._write({ op: 'schema', collection, fields: normalized.fields });
  }

  getSchema(collection) { return this._schemas.get(collection) || null; }

  createAccount(username, password, role = 'user') {
    if (!username || !password) throw new Error('Username and password are required');
    if (typeof username !== 'string' || typeof password !== 'string')
      throw new TypeError('Username and password must be strings');
    if (username.length > this.options.maxNameLength)
      throw new Error(`Username exceeds max length of ${this.options.maxNameLength}`);
    if (password.length > this.options.maxNameLength)
      throw new Error(`Password exceeds max length of ${this.options.maxNameLength}`);
    if (this.accounts.has(username)) throw new Error('Account already exists');
    const account = { username, role, password: hashPassword(password), createdAt: new Date().toISOString() };
    this._write({ op: 'account', username, account });
    return { username, role, createdAt: account.createdAt };
  }

  _checkRateLimit(username) {
    const now = Date.now();
    const entry = this._rateLimits.get(username);
    if (!entry || now > entry.resetAt) {
      this._rateLimits.set(username, { count: 1, resetAt: now + this.options.rateLimitWindow });
      return true;
    }
    if (entry.count >= this.options.rateLimitMax) return false;
    entry.count++;
    return true;
  }

  _cleanRateLimits() {
    const now = Date.now();
    for (const [key, entry] of this._rateLimits) {
      if (now > entry.resetAt) this._rateLimits.delete(key);
    }
  }

  authenticate(username, password) {
    this.metrics.record('auth');
    if (!this._checkRateLimit(username)) return null;
    const account = this.accounts.get(username);
    if (!account || !verifyPassword(password, account.password)) return null;
    this._rateLimits.delete(username);
    if (!account.password.includes(':')) {
      account.password = hashPassword(password);
      this._write({ op: 'account', username, account });
    }
    const token = crypto.randomBytes(32).toString('hex');
    this.sessions.set(token, { username, role: account.role, createdAt: Date.now() });
    return { token, username, role: account.role };
  }

  revoke(token) { return this.sessions.delete(token); }

  authorize(token, role) {
    const session = this.sessions.get(token);
    if (!session) return null;
    const ttl = this.options.tokenTTL;
    if (ttl >= 0 && Number.isFinite(ttl) && Date.now() - session.createdAt >= ttl) {
      this.sessions.delete(token);
      return null;
    }
    if (role && session.role !== role && session.role !== 'admin') return null;
    return session;
  }

  compact() {
    this.checkpoint();
    return fs.statSync(this.file).size;
  }

  stats() {
    return {
      file: this.file,
      bytes: fs.statSync(this.file).size,
      walBytes: this.wal.size(),
      collections: Object.fromEntries([...this.collections].map(([name, items]) => [name, items.size])),
      indexes: Object.fromEntries([...this._indexes].map(([name, idx]) => [name, [...idx.keys()]])),
      schemas: [...this._schemas.keys()],
      accounts: this.accounts.size,
      sessions: this.sessions.size,
      updatedAt: this.meta.updatedAt,
      version: this.meta.version,
    };
  }

  metricsSnapshot() { return this.metrics.snapshot(); }

  close() {
    if (this.options.autoCheckpoint) {
      try { this.checkpoint(); } catch {}
    }
    this.sessions.clear();
    this._rateLimits.clear();
    this.wal.close();
    this.lock.release();
  }

  gateway(options = {}) { return new Gateway(this, options); }
}

export class Gateway {
  constructor(db, options = {}) {
    this.db = db;
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 6380;
    this.server = null;
    this.key = options.key || null;
    this.cert = options.cert || null;
    this.resp = options.resp || false;
  }

  start() {
    if (this.server) return this;
    if (this.resp) return this._startResp();

    const handler = async (request, response) => {
      try {
        const url = new URL(request.url, `http://${request.headers.host}`);
        const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
        if (url.pathname === '/health') return this._send(response, 200, { ok: true });
        if (url.pathname === '/metrics')
          return this._send(response, 200, this.db.metricsSnapshot());
        if (!this.db.authorize(token)) return this._send(response, 401, { error: 'Unauthorized' });
        if (request.method === 'GET' && url.pathname === '/stats')
          return this._send(response, 200, this.db.stats());
        const match = url.pathname.match(/^\/collections\/([^/]+)(?:\/([^/]+))?$/);
        if (!match) return this._send(response, 404, { error: 'Not found' });
        if (request.method === 'HEAD') return this._send(response, 200, null);
        const cName = decodeURIComponent(match[1]);
        const cKey = match[2] ? decodeURIComponent(match[2]) : null;
        const collection = this.db.collection(cName);
        if (request.method === 'GET' && cKey) return this._send(response, 200, collection.get(cKey) ?? null);
        if (request.method === 'GET') {
          const query = url.searchParams.get('query') ? JSON.parse(url.searchParams.get('query')) : {};
          const opts = {};
          if (url.searchParams.get('sort')) opts.sort = JSON.parse(url.searchParams.get('sort'));
          if (url.searchParams.get('limit')) opts.limit = parseInt(url.searchParams.get('limit'), 10);
          if (url.searchParams.get('skip')) opts.skip = parseInt(url.searchParams.get('skip'), 10);
          if (url.searchParams.get('fields')) opts.fields = url.searchParams.get('fields').split(',');
          return this._send(response, 200, collection.find(query, opts));
        }
        const body = await this._body(request);
        if (request.method === 'PUT' && cKey) collection.set(cKey, body);
        else if (request.method === 'POST') collection.add(body, body.id);
        else if (request.method === 'DELETE' && cKey) collection.delete(cKey);
        else return this._send(response, 405, { error: 'Method not allowed' });
        return this._send(response, 200, { ok: true });
      } catch (error) {
        return this._send(response, 400, { error: error.message });
      }
    };

    const proto = this.key && this.cert ? https : http;
    const opts = this.key && this.cert ? { key: this.key, cert: this.cert } : {};
    this.server = proto.createServer(opts, handler);
    this.server.listen(this.port, this.host);
    return this;
  }

  _startResp() {
    const handler = (socket) => {
      let buf = '';
      socket.on('data', chunk => {
        buf += chunk.toString();
        while (buf.includes('\r\n')) {
          const idx = buf.indexOf('\r\n');
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 2);
          if (!line) continue;
          const parts = line.split(' ');
          const cmd = parts[0]?.toUpperCase();
          try {
            if (cmd === 'PING') { socket.write('+PONG\r\n'); continue; }
            if (!this.db.authorize(parts[1])) { socket.write('-ERR unauthorized\r\n'); continue; }
            if (cmd === 'GET' && parts[2] && parts[3]) {
              const val = this.db.collection(parts[2]).get(parts[3]);
              socket.write(`$${val ? Buffer.byteLength(JSON.stringify(val)) : -1}\r\n`);
              if (val) socket.write(`${JSON.stringify(val)}\r\n`);
            } else if (cmd === 'SET' && parts[2] && parts[3] && parts[4]) {
              this.db.collection(parts[2]).set(parts[3], JSON.parse(parts.slice(4).join(' ')));
              socket.write('+OK\r\n');
            } else if (cmd === 'DEL' && parts[2] && parts[3]) {
              this.db.collection(parts[2]).delete(parts[3]);
              socket.write(':1\r\n');
            } else if (cmd === 'KEYS' && parts[2]) {
              const keys = this.db.collection(parts[2]).keys();
              socket.write(`*${keys.length}\r\n`);
              for (const k of keys) socket.write(`$${Buffer.byteLength(k)}\r\n${k}\r\n`);
            } else if (cmd === 'STATS') {
              const s = this.db.stats();
              socket.write(`*${Object.keys(s).length}\r\n`);
              for (const [k, v] of Object.entries(s)) {
                const str = `${k}:${JSON.stringify(v)}`;
                socket.write(`$${Buffer.byteLength(str)}\r\n${str}\r\n`);
              }
            } else {
              socket.write('-ERR unknown command\r\n');
            }
          } catch (e) { socket.write(`-ERR ${e.message}\r\n`); }
        }
      });
    };
    this.server = net.createServer(handler);
    this.server.listen(this.port, this.host);
    return this;
  }

  _send(response, status, value) {
    const body = value === null ? '' : JSON.stringify(value);
    response.writeHead(status, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    });
    response.end(body);
  }

  _body(request) {
    return new Promise((resolve, reject) => {
      const maxSize = this.db.options.maxBodySize;
      let body = '';
      let exceeded = false;
      request.on('data', chunk => {
        if (exceeded) return;
        if (body.length + chunk.length > maxSize) { exceeded = true; body = ''; return; }
        body += chunk;
      });
      request.on('end', () => {
        if (exceeded) return reject(new Error(`Body exceeds max size of ${maxSize} bytes`));
        resolve(body ? stripProto(JSON.parse(body)) : {});
      });
      request.on('error', reject);
    });
  }

  stop() {
    return new Promise(resolve => this.server ? this.server.close(resolve) : resolve());
  }
}

export function open(file = './youdata.ydb', options) {
  return new YouData(file, options);
}
