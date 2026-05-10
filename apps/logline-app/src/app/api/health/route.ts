import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

/**
 * Liveness + dependency probes for orchestrators.
 */
export async function GET(): Promise<NextResponse> {
  const checks: Record<string, { ok: boolean; detail?: string }> = {
    server: { ok: true },
    database: { ok: false },
  };

  try {
    const db = getDb();
    const { error } = await db.from('installations').select('id').limit(1);
    checks.database = { ok: !error, ...(error ? { detail: error.message } : {}) };
  } catch (e) {
    checks.database = { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }

  const healthy = Object.values(checks).every((c) => c.ok);
  return NextResponse.json(
    {
      ok: healthy,
      service: 'logline-app',
      checks,
    },
    { status: healthy ? 200 : 503 }
  );
}
