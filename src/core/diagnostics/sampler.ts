import type { Context, Link, SpanKind, Attributes } from '@opentelemetry/api';
import {
  SamplingDecision,
  type SamplingResult,
  type Sampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';

export const TELEMETRY_DOMAIN_ATTR = 'telemetry.domain';
export const DOMAIN_BLOCKCHAIN = 'blockchain';
export const DOMAIN_TELEMETRY = 'telemetry';

const TELEMETRY_SAMPLE_RATIO = 0.01;
const telemetrySampler = new TraceIdRatioBasedSampler(TELEMETRY_SAMPLE_RATIO);

function getDomain(attributes: Attributes): string | undefined {
  const value = attributes[TELEMETRY_DOMAIN_ATTR];
  return typeof value === 'string' ? value : undefined;
}

export class DomainAwareSampler implements Sampler {
  shouldSample(
    context: Context,
    traceId: string,
    spanName: string,
    spanKind: SpanKind,
    attributes: Attributes,
    _links: Link[],
  ): SamplingResult {
    const domain = getDomain(attributes);

    if (domain === DOMAIN_BLOCKCHAIN) {
      return { decision: SamplingDecision.RECORD_AND_SAMPLED };
    }

    return telemetrySampler.shouldSample(context, traceId);
  }

  toString(): string {
    return `DomainAwareSampler{blockchain=100%, telemetry=${String(TELEMETRY_SAMPLE_RATIO * 100)}%}`;
  }
}
