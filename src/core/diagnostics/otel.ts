import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { BatchSpanProcessor, ParentBasedSampler } from '@opentelemetry/sdk-trace-base';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { getEnv } from '../../config/env.js';
import { DomainAwareSampler } from './sampler.js';

let sdk: NodeSDK | null = null;

export function initTelemetry(): NodeSDK | null {
  if (sdk) return sdk;

  const env = getEnv();
  if (env.OTEL_EXPORTER_OTLP_ENDPOINT === undefined || env.OTEL_EXPORTER_OTLP_ENDPOINT === '') {
    return null;
  }

  sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: env.OTEL_SERVICE_NAME,
    }),
    spanProcessor: new BatchSpanProcessor(
      new OTLPTraceExporter({ url: env.OTEL_EXPORTER_OTLP_ENDPOINT }),
      {
        scheduledDelayMillis: 5000,
        exportTimeoutMillis: 10000,
        maxExportBatchSize: 512,
      },
    ),
    sampler: new ParentBasedSampler({ root: new DomainAwareSampler() }),
    instrumentations: [new PgInstrumentation()],
  });

  sdk.start();
  return sdk;
}

export async function shutdownTelemetry(): Promise<void> {
  if (!sdk) return;
  await sdk.shutdown();
  sdk = null;
}
