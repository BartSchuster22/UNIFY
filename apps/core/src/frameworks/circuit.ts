import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { FrameworkGatewayError, type CircuitBreaker } from './types.js';

export class MemoryCircuitBreaker implements CircuitBreaker {
  #failures = 0;
  #state: 'closed' | 'open' | 'half-open' = 'closed';
  #nextAttemptAt = 0;
  #halfOpenInFlight = false;

  constructor(
    private readonly failureThreshold: number,
    private readonly openMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async execute<T>(work: () => Promise<T>): Promise<T> {
    const observedAt = this.now();
    if (this.#state === 'open') {
      if (observedAt < this.#nextAttemptAt) throw circuitOpen();
      this.#state = 'half-open';
    }
    if (this.#state === 'half-open') {
      if (this.#halfOpenInFlight) throw circuitOpen();
      this.#halfOpenInFlight = true;
    }
    try {
      const result = await work();
      this.#state = 'closed';
      this.#failures = 0;
      this.#nextAttemptAt = 0;
      return result;
    } catch (error) {
      this.#failures += 1;
      if (this.#state === 'half-open' || this.#failures >= this.failureThreshold) {
        this.#state = 'open';
        this.#nextAttemptAt = this.now() + this.openMs;
      }
      throw error;
    } finally {
      this.#halfOpenInFlight = false;
    }
  }

  snapshot() {
    return Object.freeze({
      state: this.#state,
      consecutiveFailures: this.#failures,
      nextAttemptAt: this.#nextAttemptAt || null,
    });
  }
}

interface RuntimeRow extends QueryResultRow {
  circuit_state: 'closed' | 'open' | 'half-open';
  consecutive_failures: number;
  next_attempt_at: Date | null;
  probe_lease_until: Date | null;
}

export class PostgresFrameworkCircuitBreaker implements CircuitBreaker {
  constructor(
    private readonly pool: Pool,
    private readonly frameworkId: string,
    private readonly failureThreshold: number,
    private readonly openMs: number,
    private readonly probeLeaseMs: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute<T>(work: () => Promise<T>): Promise<T> {
    await this.#acquire();
    try {
      const result = await work();
      await this.pool.query(
        `UPDATE core.framework_gateway_runtime
         SET circuit_state='closed',consecutive_failures=0,opened_at=NULL,next_attempt_at=NULL,
             probe_lease_until=NULL,last_success_at=$2,last_safe_error_code=NULL,updated_at=$2
         WHERE framework_id=$1`,
        [this.frameworkId, this.now()],
      );
      return result;
    } catch (error) {
      await this.#recordFailure(error);
      throw error;
    }
  }

  async #acquire(): Promise<void> {
    await transaction(this.pool, async (client) => {
      await client.query(
        'INSERT INTO core.framework_gateway_runtime (framework_id) VALUES ($1) ON CONFLICT DO NOTHING',
        [this.frameworkId],
      );
      const result = await client.query<RuntimeRow>(
        `SELECT circuit_state,consecutive_failures,next_attempt_at,probe_lease_until
         FROM core.framework_gateway_runtime WHERE framework_id=$1 FOR UPDATE`,
        [this.frameworkId],
      );
      const runtime = result.rows[0]!;
      const now = this.now();
      if (
        runtime.circuit_state === 'open' &&
        runtime.next_attempt_at &&
        runtime.next_attempt_at > now
      )
        throw circuitOpen();
      if (
        runtime.circuit_state === 'half-open' &&
        runtime.probe_lease_until &&
        runtime.probe_lease_until > now
      )
        throw circuitOpen();
      if (runtime.circuit_state !== 'closed') {
        await client.query(
          `UPDATE core.framework_gateway_runtime
           SET circuit_state='half-open',probe_lease_until=$2,updated_at=$3 WHERE framework_id=$1`,
          [this.frameworkId, new Date(now.getTime() + this.probeLeaseMs), now],
        );
      }
    });
  }

  async #recordFailure(error: unknown): Promise<void> {
    const code = safeErrorCode(error);
    const now = this.now();
    await transaction(this.pool, async (client) => {
      const result = await client.query<RuntimeRow>(
        `SELECT circuit_state,consecutive_failures,next_attempt_at,probe_lease_until
         FROM core.framework_gateway_runtime WHERE framework_id=$1 FOR UPDATE`,
        [this.frameworkId],
      );
      const runtime = result.rows[0];
      if (!runtime) return;
      const failures = runtime.consecutive_failures + 1;
      const shouldOpen = runtime.circuit_state === 'half-open' || failures >= this.failureThreshold;
      await client.query(
        `UPDATE core.framework_gateway_runtime
         SET circuit_state=$2,consecutive_failures=$3,
             opened_at=CASE WHEN $2='open' THEN $4 ELSE NULL END,
             next_attempt_at=CASE WHEN $2='open' THEN $5 ELSE NULL END,
             probe_lease_until=NULL,last_failure_at=$4,last_safe_error_code=$6,updated_at=$4
         WHERE framework_id=$1`,
        [
          this.frameworkId,
          shouldOpen ? 'open' : 'closed',
          failures,
          now,
          shouldOpen ? new Date(now.getTime() + this.openMs) : null,
          code,
        ],
      );
    });
  }
}

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function safeErrorCode(error: unknown): string {
  const candidate =
    error instanceof FrameworkGatewayError ? error.code : 'framework_request_failed';
  return /^[a-z][a-z0-9_]{2,127}$/u.test(candidate) ? candidate : 'framework_request_failed';
}

function circuitOpen(): FrameworkGatewayError {
  return new FrameworkGatewayError(
    'framework_circuit_open',
    'Framework circuit is open',
    true,
    503,
  );
}
