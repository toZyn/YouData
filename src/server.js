#!/usr/bin/env node
import net from 'node:net';
import { open } from './index.js';

export class YouDataServer {
  constructor(file = './youdata.ydb', options = {}) {
    this.db = open(file, options.db);
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 6380;
    this.server = net.createServer(socket => this._connection(socket));
    this.clients = new Set();
    this.subscribers = new Map();
    this.queue = Promise.resolve();
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, resolve);
    }).then(() => this);
  }

  _connection(socket) {
    const client = { socket, buffer: '', token: null, subscriptions: new Set() };
    this.clients.add(client);
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      client.buffer += chunk;
      let index;
      while ((index = client.buffer.indexOf('\n')) >= 0) {
        const line = client.buffer.slice(0, index).trim();
        client.buffer = client.buffer.slice(index + 1);
        if (line) this._request(client, line);
      }
    });
    socket.on('close', () => this._remove(client));
    socket.on('error', () => this._remove(client));
  }

  _remove(client) {
    this.clients.delete(client);
    for (const channel of client.subscriptions) this.subscribers.get(channel)?.delete(client);
  }

  _reply(client, id, result, error = null) {
    if (!client.socket.destroyed) client.socket.write(JSON.stringify({ id, result: error ? null : result, error }) + '\n');
  }

  _request(client, line) {
    let request;
    try { request = JSON.parse(line); } catch { return this._reply(client, null, null, 'Invalid JSON'); }
    this.queue = this.queue.then(() => this._execute(client, request)).catch(error => this._reply(client, request.id ?? null, null, error.message));
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
    if (op === 'stats') return this._reply(client, id, this.db.stats());
    if (op === 'metrics') return this._reply(client, id, this.db.metricsSnapshot());
    if (op === 'get') return this._reply(client, id, this.db.collection(args.collection).get(args.key));
    if (op === 'set') { this.db.collection(args.collection).set(args.key, args.value, args.options); return this._reply(client, id, true); }
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
    return new Promise(resolve => this.server.close(resolve));
  }
}

if (process.argv[1]?.endsWith('server.js')) {
  const server = await new YouDataServer(process.argv[2] || './youdata.ydb', { port: Number(process.env.PORT || 6380) }).start();
  process.stdout.write(`YouData server listening on ${server.host}:${server.port}\n`);
}
