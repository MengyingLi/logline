import { NextResponse } from 'next/server';

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'SERVICE_ERROR';

export interface ApiErrorBody {
  ok: false;
  error: string;
  code: ApiErrorCode;
  requestId?: string;
}

export function apiJsonError(
  code: ApiErrorCode,
  message: string,
  status: number,
  requestId?: string
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { ok: false, error: message, code, ...(requestId ? { requestId } : {}) },
    { status }
  );
}
