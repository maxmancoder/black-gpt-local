class InferenceQueue {
  constructor() {
    this.queue = [];
    this.running = false;
  }

  add(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this._pump();
    });
  }

  async _pump() {
    if (this.running || this.queue.length === 0) return;
    this.running = true;
    const { task, resolve, reject } = this.queue.shift();
    try {
      resolve(await task());
    } catch (e) {
      reject(e);
    } finally {
      this.running = false;
      this._pump();
    }
  }

  get pending() {
    return this.queue.length;
  }
}

module.exports = { inferenceQueue: new InferenceQueue() };