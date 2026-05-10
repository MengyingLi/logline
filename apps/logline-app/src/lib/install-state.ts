import { createHmac, timingSafeEqual } from 'node:crypto';

export interface InstallStatePayload {
  installationId: number;
  exp: number;
  sig: string;
}

/** Sign optional install callback state (replay window + binding to installation id). */
export function signInstallState(installationId: number, ttlSeconds = 600): string {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.INSTALL_STATE_SECRET;
  if (!secret) return '';
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${installationId}.${exp}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  const json = JSON.stringify({ installationId, exp, sig } satisfies InstallStatePayload);
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function verifyInstallState(installationId: number, stateParam: string): boolean {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.INSTALL_STATE_SECRET;
  if (!secret) return true;

  try {
    const raw = Buffer.from(stateParam, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as { installationId?: number; exp?: number; sig?: string };
    if (!parsed.exp || !parsed.sig || parsed.installationId !== installationId) return false;
    if (Date.now() / 1000 > parsed.exp) return false;
    const payload = `${installationId}.${parsed.exp}`;
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    const a = Buffer.from(parsed.sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
