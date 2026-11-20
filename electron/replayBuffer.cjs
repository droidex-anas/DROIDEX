class ReplayBuffer {
  constructor(maxBytes) {
    this.maxBytes = maxBytes;
    this.storage = Buffer.alloc(0);
    this.start = 0;
    this.length = 0;
  }

  append(bytes) {
    const dropped = Math.max(0, this.length + bytes.length - this.maxBytes);
    this.trimFront(Math.min(dropped, this.length));
    if (bytes.length > this.maxBytes) bytes = bytes.subarray(bytes.length - this.maxBytes);
    const needed = this.length + bytes.length;
    if (needed > this.storage.length) {
      const capacity = Math.min(this.maxBytes, Math.max(1024, needed, this.storage.length * 2));
      this.resize(capacity);
    }
    if (bytes.length > 0) {
      const end = (this.start + this.length) % this.storage.length;
      const first = Math.min(bytes.length, this.storage.length - end);
      bytes.copy(this.storage, end, 0, first);
      bytes.copy(this.storage, 0, first);
      this.length += bytes.length;
    }
    return dropped;
  }

  byteAt(index) {
    return this.storage[(this.start + index) % this.storage.length];
  }

  trimFront(count) {
    this.start = this.storage.length ? (this.start + count) % this.storage.length : 0;
    this.length -= count;
  }

  slice(start = 0) {
    start = Math.trunc(start);
    const result = Buffer.allocUnsafe(this.length - start);
    this.copyTo(result, start);
    return result;
  }

  copyTo(target, offset = 0) {
    if (offset === this.length) return;
    const start = (this.start + offset) % this.storage.length;
    const first = Math.min(this.length - offset, this.storage.length - start);
    this.storage.copy(target, 0, start, start + first);
    this.storage.copy(target, first, 0, this.length - offset - first);
  }

  resize(capacity) {
    const storage = Buffer.allocUnsafeSlow(capacity);
    this.copyTo(storage);
    this.storage = storage;
    this.start = 0;
  }

  compact() {
    if (this.length < this.storage.length) this.resize(this.length);
  }
}

module.exports = { ReplayBuffer };
