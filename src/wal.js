import fs from 'node:fs';
import path from 'node:path';

export class WAL {
  constructor(file) {
    this.path = path.resolve(file) + '.wal';
    this.fd = null;
    this._bytesWritten = 0;
  }

  open() {
    this.fd = fs.openSync(this.path,
      fs.constants.O_CREAT | fs.constants.O_WRONLY | fs.constants.O_APPEND,
      0o644);
    this._bytesWritten = fs.fstatSync(this.fd).size;
    return this;
  }

  append(buffer) {
    fs.writeSync(this.fd, buffer);
    fs.fdatasyncSync(this.fd);
    this._bytesWritten += buffer.length;
  }

  appendBatch(buffers) {
    for (const buf of buffers) fs.writeSync(this.fd, buf);
    fs.fdatasyncSync(this.fd);
    this._bytesWritten += buffers.reduce((a, b) => a + b.length, 0);
  }

  readAll() {
    if (!fs.existsSync(this.path)) return [];
    try {
      const data = fs.readFileSync(this.path);
      const records = [];
      let offset = 0;
      while (offset < data.length) {
        const size = data.readUInt32BE(offset);
        const raw = data.subarray(offset + 4, offset + 4 + size);
        records.push(JSON.parse(raw.toString()));
        offset += 4 + size;
      }
      return records;
    } catch { return []; }
  }

  clear() {
    fs.ftruncateSync(this.fd, 0);
    fs.fdatasyncSync(this.fd);
    this._bytesWritten = 0;
  }

  size() { return this._bytesWritten; }

  close() {
    if (this.fd !== null) {
      try { fs.fdatasyncSync(this.fd); } catch {}
      try { fs.closeSync(this.fd); } catch {}
      this.fd = null;
    }
  }

  delete() {
    this.close();
    try { fs.unlinkSync(this.path); } catch {}
  }
}

export class FileLock {
  constructor(file) {
    this.path = path.resolve(file) + '.lock';
    this.fd = null;
    this.pid = process.pid;
  }

  acquire() {
    try {
      this.fd = fs.openSync(this.path,
        fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR,
        0o644);
      fs.writeSync(this.fd, `${this.pid}\n${Date.now()}\n`);
      fs.fdatasyncSync(this.fd);
      return true;
    } catch (e) {
      if (e.code === 'EEXIST') {
        try {
          const content = fs.readFileSync(this.path, 'utf-8').trim().split('\n');
          const pid = parseInt(content[0], 10);
          try { process.kill(pid, 0); return false; }
          catch { fs.unlinkSync(this.path); return this.acquire(); }
        } catch { return false; }
      }
      throw e;
    }
  }

  release() {
    try { if (this.fd !== null) { fs.closeSync(this.fd); this.fd = null; } } catch {}
    try { fs.unlinkSync(this.path); } catch {}
  }
}
