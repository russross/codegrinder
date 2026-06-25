// This would be a module but
// the worker (jsWorker.js) is not a module and
// you cannot mix modules and scripts in a worker

// Only 1 instance of enqueue at a time
// Only 1 instance of dequeue at a time
class AtomicQueue {
  #head = null;
  #tail = null;
  #queue = null;
  constructor(sab) {
    // tail == head is zero length
    this.#head = new Int32Array(sab, 0, 1);
    this.#tail = new Int32Array(sab, 4, 1);
    this.#queue = new Int8Array(sab, 8);
    this.maxWriteLength = this.#queue.length - 1
  }

  #tryEnqueueMultiple(bytes, currentTail, currentHead) {
    const nextTail = (currentTail + bytes.length) % this.#queue.length;
    const currentUsed = currentHead <= currentTail ? currentTail - currentHead : this.#queue.length - currentTail + currentHead;
    const room = this.#queue.length - currentUsed - 1;
    if (bytes.length > room) {
      return false;
    }
    for (let byte = 0; byte < bytes.length; byte++) {
      this.#queue[(currentTail + byte) % this.#queue.length] = bytes[byte];
    }
    Atomics.store(this.#tail, 0, nextTail);
    Atomics.notify(this.#tail, 0, 1);
    return true;
  }
  #tryDequeueAll(currentHead, currentTail) {
    // Zero length
    if (currentHead === currentTail) {
      return null;
    }
    const array = [];
    let pos = currentHead;
    while (pos !== currentTail) {
      array.push(this.#queue[pos]);
      pos += 1;
      if (pos >= this.#queue.length) {
        pos = 0;
      }
    }
    Atomics.store(this.#head, 0, currentTail);
    Atomics.notify(this.#head, 0, 1);
    return array;
  }
  enqueueMultipleSync(bytes = new Int8Array()) {
    if (bytes.length > this.maxWriteLength) {
      throw new Error("cannot write that much at once");
    }
    while (true) {
      const currentTail = Atomics.load(this.#tail, 0);
      const currentHead = Atomics.load(this.#head, 0);
      if (this.#tryEnqueueMultiple(bytes, currentTail, currentHead)) return;
      Atomics.wait(this.#head, 0, currentHead);
    }
  }
  async enqueueMultipleAsync(bytes = new Int8Array()) {
    if (bytes.length > this.maxWriteLength) {
      throw new Error("cannot write that much at once");
    }
    while (true) {
      const currentTail = Atomics.load(this.#tail, 0);
      const currentHead = Atomics.load(this.#head, 0);
      if (this.#tryEnqueueMultiple(bytes, currentTail, currentHead)) return;
      await Atomics.waitAsync(this.#head, 0, currentHead).value;
    }
  }
  dequeueAllSync() {
    while (true) {
      const currentHead = Atomics.load(this.#head, 0);
      const currentTail = Atomics.load(this.#tail, 0);
      const ret = this.#tryDequeueAll(currentHead, currentTail);
      if (ret) return ret;
      Atomics.wait(this.#tail, 0, currentTail);
    }
  }
  async dequeueAllAsync() {
    while (true) {
      const currentHead = Atomics.load(this.#head, 0);
      const currentTail = Atomics.load(this.#tail, 0);
      const ret = this.#tryDequeueAll(currentHead, currentTail);
      if (ret) return ret;
      await Atomics.waitAsync(this.#tail, 0, currentTail).value;
    }
  }
  enqueueChunkedMultipleSync(bytes = new Int8Array()) {
    let index = 0;
    while (index < bytes.length) {
      const toWrite = Math.min(this.maxWriteLength, bytes.length - index);
      this.enqueueMultipleSync(bytes.subarray(index, index + toWrite));
      index += toWrite;
    }
  }
  async enqueueChunkedMultipleAsync(bytes = new Int8Array()) {
    let index = 0;
    while (index < bytes.length) {
      const toWrite = Math.min(this.maxWriteLength, bytes.length - index);
      await this.enqueueMultipleAsync(bytes.subarray(index, index + toWrite));
      index += toWrite;
    }
  }
}
class AtomicJSONQueue {
  #atomicQueue;
  #buffer;
  constructor(sab) {
    this.#atomicQueue = new AtomicQueue(sab);
    this.#buffer = [];
  }
  enqueueMessageSync(obj) {
    this.#atomicQueue.enqueueChunkedMultipleSync(new TextEncoder().encode(JSON.stringify(obj)));
    this.#atomicQueue.enqueueMultipleSync(new Uint8Array([0]));
  }
  async enqueueMessageAsync(obj) {
    await this.#atomicQueue.enqueueChunkedMultipleAsync(new TextEncoder().encode(JSON.stringify(obj)));
    await this.#atomicQueue.enqueueMultipleAsync(new Uint8Array([0]));
  }
  dequeueMessageSync() {
    while (!this.#buffer.includes(0)) {
      this.#buffer.push(...this.#atomicQueue.dequeueAllSync());
    }
    const buff = this.#buffer.splice(0, this.#buffer.indexOf(0));
    this.#buffer.splice(0, 1);
    return JSON.parse(new TextDecoder().decode(new Uint8Array(buff)));
  }
  async dequeueMessageAsync() {
    while (!this.#buffer.includes(0)) {
      this.#buffer.push(...await this.#atomicQueue.dequeueAllAsync());
    }
    const buff = this.#buffer.splice(0, this.#buffer.indexOf(0));
    this.#buffer.splice(0, 1);
    return JSON.parse(new TextDecoder().decode(new Uint8Array(buff)));
  }
}