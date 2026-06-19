import { getDiagnosticsTracer } from '../diagnostics/tracer.js';
import { DOMAIN_BLOCKCHAIN, TELEMETRY_DOMAIN_ATTR } from '../diagnostics/sampler.js';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeoutMs: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  timeoutMs: 30_000,
};

export class SorobanRpcClient {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private config: CircuitBreakerConfig;
  private tracer = getDiagnosticsTracer();

  constructor(
    private rpcUrl: string,
    config: Partial<CircuitBreakerConfig> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async submitTransaction(txEnvelope: string): Promise<{ hash: string; status: string }> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime > this.config.timeoutMs) {
        this.state = CircuitState.HALF_OPEN;
      } else {
        throw new Error('Circuit breaker is OPEN. Rejecting request.');
      }
    }

    return this.tracer.traceAsync(
      'blockchain.submitTransaction',
      async (span) => {
        span.setAttribute('rpc.url', this.rpcUrl);

        const headers = this.tracer.injectTraceContext({
          'Content-Type': 'application/json',
        });

        try {
          const response = await fetch(`${this.rpcUrl}/transactions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ tx: txEnvelope }),
          });

          if (!response.ok) {
            throw new Error(`RPC error: ${response.statusText}`);
          }

          const result = (await response.json()) as { hash: string; status: string };
          span.setAttribute('tx.hash', result.hash);
          span.setAttribute('tx.status', result.status);
          this.onSuccess();
          return result;
        } catch (error) {
          this.onFailure();
          throw error;
        }
      },
      { [TELEMETRY_DOMAIN_ATTR]: DOMAIN_BLOCKCHAIN },
    );
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount += 1;
      if (this.successCount >= this.config.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount += 1;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.successCount = 0;
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
  }
}
