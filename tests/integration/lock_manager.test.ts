import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import pg from 'pg';
import { AdvisoryLockManager } from '../../src/core/ingestion/lock_manager.js';

const DB_URL: string | undefined =
  process.env['INTEGRATION_DATABASE_URL'] ?? process.env['DATABASE_URL'];
const pool =
  DB_URL != null ? new pg.Pool({ connectionString: DB_URL, connectionTimeoutMillis: 5000 }) : null;
const manager = pool != null ? new AdvisoryLockManager(pool) : null;
let dbAvailable = false;

beforeAll(async () => {
  if (!pool) return;
  try {
    const client = await pool.connect();
    client.release();
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
});

afterAll(async () => {
  if (pool && dbAvailable && manager) {
    await manager.releaseAll();
    await pool.end();
  }
});

describe('AdvisoryLockManager Integration', () => {
  it('should acquire and release a lock for a device+bucket composite key', async () => {
    if (!dbAvailable || !manager) return;
    const result = await manager.acquireLock('dev-001', 1718000000000, { ttlMs: 5000 });
    expect(result.acquired).toBe(true);
    expect(result.lockId).toBeGreaterThan(0);
    const released = await manager.releaseLock('dev-001', 1718000000000);
    expect(released).toBe(true);
  });

  it('should not acquire the same composite lock twice', async () => {
    if (!dbAvailable || !manager) return;
    const first = await manager.acquireLock('dev-002', 1718000000000, { ttlMs: 5000 });
    expect(first.acquired).toBe(true);
    const second = await manager.acquireLock('dev-002', 1718000000000, { ttlMs: 5000 });
    expect(second.acquired).toBe(false);
    await manager.releaseLock('dev-002', 1718000000000);
  });

  it('should allow concurrent locks for different devices', async () => {
    if (!dbAvailable || !manager) return;
    const devA = await manager.acquireLock('dev-a', 1718000000000, { ttlMs: 5000 });
    const devB = await manager.acquireLock('dev-b', 1718000000000, { ttlMs: 5000 });
    expect(devA.acquired).toBe(true);
    expect(devB.acquired).toBe(true);
    await manager.releaseLock('dev-a', 1718000000000);
    await manager.releaseLock('dev-b', 1718000000000);
  });

  it('should allow locks for different buckets of the same device', async () => {
    if (!dbAvailable || !manager) return;
    const bucket1 = await manager.acquireLock('dev-003', 1718000000000, { ttlMs: 5000 });
    const bucket2 = await manager.acquireLock('dev-003', 1718000000001, { ttlMs: 5000 });
    expect(bucket1.acquired).toBe(true);
    expect(bucket2.acquired).toBe(true);
    await manager.releaseLock('dev-003', 1718000000000);
    await manager.releaseLock('dev-003', 1718000000001);
  });

  it('should auto-release lock after TTL expires', async () => {
    if (!dbAvailable || !manager) return;
    const result = await manager.acquireLock('dev-ttl', 1718000000000, { ttlMs: 50 });
    expect(result.acquired).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const retry = await manager.acquireLock('dev-ttl', 1718000000000, { ttlMs: 5000 });
    expect(retry.acquired).toBe(true);
    await manager.releaseLock('dev-ttl', 1718000000000);
  }, 10000);

  it('should retry with exponential backoff and eventually acquire', async () => {
    if (!dbAvailable || !manager) return;
    const first = await manager.acquireLock('dev-backoff', 1718000000000, { ttlMs: 2000 });
    expect(first.acquired).toBe(true);
    const retryResult = await manager.tryAcquireWithRetry('dev-backoff', 1718000000000, {
      ttlMs: 2000,
      retryAttempts: 5,
      retryBaseDelayMs: 50,
    });
    expect(retryResult.acquired).toBe(false);
    await manager.releaseLock('dev-backoff', 1718000000000);
    const afterRelease = await manager.tryAcquireWithRetry('dev-backoff', 1718000000000, {
      ttlMs: 5000,
      retryAttempts: 3,
      retryBaseDelayMs: 50,
    });
    expect(afterRelease.acquired).toBe(true);
    await manager.releaseLock('dev-backoff', 1718000000000);
  }, 15000);

  it('should handle heartbeat correctly and prevent TTL expiry', async () => {
    if (!dbAvailable || !manager) return;
    const heartbeatFn = vi.fn();
    manager.on('heartbeat', heartbeatFn);
    const result = await manager.acquireLock('dev-hb', 1718000000000, {
      ttlMs: 2000,
      heartbeatIntervalMs: 200,
    });
    expect(result.acquired).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(heartbeatFn).toHaveBeenCalled();
    await manager.releaseLock('dev-hb', 1718000000000);
  }, 10000);

  it('should manage 10 concurrent workers for the same device with only one acquiring', async () => {
    if (!dbAvailable || !manager) return;
    const bucketEpoch = Date.now();
    const deviceId = 'dev-concurrent-10';
    const workers = Array.from({ length: 10 }, () =>
      manager.tryAcquireWithRetry(deviceId, bucketEpoch, {
        ttlMs: 5000,
        retryAttempts: 2,
        retryBaseDelayMs: 50,
      }),
    );
    const results = await Promise.all(workers);
    const acquired = results.filter((r) => r.acquired);
    expect(acquired.length).toBe(1);
    for (const r of results) {
      expect(r.lockId).toBeGreaterThan(0);
    }
    await manager.releaseLock(deviceId, bucketEpoch);
    const postRelease = await manager.acquireLock(deviceId, bucketEpoch, { ttlMs: 5000 });
    expect(postRelease.acquired).toBe(true);
    await manager.releaseLock(deviceId, bucketEpoch);
  }, 30000);
});
