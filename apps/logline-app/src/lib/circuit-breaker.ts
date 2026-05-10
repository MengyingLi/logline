/**
 * Minimal circuit breaker for external HTTP-style failures.
 * Opens after `threshold` failures in `windowMs`, resets after `cooldownMs`.
 */

export class CircuitBreaker {
  private failures = 0;
  private openedUntil = 0;
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;
  private windowStart = Date.now();

  constructor(opts?: { threshold?: number; windowMs?: number; cooldownMs?: number }) {
    this.threshold = opts?.threshold ?? 8;
    this.windowMs = opts?.windowMs ?? 60_000;
    this.cooldownMs = opts?.cooldownMs ?? 30_000;
  }

  isOpen(): boolean {
    return Date.now() < this.openedUntil;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.windowStart = Date.now();
  }

  recordFailure(): void {
    const now = Date.now();
    if (now - this.windowStart > this.windowMs) {
      this.failures = 1;
      this.windowStart = now;
      return;
    }
    this.failures++;
    if (this.failures >= this.threshold) {
      this.openedUntil = now + this.cooldownMs;
      this.failures = 0;
      this.windowStart = now;
    }
  }
}
