import { SorobanRpcClient } from './rpc_client.js';
import { NoncePool } from './nonce_pool.js';

export interface TransactionRecord {
  id: string;
  workerId: string;
  sequenceNumber: number;
  envelope: string;
  status: 'pending' | 'submitted' | 'confirmed' | 'failed';
  createdAt: number;
  confirmedAt?: number;
  error?: string;
}

export class TransactionManager {
  private transactions = new Map<string, TransactionRecord>();

  constructor(
    private rpcClient: SorobanRpcClient,
    private noncePool: NoncePool,
  ) {}

  async submitChargeUsage(
    workerId: string,
    deviceId: string,
    usageAmount: bigint,
    contractId: string,
  ): Promise<TransactionRecord> {
    const sequenceNumber = await this.noncePool.acquire(workerId);
    const envelope = this.buildChargeEnvelope(contractId, deviceId, usageAmount, sequenceNumber);

    const record: TransactionRecord = {
      id: crypto.randomUUID(),
      workerId,
      sequenceNumber,
      envelope,
      status: 'pending',
      createdAt: Date.now(),
    };
    this.transactions.set(record.id, record);

    try {
      await this.rpcClient.submitTransaction(envelope);
      record.status = 'submitted';
      return record;
    } catch (error) {
      record.status = 'failed';
      record.error = error instanceof Error ? error.message : String(error);
      await this.noncePool.release(workerId);
      return record;
    }
  }

  confirmTransaction(txId: string): void {
    const record = this.transactions.get(txId);
    if (!record) throw new Error(`Transaction ${txId} not found`);
    record.status = 'confirmed';
    record.confirmedAt = Date.now();
  }

  getTransaction(txId: string): TransactionRecord | undefined {
    return this.transactions.get(txId);
  }

  private buildChargeEnvelope(
    contractId: string,
    deviceId: string,
    usageAmount: bigint,
    sequenceNumber: number,
  ): string {
    return JSON.stringify({
      contractId,
      method: 'charge_usage',
      args: [deviceId, usageAmount.toString()],
      sequenceNumber,
    });
  }
}
