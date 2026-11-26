import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class MemoryStore {
  constructor() { this.entries = new Map(); this.version = 0; }
  async get(key, { type = 'text' } = {}) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (type === 'json') return JSON.parse(entry.bytes.toString('utf8'));
    if (type === 'arrayBuffer') return entry.bytes.buffer.slice(entry.bytes.byteOffset, entry.bytes.byteOffset + entry.bytes.byteLength);
    return entry.bytes.toString('utf8');
  }
  async getWithMetadata(key, options) {
    const entry = this.entries.get(key);
    return entry ? { data: await this.get(key, options), etag: entry.etag, metadata: {} } : null;
  }
  async set(key, input, options = {}) {
    const current = this.entries.get(key);
    if ((options.onlyIfNew && current) || (options.onlyIfMatch && current?.etag !== options.onlyIfMatch)) return { modified: false };
    const bytes = typeof input === 'string' ? Buffer.from(input) : Buffer.from(input);
    const etag = String(++this.version);
    this.entries.set(key, { bytes, etag });
    return { modified: true, etag };
  }
  async setJSON(key, value, options) { return this.set(key, JSON.stringify(value), options); }
}

export class FileStore extends MemoryStore {
  constructor(folder) { super(); this.folder = folder; }
  location(key) { return path.join(this.folder, createHash('sha256').update(key).digest('hex') + '.blob'); }
  async get(key, options) {
    if (!this.entries.has(key)) {
      try {
        const bytes = await readFile(this.location(key));
        this.entries.set(key, { bytes, etag: createHash('sha256').update(bytes).digest('hex') });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    return super.get(key, options);
  }
  async getWithMetadata(key, options) { await this.get(key, options); return super.getWithMetadata(key, options); }
  async set(key, input, options) {
    await this.get(key);
    const result = await super.set(key, input, options);
    if (result.modified) {
      await mkdir(this.folder, { recursive: true });
      await writeFile(this.location(key), this.entries.get(key).bytes);
    }
    return result;
  }
}
