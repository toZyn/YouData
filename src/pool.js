import { YouDataClient } from './client.js';

export class YouDataClientPool {
  constructor(options = {}) {
    const size = Math.max(1, options.size ?? 4);
    this.clients = Array.from({ length: size }, () => new YouDataClient(options));
    this.index = 0;
    this.credentials = null;
  }

  async connect() {
    await Promise.all(this.clients.map(client => client.connect()));
    if (this.credentials) await Promise.all(this.clients.map(client => client.auth(...this.credentials)));
    return this;
  }

  async auth(username, password) {
    this.credentials = [username, password];
    await Promise.all(this.clients.map(client => client.auth(username, password)));
    return this;
  }

  request(op, args) {
    const client = this.clients[this.index++ % this.clients.length];
    return client.request(op, args);
  }

  close() { for (const client of this.clients) client.close(); }
  get(collection, key) { return this.request('get', { collection, key }); }
  set(collection, key, value, options) { return this.request('set', { collection, key, value, options }); }
  setnx(collection, key, value, options) { return this.request('setnx', { collection, key, value, options }); }
  incr(collection, key, amount = 1) { return this.request('incr', { collection, key, amount }); }
  add(collection, value) { return this.request('add', { collection, value }); }
  delete(collection, key) { return this.request('delete', { collection, key }); }
  find(collection, query, options) { return this.request('find', { collection, query, options }); }
  sql(statement) { return this.request('sql', { statement }); }
}
