import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { context, SpanStatusCode } from '@opentelemetry/api';
import type { Span, Context } from '@opentelemetry/api';
import { getDiagnosticsTracer } from '../../core/diagnostics/tracer.js';

declare module 'fastify' {
  interface FastifyRequest {
    otelSpan?: Span;
    otelContext?: Context;
  }
}

function getTraceCarrier(request: FastifyRequest): Record<string, string | undefined> {
  return {
    traceparent:
      typeof request.headers['traceparent'] === 'string'
        ? request.headers['traceparent']
        : undefined,
    tracestate:
      typeof request.headers['tracestate'] === 'string' ? request.headers['tracestate'] : undefined,
  };
}

export function registerTracingHooks(app: FastifyInstance): void {
  const tracer = getDiagnosticsTracer();

  app.addHook('onRequest', (request, _reply, done) => {
    const route = request.routeOptions.url ?? request.url;
    const { span, ctx } = tracer.startServerSpan(
      `${request.method} ${route}`,
      getTraceCarrier(request),
      {
        'http.method': request.method,
        'http.route': route,
        'http.url': request.url,
      },
    );

    request.otelSpan = span;
    request.otelContext = ctx;
    context.with(ctx, () => {
      done();
    });
  });

  app.addHook('onResponse', (request: FastifyRequest, reply: FastifyReply, done) => {
    const span = request.otelSpan;
    if (!span) {
      done();
      return;
    }

    span.setAttribute('http.status_code', reply.statusCode);
    if (reply.statusCode >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${String(reply.statusCode)}` });
    }
    span.end();
    done();
  });
}
