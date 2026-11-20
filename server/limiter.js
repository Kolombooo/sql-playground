// FIFO concurrency limiter: at most `max` jobs touch PostgreSQL at once, the rest wait in a queue.
export class QueueFullError extends Error {}
export class AlreadyQueuedError extends Error {}

export class Limiter {
  constructor(max, maxQueue) {
    this.max = max;
    this.maxQueue = maxQueue;
    this.active = 0;
    this.queue = []; // { ticket, start }
    this.keys = new Set(); // keys currently running or waiting (one job per key)
    this.recent = []; // recent job durations (ms) for wait estimates
  }

  avgMs() {
    if (!this.recent.length) return 300;
    return this.recent.reduce((a, b) => a + b, 0) / this.recent.length;
  }

  /** State of a ticket: { state: "queued", position, estimateMs } | { state: "running" } | { state: "unknown" } */
  status(ticket) {
    const i = this.queue.findIndex((e) => e.ticket === ticket);
    if (i >= 0) return { state: "queued", position: i + 1, estimateMs: this.estimate(i + 1) };
    if (this.running?.has(ticket)) return { state: "running" };
    return { state: "unknown" };
  }

  estimate(position) {
    return Math.round((Math.ceil(position / this.max)) * this.avgMs());
  }

  /** Run fn when a slot is free. Resolves { value, waitedMs, positionAtEnqueue }. */
  run({ key = null, ticket }, fn) {
    if (key && this.keys.has(key)) throw new AlreadyQueuedError("You already have a query waiting or running.");
    if (this.active >= this.max && this.queue.length >= this.maxQueue) {
      throw new QueueFullError("The server is very busy. Please try again in a moment.");
    }
    if (key) this.keys.add(key);
    this.running ??= new Set();
    return new Promise((resolve, reject) => {
      const enqueuedAt = Date.now();
      const positionAtEnqueue = this.active < this.max ? 0 : this.queue.length + 1;
      const start = async () => {
        this.active++;
        this.running.add(ticket);
        const t0 = Date.now();
        const waitedMs = t0 - enqueuedAt;
        try {
          resolve({ value: await fn(), waitedMs, positionAtEnqueue });
        } catch (e) {
          reject(e);
        } finally {
          this.recent.push(Date.now() - t0);
          if (this.recent.length > 30) this.recent.shift();
          this.active--;
          this.running.delete(ticket);
          if (key) this.keys.delete(key);
          this.next();
        }
      };
      this.queue.push({ ticket, start });
      this.next();
    });
  }

  next() {
    while (this.active < this.max && this.queue.length) this.queue.shift().start();
  }
}
