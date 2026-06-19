import nacl from 'tweetnacl';
import { Buffer } from 'node:buffer';
import { getDiagnosticsTracer } from '../diagnostics/tracer.js';
import { DOMAIN_TELEMETRY, TELEMETRY_DOMAIN_ATTR } from '../diagnostics/sampler.js';
import { refreshAggregatesAdaptively } from '../../database/pool_manager.js';

export interface SignedPayload {
  deviceId: string;
  timestamp: number;
  nonce: string;
  metrics: Record<string, number | string>;
  signature: string;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

const NONCE_CACHE = new Set<string>();
const NONCE_WINDOW_MS = 5000;

setInterval(() => {
  NONCE_CACHE.clear();
}, NONCE_WINDOW_MS);

let validatedCount = 0;

export function getValidatedCount(): number {
  return validatedCount;
}

export function resetValidatedCount(): void {
  validatedCount = 0;
}

function incrementValidationCount(): void {
  validatedCount++;
  if (validatedCount >= 10000) {
    validatedCount = 0;
    void refreshAggregatesAdaptively().catch((err: unknown) => {
      console.error('Failed to trigger adaptive refresh from validator:', err);
    });
  }
}

export function validateSignature(publicKey: Uint8Array, payload: SignedPayload): ValidationResult {
  const tracer = getDiagnosticsTracer();

  return tracer.traceSync(
    'ingestion.validateSignature',
    (span) => {
      span.setAttributes({
        [TELEMETRY_DOMAIN_ATTR]: DOMAIN_TELEMETRY,
        'device.id': payload.deviceId,
        'payload.nonce': payload.nonce,
      });

      const { signature, ...rest } = payload;
      const message = Buffer.from(JSON.stringify(rest), 'utf-8');
      const sigBytes = Buffer.from(signature, 'hex');

      if (sigBytes.length !== 64) {
        span.setAttribute('validation.result', 'invalid_signature_length');
        return { valid: false, reason: 'Invalid signature length' };
      }

      const now = Date.now();
      if (Math.abs(now - payload.timestamp) > NONCE_WINDOW_MS) {
        span.setAttribute('validation.result', 'stale_timestamp');
        return { valid: false, reason: 'Timestamp outside sliding window' };
      }

      if (NONCE_CACHE.has(payload.nonce)) {
        span.setAttribute('validation.result', 'replay_detected');
        return { valid: false, reason: 'Nonce already consumed (replay detected)' };
      }

      const verified = nacl.sign.detached.verify(message, sigBytes, publicKey);
      if (!verified) {
        span.setAttribute('validation.result', 'signature_mismatch');
        return { valid: false, reason: 'Ed25519 signature mismatch' };
      }

      NONCE_CACHE.add(payload.nonce);
      span.setAttribute('validation.result', 'valid');

      incrementValidationCount();

      return { valid: true };
    },
    { [TELEMETRY_DOMAIN_ATTR]: DOMAIN_TELEMETRY },
  );
}
