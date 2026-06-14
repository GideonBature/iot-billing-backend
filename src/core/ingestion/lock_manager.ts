import pg from 'pg';

export class AdvisoryLockManager {
  private pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async acquireLock(deviceId: string, _timeoutMs = 5000): Promise<boolean> {
    const client: pg.PoolClient = await this.pool.connect();
    try {
      const lockId = this.hashDeviceId(deviceId);
      const result = await client.query<{ locked: boolean }>(
        `SELECT pg_try_advisory_lock($1) AS locked`,
        [lockId],
      );
      return result.rows[0]?.locked === true;
    } finally {
      client.release();
    }
  }

  async releaseLock(deviceId: string): Promise<void> {
    const client: pg.PoolClient = await this.pool.connect();
    try {
      const lockId = this.hashDeviceId(deviceId);
      await client.query(`SELECT pg_advisory_unlock($1)`, [lockId]);
    } finally {
      client.release();
    }
  }

  private hashDeviceId(deviceId: string): number {
    let hash = 0;
    for (let i = 0; i < deviceId.length; i++) {
      const chr = deviceId.charCodeAt(i);
      hash = (hash << 5) - hash + chr;
      hash |= 0;
    }
    return Math.abs(hash);
  }
}
