import pg from 'pg';
import { getEnv } from '../config/env.js';

interface PoolMetrics {
  totalConnections: number;
  idleConnections: number;
  waitingClients: number;
  utilization: number;
}

export class ElasticPoolManager {
  private pools = new Map<string, pg.Pool>();
  private minConnections = 2;
  private maxConnections = 20;

  createPool(name: string, config: pg.PoolConfig): pg.Pool {
    const pool = new pg.Pool({
      min: this.minConnections,
      max: this.maxConnections,
      ...config,
    });

    pool.on('error', (err: Error) => {
      console.error(`Pool "${name}" error:`, err);
    });

    this.pools.set(name, pool);
    return pool;
  }

  getPool(name: string): pg.Pool | undefined {
    return this.pools.get(name);
  }

  getMetrics(name: string): PoolMetrics {
    const pool = this.pools.get(name);
    if (!pool) throw new Error(`Pool "${name}" not found`);

    const total = pool.totalCount;
    const idle = pool.idleCount;
    const waiting = pool.waitingCount;
    const utilization = total > 0 ? (total - idle) / total : 0;

    return {
      totalConnections: total,
      idleConnections: idle,
      waitingClients: waiting,
      utilization,
    };
  }

  async drainAll(): Promise<void> {
    for (const [name, pool] of this.pools) {
      await pool.end();
      console.log(`Pool "${name}" drained`);
    }
    this.pools.clear();
  }

  adjustPoolSize(name: string, min: number, max: number): void {
    const pool = this.pools.get(name);
    if (!pool) throw new Error(`Pool "${name}" not found`);
    this.minConnections = min;
    this.maxConnections = max;
  }
}

let cachedTimescalePool: pg.Pool | null = null;

export function getTimescalePool(): pg.Pool {
  if (cachedTimescalePool !== null) {
    return cachedTimescalePool;
  }
  const env = getEnv();
  cachedTimescalePool = new pg.Pool({
    connectionString: env.TIMESCALEDB_URL,
    min: 2,
    max: 20,
  });
  cachedTimescalePool.on('error', (err: Error) => {
    console.error('TimescaleDB pool error:', err.message);
  });
  return cachedTimescalePool;
}

export async function closeTimescalePool(): Promise<void> {
  if (cachedTimescalePool === null) {
    return;
  }
  await cachedTimescalePool.end();
  cachedTimescalePool = null;
}

let lastRefreshTime = new Date(Date.now() - 60000);

interface AlignedRanges {
  min_15m: Date | null;
  max_15m: Date | null;
  min_1h: Date | null;
  max_1h: Date | null;
  min_1d: Date | null;
  max_1d: Date | null;
  min_1w: Date | null;
  max_1w: Date | null;
  min_1m: Date | null;
  max_1m: Date | null;
}

export async function refreshAggregatesAdaptively(): Promise<void> {
  const pool = getTimescalePool();
  let client: pg.PoolClient | null = null;
  try {
    client = await pool.connect();

    // Find bucket-aligned min and max times of raw telemetry ingested since last refresh
    const query = `
      SELECT
        time_bucket('15 minutes', MIN(time)) AS min_15m,
        time_bucket('15 minutes', MAX(time)) + INTERVAL '15 minutes' AS max_15m,
        time_bucket('1 hour', MIN(time)) AS min_1h,
        time_bucket('1 hour', MAX(time)) + INTERVAL '1 hour' AS max_1h,
        time_bucket('1 day', MIN(time)) AS min_1d,
        time_bucket('1 day', MAX(time)) + INTERVAL '1 day' AS max_1d,
        time_bucket('1 week', MIN(time)) AS min_1w,
        time_bucket('1 week', MAX(time)) + INTERVAL '1 week' AS max_1w,
        time_bucket('1 month', MIN(time)) AS min_1m,
        time_bucket('1 month', MAX(time)) + INTERVAL '1 month' AS max_1m
      FROM telemetry
      WHERE ingested_at >= $1
    `;
    const res = await client.query<AlignedRanges>(query, [lastRefreshTime]);
    const row = res.rows[0];

    if (!row) {
      return;
    }

    if (row.min_15m !== null && row.max_15m !== null) {
      lastRefreshTime = new Date();

      await client.query('CALL refresh_continuous_aggregate($1, $2, $3)', [
        'fifteen_minute_device_usage',
        row.min_15m,
        row.max_15m,
      ]);

      if (row.min_1h !== null && row.max_1h !== null) {
        await client.query('CALL refresh_continuous_aggregate($1, $2, $3)', [
          'hourly_device_usage',
          row.min_1h,
          row.max_1h,
        ]);
      }
      if (row.min_1d !== null && row.max_1d !== null) {
        await client.query('CALL refresh_continuous_aggregate($1, $2, $3)', [
          'daily_device_usage',
          row.min_1d,
          row.max_1d,
        ]);
      }
      if (row.min_1w !== null && row.max_1w !== null) {
        await client.query('CALL refresh_continuous_aggregate($1, $2, $3)', [
          'weekly_device_usage',
          row.min_1w,
          row.max_1w,
        ]);
      }
      if (row.min_1m !== null && row.max_1m !== null) {
        await client.query('CALL refresh_continuous_aggregate($1, $2, $3)', [
          'monthly_device_usage',
          row.min_1m,
          row.max_1m,
        ]);
      }
    }
  } catch (error) {
    console.error('Failed to adaptively refresh continuous aggregates:', error);
  } finally {
    if (client) {
      client.release();
    }
  }
}

export class TelemetryNotificationListener {
  private client: pg.PoolClient | null = null;
  private isRunning = false;

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    await this.connectAndListen();
  }

  private async connectAndListen(): Promise<void> {
    if (!this.isRunning) return;
    const pool = getTimescalePool();
    try {
      this.client = await pool.connect();

      this.client.on('notification', (msg) => {
        if (msg.channel === 'telemetry_inserts') {
          void refreshAggregatesAdaptively();
        }
      });

      this.client.on('error', () => {
        this.reconnect();
      });

      await this.client.query('LISTEN telemetry_inserts');
    } catch (error) {
      console.error('Failed to establish database listener:', error);
      this.reconnect();
    }
  }

  private reconnect(): void {
    if (this.client) {
      try {
        this.client.release();
      } catch (err) {
        console.error('Error releasing listener client:', err);
      }
      this.client = null;
    }
    if (this.isRunning) {
      setTimeout(() => void this.connectAndListen(), 5000);
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.client) {
      try {
        await this.client.query('UNLISTEN telemetry_inserts');
        this.client.release();
      } catch (err) {
        console.error('Error stopping listener:', err);
      }
      this.client = null;
    }
  }
}
