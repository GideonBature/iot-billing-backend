interface SorobanTransactionData {
  contractId: string;
  functionName: string;
  args: unknown[];
  footprint?: {
    readOnly: string[];
    readWrite: string[];
  };
}

interface FeeEstimate {
  resourceFee: number;
  minFee: number;
  maxFee: number;
  recommendedFee: number;
}

export class FeeOptimizer {
  private baseFee = 100;
  private resourceMultiplier = 1.2;

  preFlightSimulate(txData: SorobanTransactionData): FeeEstimate {
    const ledgerResources = this.simulateLedgerFootprint(txData);
    const resourceFee = this.calculateResourceFee(ledgerResources);
    const minFee = resourceFee;
    const maxFee = Math.floor(resourceFee * 3);
    const recommendedFee = Math.floor(resourceFee * this.resourceMultiplier);

    return {
      resourceFee,
      minFee,
      maxFee,
      recommendedFee,
    };
  }

  optimizeFootprint(txData: SorobanTransactionData): SorobanTransactionData {
    const optimized: SorobanTransactionData = {
      ...txData,
      footprint: {
        readOnly: this.deduplicateKeys(txData.footprint?.readOnly ?? []),
        readWrite: this.deduplicateKeys(txData.footprint?.readWrite ?? []),
      },
    };
    return optimized;
  }

  private simulateLedgerFootprint(_txData: SorobanTransactionData): {
    entriesRead: number;
    entriesWritten: number;
    bytesRead: number;
    bytesWritten: number;
  } {
    return {
      entriesRead: _txData.footprint?.readOnly.length ?? 0,
      entriesWritten: _txData.footprint?.readWrite.length ?? 0,
      bytesRead: (_txData.footprint?.readOnly.length ?? 0) * 64,
      bytesWritten: (_txData.footprint?.readWrite.length ?? 0) * 64,
    };
  }

  private calculateResourceFee(resources: {
    entriesRead: number;
    entriesWritten: number;
    bytesRead: number;
    bytesWritten: number;
  }): number {
    const entryFee = (resources.entriesRead + resources.entriesWritten) * this.baseFee;
    const byteFee = Math.ceil((resources.bytesRead + resources.bytesWritten) / 1024) * this.baseFee;
    return entryFee + byteFee;
  }

  private deduplicateKeys(keys: string[]): string[] {
    return [...new Set(keys)];
  }
}
