import { X509Certificate } from 'node:crypto';

export interface MtlsVerificationResult {
  verified: boolean;
  serialNumber: string;
  commonName: string;
  reason?: string;
}

export class MtlsGatewayVerifier {
  private whitelist = new Set<string>();

  addToWhitelist(serial: string): void {
    this.whitelist.add(serial);
  }

  removeFromWhitelist(serial: string): void {
    this.whitelist.delete(serial);
  }

  verifyConnection(peerCertificate: string): MtlsVerificationResult {
    try {
      const cert = new X509Certificate(peerCertificate);
      const serial = cert.serialNumber;
      const cn =
        cert.subject
          .split('\n')
          .find((s) => s.startsWith('CN='))
          ?.slice(3) ?? '';

      if (!this.whitelist.has(serial)) {
        return {
          verified: false,
          serialNumber: serial,
          commonName: cn,
          reason: `Serial ${serial} not in hardware whitelist`,
        };
      }

      const now = new Date();
      const validFrom = new Date(cert.validFrom);
      const validTo = new Date(cert.validTo);
      if (validFrom > now || validTo < now) {
        return {
          verified: false,
          serialNumber: serial,
          commonName: cn,
          reason: 'Certificate is outside validity window',
        };
      }

      return { verified: true, serialNumber: serial, commonName: cn };
    } catch (error) {
      return {
        verified: false,
        serialNumber: '',
        commonName: '',
        reason: `Certificate parse error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
