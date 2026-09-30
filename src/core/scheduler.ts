interface Options {
  /** Wait this long after the first change, so a burst of writes becomes one refresh. */
  delayMs: number;
  /** Never refresh more often than this, even while Claude writes continuously. */
  minIntervalMs: number;
}

/** Coalesces file-change events into occasional refreshes. */
export class RefreshScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastRun = Number.NEGATIVE_INFINITY;
  private disposed = false;

  constructor(
    private readonly run: () => void,
    private readonly opts: Options,
  ) {}

  trigger(): void {
    if (this.timer || this.disposed) return;
    const now = Date.now();
    const wait = Math.max(this.opts.delayMs, this.lastRun + this.opts.minIntervalMs - now);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.lastRun = Date.now();
      this.run();
    }, wait);
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
