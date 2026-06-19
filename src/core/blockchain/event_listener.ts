import { getDiagnosticsTracer } from '../diagnostics/tracer.js';
import { DOMAIN_BLOCKCHAIN, TELEMETRY_DOMAIN_ATTR } from '../diagnostics/sampler.js';

interface LedgerEntry {
  sequence: number;
  hash: string;
  closedAt: string;
  transactions: string[];
}

interface SyncState {
  lastSyncedLedger: number;
  targetLedger: number;
  inProgress: boolean;
}

export class LedgerEventSynchronizer {
  private tracer = getDiagnosticsTracer();
  private syncState: SyncState = {
    lastSyncedLedger: 0,
    targetLedger: 0,
    inProgress: false,
  };
  private pollIntervalMs = 5000;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(private rpcUrl: string) {}

  start(): void {
    this.intervalHandle = setInterval(() => {
      void this.pollLatestLedger();
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async catchUp(fromLedger: number, toLedger: number): Promise<void> {
    this.syncState = {
      lastSyncedLedger: fromLedger,
      targetLedger: toLedger,
      inProgress: true,
    };

    for (let seq = fromLedger + 1; seq <= toLedger; seq++) {
      try {
        const ledger = await this.fetchLedger(seq);
        await this.processLedger(ledger);
        this.syncState.lastSyncedLedger = seq;
      } catch (error) {
        console.error(`Failed to sync ledger ${String(seq)}:`, error);
        break;
      }
    }

    this.syncState.inProgress = false;
  }

  private async pollLatestLedger(): Promise<void> {
    try {
      const response = await this.rpcFetch(`${this.rpcUrl}/ledgers/latest`);
      const latest = (await response.json()) as { sequence: number };
      if (latest.sequence > this.syncState.lastSyncedLedger) {
        await this.catchUp(this.syncState.lastSyncedLedger, latest.sequence);
      }
    } catch (error) {
      console.error('Polling error:', error);
    }
  }

  private async fetchLedger(sequence: number): Promise<LedgerEntry> {
    const response = await this.rpcFetch(`${this.rpcUrl}/ledgers/${String(sequence)}`);
    return response.json() as Promise<LedgerEntry>;
  }

  private async processLedger(ledger: LedgerEntry): Promise<void> {
    for (const txHash of ledger.transactions) {
      try {
        const response = await this.rpcFetch(`${this.rpcUrl}/transactions/${txHash}`);
        const txData = (await response.json()) as { operations: unknown[] };
        console.log(`Processed tx ${txHash} with ${String(txData.operations.length)} ops`);
      } catch (error) {
        console.error(`Failed processing tx ${txHash}:`, error);
      }
    }
  }

  getSyncState(): SyncState {
    return { ...this.syncState };
  }

  private rpcFetch(url: string, init: RequestInit = {}): Promise<Response> {
    return this.tracer.traceAsync(
      'blockchain.rpcFetch',
      async () =>
        fetch(url, {
          ...init,
          headers: this.tracer.injectTraceContext({
            ...(init.headers as Record<string, string> | undefined),
          }),
        }),
      {
        [TELEMETRY_DOMAIN_ATTR]: DOMAIN_BLOCKCHAIN,
        'rpc.url': url,
      },
    );
  }
}
