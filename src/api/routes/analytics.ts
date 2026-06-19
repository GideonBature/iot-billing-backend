import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getTimescalePool } from '../../database/pool_manager.js';
import { verifyJwt } from '../middleware/auth.js';

interface AnalyticsQuery {
  deviceId: string;
  start: string;
  end: string;
}

export function registerAnalyticsRoutes(app: FastifyInstance): void {
  /**
   * GET /api/analytics/telemetry
   * Retrieve aggregated telemetry data using the smallest granularity satisfying the time range.
   */
  app.get<{ Querystring: AnalyticsQuery }>(
    '/api/analytics/telemetry',
    {
      preHandler: verifyJwt,
      schema: {
        querystring: {
          type: 'object',
          required: ['deviceId', 'start', 'end'],
          properties: {
            deviceId: { type: 'string' },
            start: { type: 'string', format: 'date-time' },
            end: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: AnalyticsQuery }>, reply: FastifyReply) => {
      const { deviceId, start, end } = request.query;

      const startDate = new Date(start);
      const endDate = new Date(end);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        await reply.status(400).send({
          error: 'Bad Request',
          message: 'Invalid start or end date format',
        });
        return;
      }

      if (startDate > endDate) {
        await reply.status(400).send({
          error: 'Bad Request',
          message: 'Start date must be before end date',
        });
        return;
      }

      const rangeMs = endDate.getTime() - startDate.getTime();
      const rangeDays = rangeMs / (1000 * 60 * 60 * 24);

      // Select the smallest aggregate view satisfying the time range
      let viewName = 'monthly_device_usage';
      if (rangeDays <= 0.25) {
        // <= 6 hours
        viewName = 'fifteen_minute_device_usage';
      } else if (rangeDays <= 3) {
        // <= 3 days
        viewName = 'hourly_device_usage';
      } else if (rangeDays <= 30) {
        // <= 30 days
        viewName = 'daily_device_usage';
      } else if (rangeDays <= 120) {
        // <= 120 days
        viewName = 'weekly_device_usage';
      }

      const pool = getTimescalePool();
      try {
        const query = `
          SELECT 
            bucket,
            device_id AS "deviceId",
            sample_count AS "sampleCount",
            total_value AS "totalValue",
            avg_value AS "avgValue",
            min_value AS "minValue",
            max_value AS "maxValue",
            _aggregate_watermark AS "aggregateWatermark"
          FROM ${viewName}
          WHERE device_id = $1 AND bucket >= $2 AND bucket <= $3
          ORDER BY bucket ASC
        `;

        const result = await pool.query(query, [deviceId, startDate, endDate]);
        await reply.send({
          viewUsed: viewName,
          rangeDays,
          data: result.rows,
        });
        return;
      } catch (error) {
        request.log.error(error as Error, 'Analytics query failed');
        await reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to retrieve telemetry analytics',
        });
        return;
      }
    },
  );
}
