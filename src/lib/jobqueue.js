const logger = require('./logger');

class JobQueue {
  constructor() {
    this.queue = [];
    this.running = false;
    this.interval = null;
  }

  add(name, fn, retries = 3) {
    this.queue.push({ name, fn, retries, attempts: 0 });
  }

  start(intervalMs = 1000) {
    if (this.interval) return;
    this.interval = setInterval(() => this._processNext(), intervalMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async _processNext() {
    if (this.running || this.queue.length === 0) return;
    this.running = true;
    const job = this.queue.shift();
    try {
      await job.fn();
    } catch (err) {
      logger.error(err, { context: `JobQueue:${job.name}` });
      job.attempts++;
      if (job.attempts < job.retries) {
        this.queue.push(job);
      }
    } finally {
      this.running = false;
    }
  }

  getStatus() {
    return { queueLength: this.queue.length, running: this.running };
  }
}

const queue = new JobQueue();
queue.start(500);

module.exports = queue;
