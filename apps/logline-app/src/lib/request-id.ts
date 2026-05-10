import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';

export function getOrCreateRequestId(req: NextRequest): string {
  return req.headers.get('x-request-id') ?? randomUUID();
}
