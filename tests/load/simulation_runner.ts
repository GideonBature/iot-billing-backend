/**
 * High-Density Concurrent Simulated Load Testing Suite
 *
 * Mocks up to 50,000 active concurrent connections delivering real-time
 * telemetry inputs for system performance auditing.
 *
 * Usage: tsx tests/load/simulation_runner.ts [concurrentClients] [durationSec]
 */

import { validateSignature, SignedPayload } from '../../src/core/ingestion/validator.js';
import nacl from 'tweetnacl';
import { Buffer } from 'node:buffer';

interface SimulationMetrics {
  totalPayloads: number;
  accepted: number;
  rejected: number;
  errors: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  throughputPerSec: number;
}

interface SimulatedDevice {
  deviceId: string;
  keyPair: nacl.SignKeyPair;
}

function generateDevice(id: number): SimulatedDevice {
  return {
    deviceId: `sim-device-${id.toString().padStart(5, '0')}`,
    keyPair: nacl.sign.keyPair(),
  };
}

function generatePayload(device: SimulatedDevice): SignedPayload {
  const base = {
    deviceId: device.deviceId,
    timestamp: Date.now(),
    nonce: crypto.randomUUID(),
    metrics: {
      energy_kwh: Math.random() * 100,
      water_l: Math.random() * 50,
      gas_m3: Math.random() * 20,
      temperature: 15 + Math.random() * 30,
    },
  };
  const message = Buffer.from(JSON.stringify(base), 'utf-8');
  const signature = Buffer.from(nacl.sign.detached(message, device.keyPair.secretKey)).toString(
    'hex',
  );
  return { ...base, signature };
}

async function simulateClient(
  device: SimulatedDevice,
  durationMs: number,
  report: (latency: number, accepted: boolean) => void,
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < durationMs) {
    try {
      const payload = generatePayload(device);
      const t0 = performance.now();
      const result = validateSignature(device.keyPair.publicKey, payload);
      const latency = performance.now() - t0;
      report(latency, result.valid);
      await new Promise((r) => setTimeout(r, 50 + Math.random() * 200));
    } catch {
      report(0, false);
    }
  }
}

async function runSimulation(
  concurrentClients: number,
  durationSec: number,
): Promise<SimulationMetrics> {
  console.log(
    `Starting simulation: ${String(concurrentClients)} clients for ${String(durationSec)}s`,
  );

  const latencies: number[] = [];
  let accepted = 0;
  let rejected = 0;
  const errors = 0;

  const report = (latency: number, accepted_: boolean): void => {
    if (latency > 0) latencies.push(latency);
    if (accepted_) accepted++;
    else rejected++;
  };

  const devices: SimulatedDevice[] = [];
  for (let i = 0; i < concurrentClients; i++) {
    devices.push(generateDevice(i));
  }

  const durationMs = durationSec * 1000;
  const startTime = Date.now();

  const workers = devices.map((device) => simulateClient(device, durationMs, report));
  await Promise.all(workers);

  const elapsedSec = (Date.now() - startTime) / 1000;
  const sortedLatencies = [...latencies].sort((a, b) => a - b);
  const n = sortedLatencies.length;
  const avgLatencyMs = n > 0 ? sortedLatencies.reduce((a, b) => a + b, 0) / n : 0;
  const p95LatencyMs = n > 0 ? (sortedLatencies[Math.floor(n * 0.95)] ?? 0) : 0;
  const p99LatencyMs = n > 0 ? (sortedLatencies[Math.floor(n * 0.99)] ?? 0) : 0;

  return {
    totalPayloads: accepted + rejected + errors,
    accepted,
    rejected,
    errors,
    avgLatencyMs,
    p95LatencyMs,
    p99LatencyMs,
    throughputPerSec: elapsedSec > 0 ? (accepted + rejected) / elapsedSec : 0,
  };
}

const concurrentClients = Number(process.argv[2]) || 1000;
const durationSec = Number(process.argv[3]) || 30;

runSimulation(concurrentClients, durationSec)
  .then((metrics) => {
    console.log('\n=== SIMULATION RESULTS ===');
    console.log(JSON.stringify(metrics, null, 2));
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error('Simulation failed:', err);
    process.exit(1);
  });

export { runSimulation };
