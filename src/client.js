import net from 'node:net';

export class YouDataClient {
  constructor(options = {}) {
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 6380;
    this.token = options.token ?? null;
    this.socket = null;
    this.buffer = '';
    this.pending = new Map();
    this.sequence = 0;
    this.events = new Map();
  }

  connect() {
    if (this.socket) return Promise.resolve(this);
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      this.socket = socket;
      socket.setEncoding('utf8');
      socket.on('data', chunk => this._data(chunk));
      socket.once('connect', () => resolve(this));
      socket.once('error', error => { if (!this.socket) reject(error); });
      socket.on('close', () => { this.socket = null; for (const p of this.pending.values()) p.reject(new Error('Connection closed')); this.pending.clear(); });
    });
  }

  _data(chunk) {
    this.buffer += chunk;
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let response;
      try { response = JSON.parse(line); } catch { continue; }
      if (response.result?.event === 'message') {
        for (const handler of this.events.get(response.result.channel) || []) handler(response.result.message);
        continue;
      }
      const pending = this.pending.get(response.id);
      if (!pending) continue;
      this.pending.delete(response.id);
      response.error ? pending.reject(new Error(response.error)) : pending.resolve(response.result);
    }
  }

  async request(op, args = {}) {
    await this.connect();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.write(JSON.stringify({ id, op, args, token: this.token }) + '\n');
    });
  }

  async auth(username, password) { const session = await this.request('auth', { username, password }); this.token = session.token; return session; }
  get(collection, key) { return this.request('get', { collection, key }); }
  set(collection, key, value, options) { return this.request('set', { collection, key, value, options }); }
  add(collection, value) { return this.request('add', { collection, value }); }
  delete(collection, key) { return this.request('delete', { collection, key }); }
  find(collection, query, options) { return this.request('find', { collection, query, options }); }
  sql(statement) { return this.request('sql', { statement }); }
  publish(channel, message) { return this.request('publish', { channel, message }); }
  async subscribe(channel, handler) { if (!this.events.has(channel)) this.events.set(channel, new Set()); this.events.get(channel).add(handler); return this.request('subscribe', { channel }); }
  unsubscribe(channel, handler) { this.events.get(channel)?.delete(handler); return this.request('unsubscribe', { channel }); }
  close() { this.socket?.end(); this.socket = null; }
}
