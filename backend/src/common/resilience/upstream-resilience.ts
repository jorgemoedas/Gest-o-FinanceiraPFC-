export class CircuitOpenError extends Error {
  constructor() {
    super('upstream circuit open');
    this.name = 'CircuitOpenError';
  }
}

export interface ResilienceOptions {
  attempts: number;
  baseDelayMs: number;
  failureThreshold: number;
  recoveryMs: number;
}

export class UpstreamResilience {
  private consecutiveFailures = 0;
  private openedAt = 0;
  private halfOpenInFlight = false;

  constructor(private readonly options: ResilienceOptions) {}

  async execute<T>(operation: (attempt: number) => Promise<T>, shouldRetry: (error: unknown) => boolean, countsAsFailure: (error: unknown) => boolean): Promise<T> {
    const halfOpen = this.claimCircuit();

    try {
      return await this.runAttempts(operation, shouldRetry, countsAsFailure, halfOpen);
    } finally {
      this.releaseCircuit(halfOpen);
    }
  }

  private claimCircuit(): boolean {
    const halfOpen = this.openedAt > 0 && Date.now() - this.openedAt >= this.options.recoveryMs;
    if (this.openedAt > 0 && !halfOpen) throw new CircuitOpenError();
    if (halfOpen && this.halfOpenInFlight) throw new CircuitOpenError();
    if (halfOpen) this.halfOpenInFlight = true;
    return halfOpen;
  }

  private releaseCircuit(halfOpen: boolean): void {
    if (halfOpen) this.halfOpenInFlight = false;
  }

  private async runAttempts<T>(
    operation: (attempt: number) => Promise<T>,
    shouldRetry: (error: unknown) => boolean,
    countsAsFailure: (error: unknown) => boolean,
    halfOpen: boolean
  ): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const result = await operation(attempt);
        this.consecutiveFailures = 0;
        this.openedAt = 0;
        return result;
      } catch (error: unknown) {
        if (this.shouldStop(attempt, error, shouldRetry)) {
          this.recordFailure(error, countsAsFailure, halfOpen);
          throw error;
        }
        await this.delay(attempt);
      }
    }
  }

  private shouldStop(attempt: number, error: unknown, shouldRetry: (error: unknown) => boolean): boolean {
    return attempt >= Math.max(1, this.options.attempts) || !shouldRetry(error);
  }

  private recordFailure(error: unknown, countsAsFailure: (error: unknown) => boolean, halfOpen: boolean): void {
    if (countsAsFailure(error)) {
      this.consecutiveFailures += 1;
      if (halfOpen || this.consecutiveFailures >= this.options.failureThreshold) this.openedAt = Date.now();
      return;
    }
    if (halfOpen) {
      this.openedAt = 0;
      this.consecutiveFailures = 0;
    }
  }

  private async delay(attempt: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.options.baseDelayMs * 2 ** (attempt - 1)));
  }

  isOpen(): boolean {
    return this.openedAt > 0 && Date.now() - this.openedAt < this.options.recoveryMs;
  }
}

export function transientNetworkFailure(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError' || error.name === 'TypeError');
}
