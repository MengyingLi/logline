import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  // existing track should be found by inventory
  analytics.track('health_check_ran', {});
  res.status(200).json({ ok: true });
}

// Minimal global to avoid runtime issues in fixture scans
// (inventory scans source text only; execution isn't required)
declare const analytics: { track: (name: string, props?: Record<string, unknown>) => void };

