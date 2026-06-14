import { Mutex } from 'async-mutex';

interface NonceEntry {
  sequenceNumber: number;
  reserved: boolean;
  acquiredAt: number;
}

export class NoncePool {
  private nonces = new Map<string, NonceEntry>();
  private mutex = new Mutex();
  private seqCounter = 0;

  async acquire(workerId: string): Promise<number> {
    const release = await this.mutex.acquire();
    try {
      this.seqCounter += 1;
      const seq = this.seqCounter;
      this.nonces.set(workerId, {
        sequenceNumber: seq,
        reserved: true,
        acquiredAt: Date.now(),
      });
      return seq;
    } finally {
      release();
    }
  }

  async release(workerId: string): Promise<void> {
    const release = await this.mutex.acquire();
    try {
      this.nonces.delete(workerId);
    } finally {
      release();
    }
  }

  async resetCounter(newSeq: number): Promise<void> {
    const release = await this.mutex.acquire();
    try {
      this.seqCounter = newSeq;
    } finally {
      release();
    }
  }

  getCurrentSequence(): number {
    return this.seqCounter;
  }

  getActiveCount(): number {
    return this.nonces.size;
  }
}
