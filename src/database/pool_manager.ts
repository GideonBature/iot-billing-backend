import pg from 'pg';

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
