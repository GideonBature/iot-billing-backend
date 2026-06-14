export interface DeviceProfile {
  deviceId: string;
  billingTier: 'free' | 'standard' | 'enterprise';
  historicalCompliance: number;
  currentBalance: bigint;
}

interface RateLimitConfig {
  points: number;
  durationMs: number;
  blockDurationMs: number;
}

const TIER_LIMITS: Record<string, RateLimitConfig | undefined> = {
  free: { points: 10, durationMs: 1000, blockDurationMs: 30000 },
  standard: { points: 100, durationMs: 1000, blockDurationMs: 10000 },
  enterprise: { points: 500, durationMs: 1000, blockDurationMs: 5000 },
};

export class DynamicRateLimiter {
  private requestCounts = new Map<
    string,
    { count: number; resetAt: number; blockedUntil: number }
  >();

  checkLimit(deviceProfile: DeviceProfile): boolean {
    const now = Date.now();
    const config = TIER_LIMITS[deviceProfile.billingTier] ?? TIER_LIMITS['free'];

    const entry = this.requestCounts.get(deviceProfile.deviceId);

    if (entry) {
      if (entry.blockedUntil > now) return false;
      if (entry.resetAt < now) {
        this.requestCounts.set(deviceProfile.deviceId, {
          count: 1,
          resetAt: now + (config?.durationMs ?? 1000),
          blockedUntil: 0,
        });
        return true;
      }
      entry.count += 1;
      if (entry.count > (config?.points ?? 10)) {
        entry.blockedUntil = now + (config?.blockDurationMs ?? 30000);
        return false;
      }
      return true;
    }

    this.requestCounts.set(deviceProfile.deviceId, {
      count: 1,
      resetAt: now + (config?.durationMs ?? 1000),
      blockedUntil: 0,
    });
    return true;
  }

  reset(deviceId: string): void {
    this.requestCounts.delete(deviceId);
  }
}
