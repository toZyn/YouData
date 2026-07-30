import fs from 'node:fs';
import path from 'node:path';

const MAGIC = Buffer.from('YDWAL02');
const HEADER_SIZE = 16;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function frame(buffer) {
  const result = Buffer.alloc(HEADER_SIZE + buffer.length);
  MAGIC.copy(result, 0);
  result.writeUInt32BE(buffer.length, 8);
  result.writeUInt32BE(crc32(buffer), 12);
  buffer.copy(result, HEADER_SIZE);
  return result;
}

export class WAL {
  constructor(file, options = {}) {
    this.path = path.resolve(file) + '.wal';
    this.fd = null;
    this._bytesWritten = 0;
    this.maxRecordSize = options.maxRecordSize ?? 64 * 1024 * 1024;
  }

  open() {
    this.fd = fs.openSync(this.path, fs.constants.O_CREAT | fs.constants.O_WRONLY | fs.constants.O_APPEND, 0o644);
    this._bytesWritten = fs.fstatSync(this.fd).size;
    return this;
  }

  append(buffer) {
    const record = frame(buffer);
    fs.writeSync(this.fd, record);
    fs.fdatasyncSync(this.fd);
    this._bytesWritten += record.length;
  }

  appendBatch(buffers) {
    const records = buffers.map(frame);
    for (const record of records) fs.writeSync(this.fd, record);
    fs.fdatasyncSync(this.fd);
    this._bytesWritten += records.reduce((size, record) => size + record.length, 0);
  }

  readAll() {
    if (!fs.existsSync(this.path)) return [];
    const data = fs.readFileSync(this.path);
    if (!data.length) return [];
    if (data.subarray(0, MAGIC.length).equals(MAGIC)) return this._readV2(data);
    return this._readLegacy(data);
  }

  _readV2(data) {
    const records = [];
    let offset = 0;
    while (offset < data.length) {
      if (data.length - offset < HEADER_SIZE) break;
      if (!data.subarray(offset, offset + MAGIC.length).equals(MAGIC)) throw new Error(`WAL corruption at offset ${offset}`);
      const size = data.readUInt32BE(offset + 8);
      const expected = data.readUInt32BE(offset + 12);
      if (size > this.maxRecordSize) throw new Error('WAL record exceeds configured limit');
      if (data.length - offset - HEADER_SIZE < size) break;
      const raw = data.subarray(offset + HEADER_SIZE, offset + HEADER_SIZE + size);
      if (crc32(raw) !== expected) throw new Error(`WAL checksum mismatch at offset ${offset}`);
      records.push(JSON.parse(raw.toString('utf8')));
      offset += HEADER_SIZE + size;
    }
    return records;
  }

  _readLegacy(data) {
    const records = [];
    let offset = 0;
    while (offset < data.length) {
      if (data.length - offset < 4) break;
      const size = data.readUInt32BE(offset);
      if (size > this.maxRecordSize) throw new Error('Legacy WAL record exceeds configured limit');
      if (data.length - offset - 4 < size) break;
      const raw = data.subarray(offset + 4, offset + 4 + size);
      records.push(JSON.parse(raw.toString('utf8')));
      offset += 4 + size;
    }
    return records;
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
      this.fd = fs.openSync(this.path, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR, 0o644);
      fs.writeSync(this.fd, `${this.pid}\n${Date.now()}\n`);
      fs.fdatasyncSync(this.fd);
      return true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const content = fs.readFileSync(this.path, 'utf8').trim().split('\n');
        const pid = Number.parseInt(content[0], 10);
        try { process.kill(pid, 0); return false; }
        catch { fs.unlinkSync(this.path); return this.acquire(); }
      } catch { return false; }
    }
  }

  release() {
    try { if (this.fd !== null) { fs.closeSync(this.fd); this.fd = null; } } catch {}
    try { fs.unlinkSync(this.path); } catch {}
  }
}
