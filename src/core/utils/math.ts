export const SafeMath = {
  SOROBAN_DECIMALS: 7,
  MAX_SOROBAN_VALUE: 2n ** 63n - 1n,
  MIN_SOROBAN_VALUE: -(2n ** 63n),

  toSorobanPrecision(rawValue: bigint, sourceDecimals: number): bigint {
    if (sourceDecimals === this.SOROBAN_DECIMALS) return rawValue;
    if (sourceDecimals > this.SOROBAN_DECIMALS) {
      return rawValue / 10n ** BigInt(sourceDecimals - this.SOROBAN_DECIMALS);
    }
    return rawValue * 10n ** BigInt(this.SOROBAN_DECIMALS - sourceDecimals);
  },

  multiplyWithPrecision(a: bigint, b: bigint, precisionDecimals: number): bigint {
    const product = a * b;
    const divisor = 10n ** BigInt(precisionDecimals);
    return product / divisor;
  },

  checkOverflow(value: bigint): boolean {
    if (value > this.MAX_SOROBAN_VALUE || value < this.MIN_SOROBAN_VALUE) {
      return true;
    }
    return false;
  },

  safeAdd(a: bigint, b: bigint): bigint {
    const result = a + b;
    if (this.checkOverflow(result)) {
      throw new RangeError(`Integer overflow in addition: ${String(a)} + ${String(b)}`);
    }
    return result;
  },

  safeMultiply(a: bigint, b: bigint): bigint {
    const result = a * b;
    if (this.checkOverflow(result)) {
      throw new RangeError(`Integer overflow in multiplication: ${String(a)} * ${String(b)}`);
    }
    return result;
  },
} as const;
