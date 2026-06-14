import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { getEnv } from '../config/env.js';

export async function buildApp(): Promise<FastifyInstance> {
  const env = getEnv();

  const app = Fastify({
    logger: true,
    bodyLimit: env.MAX_PAYLOAD_SIZE_BYTES,
  });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  app.get('/health', () => {
    return { status: 'ok', timestamp: Date.now() };
  });

  return app;
}

async function start(): Promise<void> {
  const env = getEnv();
  const app = await buildApp();

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    console.log(`Server running on ${env.HOST}:${String(env.PORT)}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void start();
