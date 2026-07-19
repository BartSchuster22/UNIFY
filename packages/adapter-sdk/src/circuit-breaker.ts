import { AdapterError } from './types.js';
export type CircuitState = 'closed' | 'open' | 'half_open';
export interface CircuitBreakerOptions {
  failureThreshold?: number;
  cooldownMs?: number;
  now?: () => number;
}
export class CircuitBreaker {
  #state: CircuitState = 'closed';
  #failures = 0;
  #openedAt = 0;
  #probeInFlight = false;
  readonly #threshold: number;
  readonly #cooldown: number;
  readonly #now: () => number;
  constructor(options: CircuitBreakerOptions = {}) {
    this.#threshold = options.failureThreshold ?? 5;
    this.#cooldown = options.cooldownMs ?? 30_000;
    this.#now = options.now ?? Date.now;
    if (this.#threshold < 1) throw new RangeError('failureThreshold must be positive');
  }
  get state() {
    return this.#state;
  }
  beforeRequest() {
    if (this.#state === 'open') {
      if (this.#now() - this.#openedAt < this.#cooldown)
        throw new AdapterError(
          'ADAPTER_CIRCUIT_OPEN',
          'circuit_open',
          true,
          'Adapter circuit is open',
        );
      this.#state = 'half_open';
    }
    if (this.#state === 'half_open') {
      if (this.#probeInFlight)
        throw new AdapterError(
          'ADAPTER_CIRCUIT_OPEN',
          'circuit_open',
          true,
          'Adapter circuit probe is in flight',
        );
      this.#probeInFlight = true;
    }
  }
  success() {
    this.#state = 'closed';
    this.#failures = 0;
    this.#probeInFlight = false;
  }
  neutral() {
    this.#probeInFlight = false;
    if (this.#state === 'half_open') this.open();
  }
  failure() {
    this.#probeInFlight = false;
    if (this.#state === 'half_open') {
      this.open();
      return;
    }
    this.#failures += 1;
    if (this.#failures >= this.#threshold) this.open();
  }
  private open() {
    this.#state = 'open';
    this.#openedAt = this.#now();
  }
}
