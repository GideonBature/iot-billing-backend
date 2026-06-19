import {
  trace,
  context,
  propagation,
  Span,
  SpanStatusCode,
  SpanKind,
  type Context,
} from '@opentelemetry/api';
import { DOMAIN_TELEMETRY, TELEMETRY_DOMAIN_ATTR } from './sampler.js';

export class DiagnosticsTracer {
  private tracer;

  constructor(serviceName: string) {
    this.tracer = trace.getTracer(serviceName);
  }

  startSpan(
    name: string,
    attributes: Record<string, string | number | boolean> = {},
    parentContext = context.active(),
  ): Span {
    return this.tracer.startSpan(name, { attributes }, parentContext);
  }

  traceSync<T>(
    name: string,
    fn: (span: Span) => T,
    attributes: Record<string, string | number | boolean> = {},
  ): T {
    const span = this.startSpan(name, attributes);
    return context.with(trace.setSpan(context.active(), span), () => {
      try {
        const result = fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        throw error;
      } finally {
        span.end();
      }
    });
  }

  async traceAsync<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    attributes: Record<string, string | number | boolean> = {},
  ): Promise<T> {
    const span = this.startSpan(name, attributes);
    return context.with(trace.setSpan(context.active(), span), async () => {
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        throw error;
      } finally {
        span.end();
      }
    });
  }

  injectTraceContext(headers: Record<string, string>): Record<string, string> {
    const carrier: Record<string, string> = { ...headers };
    propagation.inject(context.active(), carrier);
    return carrier;
  }

  extractTraceContext(carrier: Record<string, string | undefined>): Context {
    return propagation.extract(context.active(), carrier);
  }

  startServerSpan(
    name: string,
    carrier: Record<string, string | undefined>,
    attributes: Record<string, string | number | boolean> = {},
  ): { span: Span; ctx: Context } {
    const parentContext = this.extractTraceContext(carrier);
    const span = this.tracer.startSpan(
      name,
      {
        kind: SpanKind.SERVER,
        attributes: {
          [TELEMETRY_DOMAIN_ATTR]: DOMAIN_TELEMETRY,
          ...attributes,
        },
      },
      parentContext,
    );
    const ctx = trace.setSpan(parentContext, span);
    return { span, ctx };
  }
}

let cachedTracer: DiagnosticsTracer | null = null;

export function getDiagnosticsTracer(): DiagnosticsTracer {
  cachedTracer ??= new DiagnosticsTracer(process.env['OTEL_SERVICE_NAME'] ?? 'iot-billing-backend');
  return cachedTracer;
}
