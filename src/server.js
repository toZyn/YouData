#!/usr/bin/env node
import net from 'node:net';
import http from 'node:http';
import crypto from 'node:crypto';
import { open } from './index.js';
import { SQLDatabase } from './sql.js';

export class YouDataServer {
  constructor(file = './youdata.ydb', options = {}) {
    this.db = open(file, options.db);
    this.sql = new SQLDatabase(this.db);
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 6380;
    this.httpPort = options.httpPort ?? this.port + 1;
    this.server = net.createServer(socket => this._connection(socket));
    this.httpServer = http.createServer((request, response) => this._http(request, response));
    this.wsClients = new Set();
    this.clients = new Set();
    this.subscribers = new Map();
    this.queue = Promise.resolve();
    this.maxRequestSize = options.maxRequestSize ?? 1_048_576;
    this.writeOperations = new Set(['set', 'setnx', 'incr', 'add', 'delete', 'rpush', 'hset', 'sadd', 'publish']);
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.httpServer.on('upgrade', (request, socket) => this._upgrade(request, socket));
        this.httpServer.listen(this.httpPort, this.host, resolve);
      });
    }).then(() => this);
  }

  _connection(socket) {
    const client = { socket, buffer: '', token: null, subscriptions: new Set() };
    this.clients.add(client);
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      client.buffer += chunk;
      let index;
      if (client.buffer.length > this.maxRequestSize) {
        socket.destroy();
        return;
      }
      while ((index = client.buffer.indexOf('\n')) >= 0) {
        const line = client.buffer.slice(0, index).trim();
        client.buffer = client.buffer.slice(index + 1);
        if (line && Buffer.byteLength(line) <= this.maxRequestSize) this._request(client, line);
      }
    });
    socket.on('close', () => this._remove(client));
    socket.on('error', () => this._remove(client));
  }

  _http(request, response) {
    if (request.url === '/health') { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ ok: true })); return; }
    if (request.url !== '/api') { response.writeHead(404); response.end(); return; }
    let body = '';
    request.on('data', chunk => { body += chunk; if (body.length > this.maxRequestSize) request.destroy(); });
    request.on('end', async () => {
      try { const input = JSON.parse(body || '{}'); const client = { socket: { destroyed: false }, http: response, token: request.headers.authorization?.replace(/^Bearer\s+/i, '') || input.token || null, subscriptions: new Set() }; await this._execute(client, input); }
      catch (error) { if (!response.writableEnded) { response.writeHead(400, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: error.message })); } }
    });
  }

  _upgrade(request, socket) {
    if (request.url !== '/ws' || request.headers.upgrade?.toLowerCase() !== 'websocket') { socket.destroy(); return; }
    const key = request.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const client = { socket, buffer: Buffer.alloc(0), subscriptions: new Set() };
    this.wsClients.add(client);
    socket.on('data', chunk => this._wsData(client, chunk));
    socket.on('close', () => { this.wsClients.delete(client); });
    socket.on('error', () => { this.wsClients.delete(client); socket.destroy(); });
  }

  _wsData(client, chunk) {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    while (client.buffer.length >= 2) {
      const first = client.buffer[0], second = client.buffer[1];
      const opcode = first & 15, masked = second & 128;
      let length = second & 127, offset = 2;
      if (length === 126) { if (client.buffer.length < 4) return; length = client.buffer.readUInt16BE(2); offset = 4; }
      else if (length === 127) { if (client.buffer.length < 10) return; length = Number(client.buffer.readBigUInt64BE(2)); offset = 10; }
      if (length > this.maxRequestSize || !masked || client.buffer.length < offset + 4 + length) return;
      const mask = client.buffer.subarray(offset, offset + 4); offset += 4;
      const payload = client.buffer.subarray(offset, offset + length); client.buffer = client.buffer.subarray(offset + length);
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      if (opcode === 8) { client.socket.end(); return; }
      if (opcode === 9) { this._wsFrame(client.socket, payload, 10); continue; }
      if (opcode === 1) { let request; try { request = JSON.parse(payload.toString()); } catch { this._wsFrame(client.socket, Buffer.from(JSON.stringify({ error: 'Invalid JSON' }))); continue; } Promise.resolve(this._execute({ socket: client.socket, ws: client }, request)).catch(error => this._wsFrame(client.socket, Buffer.from(JSON.stringify({ id: request.id ?? null, error: error.message })))); }
    }
  }

  _wsFrame(socket, payload, opcode = 1) {
    const length = payload.length; let header;
    if (length < 126) header = Buffer.from([128 | opcode, length]);
    else if (length < 65536) { header = Buffer.alloc(4); header[0] = 128 | opcode; header[1] = 126; header.writeUInt16BE(length, 2); }
    else { header = Buffer.alloc(10); header[0] = 128 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(length), 2); }
    socket.write(Buffer.concat([header, payload]));
  }

  _remove(client) {
    this.clients.delete(client);
    for (const channel of client.subscriptions) this.subscribers.get(channel)?.delete(client);
  }

  _reply(client, id, result, error = null) {
    const payload = { id, result: error ? null : result, error };
    if (client.ws) { if (!client.socket.destroyed) this._wsFrame(client.socket, Buffer.from(JSON.stringify(payload))); return; }
    if (client.http) { if (!client.http.writableEnded) { client.http.writeHead(error ? 400 : 200, { 'content-type': 'application/json' }); client.http.end(JSON.stringify(payload)); } return; }
    if (!client.socket.destroyed) client.socket.write(JSON.stringify(payload) + '\n');
  }

  _request(client, line) {
    let request;
    try { request = JSON.parse(line); } catch { return this._reply(client, null, null, 'Invalid JSON'); }
    if (!this.writeOperations.has(request.op)) {
      Promise.resolve(this._execute(client, request)).catch(error => this._reply(client, request.id ?? null, null, error.message));
      return;
    }
    this.queue = this.queue
      .then(() => this._execute(client, request))
      .catch(error => this._reply(client, request.id ?? null, null, error.message));
  }

  async _execute(client, request) {
    const { id = null, op, args = {}, token } = request;
    if (token) client.token = token;
    if (op === 'health') return this._reply(client, id, { ok: true });
    if (op === 'auth') {
      const session = this.db.authenticate(args.username, args.password);
      if (!session) return this._reply(client, id, null, 'Unauthorized');
      client.token = session.token;
      return this._reply(client, id, session);
    }
    if (!this.db.authorize(client.token)) return this._reply(client, id, null, 'Unauthorized');
    if (op === 'subscribe') {
      const channel = String(args.channel);
      if (!this.subscribers.has(channel)) this.subscribers.set(channel, new Set());
      this.subscribers.get(channel).add(client);
      client.subscriptions.add(channel);
      return this._reply(client, id, { channel, subscribed: true });
    }
    if (op === 'unsubscribe') {
      const channel = String(args.channel);
      this.subscribers.get(channel)?.delete(client);
      client.subscriptions.delete(channel);
      return this._reply(client, id, { channel, subscribed: false });
    }
    if (op === 'publish') {
      const channel = String(args.channel);
      const message = args.message;
      const subscribers = this.subscribers.get(channel) || new Set();
      for (const subscriber of subscribers) this._reply(subscriber, null, { event: 'message', channel, message });
      return this._reply(client, id, subscribers.size);
    }
    if (op === 'sql') return this._reply(client, id, this.sql.execute(args.statement));
    if (op === 'stats') return this._reply(client, id, this.db.stats());
    if (op === 'metrics') return this._reply(client, id, this.db.metricsSnapshot());
    if (op === 'get') return this._reply(client, id, this.db.collection(args.collection).get(args.key));
    if (op === 'set') { this.db.collection(args.collection).set(args.key, args.value, args.options); return this._reply(client, id, true); }
    if (op === 'setnx') { const col = this.db.collection(args.collection); if (col.has(args.key)) return this._reply(client, id, false); col.set(args.key, args.value, args.options); return this._reply(client, id, true); }
    if (op === 'incr') { const col = this.db.collection(args.collection); const current = col.get(args.key); const value = current === undefined ? 0 : current.value; if (current && current.__youdataType !== 'counter') return this._reply(client, id, null, 'Value is not numeric'); const next = value + Number(args.amount ?? 1); if (!Number.isFinite(next)) return this._reply(client, id, null, 'Amount is not numeric'); col.set(args.key, { __youdataType: 'counter', value: next }); return this._reply(client, id, next); }
    if (op === 'add') return this._reply(client, id, this.db.collection(args.collection).addWithKey(args.value));
    if (op === 'delete') return this._reply(client, id, this.db.collection(args.collection).delete(args.key));
    if (op === 'find') return this._reply(client, id, this.db.collection(args.collection).find(args.query || {}, args.options || {}));
    if (op === 'list') return this._reply(client, id, this.db.collection(args.collection).list(args.key));
    if (op === 'rpush') return this._reply(client, id, this.db.collection(args.collection).rpush(args.key, ...args.values));
    if (op === 'hset') return this._reply(client, id, this.db.collection(args.collection).hset(args.key, args.field, args.value));
    if (op === 'hgetall') return this._reply(client, id, this.db.collection(args.collection).hgetall(args.key));
    if (op === 'sadd') return this._reply(client, id, this.db.collection(args.collection).sadd(args.key, ...args.values));
    if (op === 'smembers') return this._reply(client, id, this.db.collection(args.collection).smembers(args.key));
    return this._reply(client, id, null, 'Unknown operation');
  }

  stop() {
    for (const client of this.clients) client.socket.destroy();
    this.db.close();
    return new Promise(resolve => this.httpServer.close(() => this.server.close(resolve)));
  }
}

if (process.argv[1]?.endsWith('server.js')) {
  const server = await new YouDataServer(process.argv[2] || './youdata.ydb', { port: Number(process.env.PORT || 6380) }).start();
  process.stdout.write(`YouData server listening on ${server.host}:${server.port}\n`);
}
