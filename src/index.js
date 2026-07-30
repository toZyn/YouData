import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';

const MAGIC = Buffer.from('YDATA01');
const VERSION = 1;
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
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function matches(value, query = {}) {
  return Object.entries(query).every(([key, expected]) => {
    const actual = value?.[key];
    if (!expected || typeof expected !== 'object' || Array.isArray(expected)) return actual === expected;
    return Object.entries(expected).every(([op, operand]) => ({
      $gt: actual > operand, $gte: actual >= operand, $lt: actual < operand,
      $lte: actual <= operand, $ne: actual !== operand,
      $in: Array.isArray(operand) && operand.includes(actual)
    })[op] ?? false);
  });
}

class Collection {
  constructor(db, name) { this.db = db; this.name = name; }
  get size() { return this.db._collection(this.name).size; }
  get(key) { return clone(this.db._collection(this.name).get(String(key))?.value); }
  has(key) { return this.db._collection(this.name).has(String(key)); }
  set(key, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Value must be an object');
    this.db._write({ op: 'set', collection: this.name, key: String(key), value });
    return this;
  }
  add(value, key = value.id ?? crypto.randomUUID()) { return this.set(key, value); }
  delete(key) { if (!this.has(key)) return false; this.db._write({ op: 'delete', collection: this.name, key: String(key) }); return true; }
  clear() { for (const key of this.keys()) this.delete(key); return this; }
  keys() { return [...this.db._collection(this.name).keys()]; }
  values() { return [...this.db._collection(this.name).values()].map(item => clone(item.value)); }
  entries() { return [...this.db._collection(this.name)].map(([key, item]) => [key, clone(item.value)]); }
  find(query = {}) { return this.values().filter(item => matches(item, query)); }
  first(query = {}) { return this.find(query)[0]; }
  count(query = {}) { return this.find(query).length; }
}

export class YouData {
  constructor(file, options = {}) {
    this.file = path.resolve(file);
    this.options = { autosync: true, ...options };
    this.collections = new Map();
    this.meta = { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    this.accounts = new Map();
    this.sessions = new Map();
    this._open();
  }
  _open() {
    if (!fs.existsSync(this.file)) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, Buffer.concat([MAGIC, Buffer.from([VERSION]), encode({ op: 'meta', meta: this.meta })]));
      return;
    }
    const buffer = fs.readFileSync(this.file);
    if (buffer.subarray(0, MAGIC.length).compare(MAGIC) !== 0 || buffer[MAGIC.length] !== VERSION) throw new Error('Invalid YouData file');
    let offset = MAGIC.length + 1;
    while (offset < buffer.length) { const record = decode(buffer, offset); this._apply(record.value); offset = record.next; }
  }
  _apply(record) {
    if (record.op === 'meta') this.meta = record.meta;
    if (record.op === 'set') this._collection(record.collection).set(record.key, { value: record.value, timestamp: Date.now() });
    if (record.op === 'delete') this._collection(record.collection).delete(record.key);
    if (record.op === 'account') this.accounts.set(record.username, record.account);
    if (record.op === 'account-delete') this.accounts.delete(record.username);
  }
  _collection(name) { if (!this.collections.has(name)) this.collections.set(name, new Map()); return this.collections.get(name); }
  collection(name) { if (!name || typeof name !== 'string') throw new TypeError('Collection name is required'); return new Collection(this, name); }
  _write(record) {
    const body = encode(record);
    if (record.op === 'set') this._collection(record.collection).set(record.key, { value: record.value, timestamp: Date.now() });
    if (record.op === 'delete') this._collection(record.collection).delete(record.key);
    if (record.op === 'account') this.accounts.set(record.username, record.account);
    if (record.op === 'account-delete') this.accounts.delete(record.username);
    this.meta.updatedAt = new Date().toISOString();
    fs.appendFileSync(this.file, body);
  }
  createAccount(username, password, role = 'user') {
    if (!username || !password) throw new Error('Username and password are required');
    if (this.accounts.has(username)) throw new Error('Account already exists');
    const account = { username, role, password: hash(password), createdAt: new Date().toISOString() };
    this._write({ op: 'account', username, account });
    return { username, role, createdAt: account.createdAt };
  }
  authenticate(username, password) {
    const account = this.accounts.get(username);
    if (!account || account.password !== hash(password)) return null;
    const token = crypto.randomBytes(32).toString('hex');
    this.sessions.set(token, { username, role: account.role, createdAt: Date.now() });
    return { token, username, role: account.role };
  }
  authorize(token, role) {
    const session = this.sessions.get(token);
    if (!session || (role && session.role !== role && session.role !== 'admin')) return null;
    return session;
  }
  compact() {
    const temp = `${this.file}.${process.pid}.compact`;
    const records = [{ op: 'meta', meta: this.meta }];
    for (const [collection, items] of this.collections) for (const [key, item] of items) records.push({ op: 'set', collection, key, value: item.value });
    for (const [username, account] of this.accounts) records.push({ op: 'account', username, account });
    fs.writeFileSync(temp, Buffer.concat([MAGIC, Buffer.from([VERSION]), ...records.map(encode)]));
    fs.renameSync(temp, this.file);
    return fs.statSync(this.file).size;
  }
  stats() { return { file: this.file, bytes: fs.statSync(this.file).size, collections: Object.fromEntries([...this.collections].map(([name, items]) => [name, items.size])), accounts: this.accounts.size, updatedAt: this.meta.updatedAt }; }
  close() { this.sessions.clear(); }
  gateway(options = {}) { return new Gateway(this, options); }
}

export class Gateway {
  constructor(db, options = {}) { this.db = db; this.host = options.host ?? '127.0.0.1'; this.port = options.port ?? 6380; this.server = null; }
  start() {
    if (this.server) return this;
    this.server = http.createServer(async (request, response) => {
      try {
        const url = new URL(request.url, `http://${request.headers.host}`);
        const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
        if (url.pathname === '/health') return this._send(response, 200, { ok: true });
        if (!this.db.authorize(token)) return this._send(response, 401, { error: 'Unauthorized' });
        if (request.method === 'GET' && url.pathname === '/stats') return this._send(response, 200, this.db.stats());
        const match = url.pathname.match(/^\/collections\/([^/]+)(?:\/([^/]+))?$/);
        if (!match) return this._send(response, 404, { error: 'Not found' });
        const collection = this.db.collection(decodeURIComponent(match[1]));
        if (request.method === 'GET' && match[2]) return this._send(response, 200, collection.get(decodeURIComponent(match[2])) ?? null);
        if (request.method === 'GET') return this._send(response, 200, collection.values());
        const body = await this._body(request);
        if (request.method === 'PUT' && match[2]) collection.set(decodeURIComponent(match[2]), body);
        else if (request.method === 'POST') collection.add(body, body.id);
        else if (request.method === 'DELETE' && match[2]) collection.delete(decodeURIComponent(match[2]));
        else return this._send(response, 405, { error: 'Method not allowed' });
        return this._send(response, 200, { ok: true });
      } catch (error) { return this._send(response, 400, { error: error.message }); }
    });
    this.server.listen(this.port, this.host);
    return this;
  }
  _send(response, status, value) { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); }
  _body(request) { return new Promise((resolve, reject) => { let body = ''; request.on('data', chunk => body += chunk); request.on('end', () => resolve(body ? JSON.parse(body) : {})); request.on('error', reject); }); }
  stop() { return new Promise(resolve => this.server ? this.server.close(resolve) : resolve()); }
}

export function open(file = './youdata.ydb', options) { return new YouData(file, options); }
