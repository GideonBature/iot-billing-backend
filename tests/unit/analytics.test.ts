import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { registerAnalyticsRoutes } from '../../src/api/routes/analytics.js';
import {
  validateSignature,
  SignedPayload,
  resetValidatedCount,
  getValidatedCount,
} from '../../src/core/ingestion/validator.js';
import * as poolManager from '../../src/database/pool_manager.js';
import nacl from 'tweetnacl';
import { Buffer } from 'node:buffer';
import pg from 'pg';

// Mock the verification middleware for simpler routing test
vi.mock('../../src/api/middleware/auth.js', () => ({
  verifyJwt: async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const req = request as unknown as { user?: { address: string } };
    req.user = { address: 'GABCDEF123' };
    await Promise.resolve();
  },
}));

// Mock pool manager functions to prevent real DB queries in unit tests
const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
vi.spyOn(poolManager, 'getTimescalePool').mockReturnValue({
  query: mockQuery as unknown as pg.Pool['query'],
} as unknown as pg.Pool);

const mockRefresh = vi.spyOn(poolManager, 'refreshAggregatesAdaptively').mockResolvedValue();

interface AnalyticsResponseBody {
  viewUsed: string;
  rangeDays: number;
  data: unknown[];
}

function createSignedPayload(overrides: Partial<SignedPayload> = {}): {
  payload: SignedPayload;
  publicKey: Uint8Array;
} {
  const keyPair = nacl.sign.keyPair();
  const base: Omit<SignedPayload, 'signature'> = {
    deviceId: 'dev-001',
    timestamp: Date.now(),
    nonce: crypto.randomUUID(),
    metrics: { energy_kwh: 1.5 },
    ...overrides,
  };
  const message = Buffer.from(JSON.stringify(base), 'utf-8');
  const signature = Buffer.from(nacl.sign.detached(message, keyPair.secretKey)).toString('hex');
  return { payload: { ...base, signature }, publicKey: keyPair.publicKey };
}

describe('Analytics API and Ingestion Trigger', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = Fastify();
    registerAnalyticsRoutes(app);
    mockQuery.mockClear();
    mockRefresh.mockClear();
    resetValidatedCount();
  });

  describe('GET /api/analytics/telemetry view resolution', () => {
    it('should select fifteen_minute_device_usage for range <= 6 hours', async () => {
      const start = new Date('2026-06-20T00:00:00Z').toISOString();
      const end = new Date('2026-06-20T05:00:00Z').toISOString(); // 5 hours

      const response = await app.inject({
        method: 'GET',
        url: `/api/analytics/telemetry?deviceId=dev-001&start=${start}&end=${end}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as AnalyticsResponseBody;
      expect(body.viewUsed).toBe('fifteen_minute_device_usage');
      expect(mockQuery).toHaveBeenCalled();
      const sqlCall = mockQuery.mock.calls[0]?.[0] as string | undefined;
      expect(sqlCall).toContain('fifteen_minute_device_usage');
    });

    it('should select hourly_device_usage for range <= 3 days', async () => {
      const start = new Date('2026-06-20T00:00:00Z').toISOString();
      const end = new Date('2026-06-22T00:00:00Z').toISOString(); // 2 days

      const response = await app.inject({
        method: 'GET',
        url: `/api/analytics/telemetry?deviceId=dev-001&start=${start}&end=${end}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as AnalyticsResponseBody;
      expect(body.viewUsed).toBe('hourly_device_usage');
      const sqlCall = mockQuery.mock.calls[0]?.[0] as string | undefined;
      expect(sqlCall).toContain('hourly_device_usage');
    });

    it('should select daily_device_usage for range <= 30 days', async () => {
      const start = new Date('2026-06-01T00:00:00Z').toISOString();
      const end = new Date('2026-06-20T00:00:00Z').toISOString(); // 19 days

      const response = await app.inject({
        method: 'GET',
        url: `/api/analytics/telemetry?deviceId=dev-001&start=${start}&end=${end}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as AnalyticsResponseBody;
      expect(body.viewUsed).toBe('daily_device_usage');
      const sqlCall = mockQuery.mock.calls[0]?.[0] as string | undefined;
      expect(sqlCall).toContain('daily_device_usage');
    });

    it('should select weekly_device_usage for range <= 120 days', async () => {
      const start = new Date('2026-03-01T00:00:00Z').toISOString();
      const end = new Date('2026-06-20T00:00:00Z').toISOString(); // 111 days

      const response = await app.inject({
        method: 'GET',
        url: `/api/analytics/telemetry?deviceId=dev-001&start=${start}&end=${end}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as AnalyticsResponseBody;
      expect(body.viewUsed).toBe('weekly_device_usage');
      const sqlCall = mockQuery.mock.calls[0]?.[0] as string | undefined;
      expect(sqlCall).toContain('weekly_device_usage');
    });

    it('should select monthly_device_usage for range > 120 days', async () => {
      const start = new Date('2025-06-20T00:00:00Z').toISOString();
      const end = new Date('2026-06-20T00:00:00Z').toISOString(); // 365 days

      const response = await app.inject({
        method: 'GET',
        url: `/api/analytics/telemetry?deviceId=dev-001&start=${start}&end=${end}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as AnalyticsResponseBody;
      expect(body.viewUsed).toBe('monthly_device_usage');
      const sqlCall = mockQuery.mock.calls[0]?.[0] as string | undefined;
      expect(sqlCall).toContain('monthly_device_usage');
    });

    it('should reject invalid query formats', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/analytics/telemetry?deviceId=dev-001&start=invalid&end=2026-06-20T00:00:00Z',
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject when start date is after end date', async () => {
      const start = new Date('2026-06-21T00:00:00Z').toISOString();
      const end = new Date('2026-06-20T00:00:00Z').toISOString();

      const response = await app.inject({
        method: 'GET',
        url: `/api/analytics/telemetry?deviceId=dev-001&start=${start}&end=${end}`,
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('Validator 10k Ingestion Trigger', () => {
    it('should increment validation count on successful validation', () => {
      const { payload, publicKey } = createSignedPayload();
      const result = validateSignature(publicKey, payload);
      expect(result.valid).toBe(true);
      expect(getValidatedCount()).toBe(1);
      expect(mockRefresh).not.toHaveBeenCalled();
    });

    it('should trigger adaptive refresh once count reaches 10,000', () => {
      const verifySpy = vi.spyOn(nacl.sign.detached, 'verify').mockReturnValue(true);
      const { payload, publicKey } = createSignedPayload();

      // Simulate 9999 successful validations
      for (let i = 0; i < 9999; i++) {
        // Mock nonce and timestamp to avoid replay or stale rejection
        payload.nonce = `nonce-${i.toString()}`;
        payload.timestamp = Date.now();
        const result = validateSignature(publicKey, payload);
        expect(result.valid).toBe(true);
      }
      expect(getValidatedCount()).toBe(9999);
      expect(mockRefresh).not.toHaveBeenCalled();

      // The 10,000th validation triggers adaptive refresh
      payload.nonce = 'final-nonce';
      payload.timestamp = Date.now();
      const finalResult = validateSignature(publicKey, payload);
      expect(finalResult.valid).toBe(true);
      expect(getValidatedCount()).toBe(0); // resets
      expect(mockRefresh).toHaveBeenCalledTimes(1);

      verifySpy.mockRestore();
    });
  });
});
