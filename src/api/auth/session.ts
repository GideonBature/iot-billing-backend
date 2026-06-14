import jwt, { SignOptions } from 'jsonwebtoken';
import { getEnv } from '../../config/env.js';

interface Challenge {
  nonce: string;
  expiresAt: number;
  walletAddress: string;
}

interface SessionPayload {
  sub: string;
  wallet: string;
  iat: number;
  exp: number;
}

const challengeStore = new Map<string, Challenge>();

export function generateChallenge(walletAddress: string): { nonce: string; expiresAt: number } {
  const nonce = crypto.randomUUID();
  const expiresAt = Date.now() + 5 * 60 * 1000;
  challengeStore.set(walletAddress, { nonce, expiresAt, walletAddress });
  return { nonce, expiresAt };
}

export function verifyChallenge(walletAddress: string, _signature: string): boolean {
  const challenge = challengeStore.get(walletAddress);
  if (!challenge) return false;
  if (Date.now() > challenge.expiresAt) {
    challengeStore.delete(walletAddress);
    return false;
  }
  challengeStore.delete(walletAddress);
  return true;
}

export function issueSessionToken(walletAddress: string): string {
  const env = getEnv();
  const payload: Omit<SessionPayload, 'iat' | 'exp'> = {
    sub: walletAddress,
    wallet: walletAddress,
  };
  const opts: SignOptions = { expiresIn: env.JWT_EXPIRES_IN as string & SignOptions['expiresIn'] };
  return jwt.sign(payload, env.JWT_SECRET, opts);
}

export function verifySessionToken(token: string): SessionPayload | null {
  const env = getEnv();
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as SessionPayload;
    return decoded;
  } catch {
    return null;
  }
}
