import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * Sets `x-request-id` on responses and forwards the same id on the request
 * so route handlers and `getOrCreateRequestId()` match the client-visible header.
 */
export async function middleware(req: NextRequest): Promise<NextResponse> {
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();

  const withRequestId = (res: NextResponse): NextResponse => {
    res.headers.set('x-request-id', requestId);
    return res;
  };

  const nextWithForwardedId = (): NextResponse => {
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-request-id', requestId);
    return withRequestId(NextResponse.next({ request: { headers: requestHeaders } }));
  };

  if (req.nextUrl.pathname.startsWith('/api/')) {
    return nextWithForwardedId();
  }

  if (req.nextUrl.pathname.startsWith('/dashboard')) {
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) {
      const res = NextResponse.json({ error: 'Auth not configured' }, { status: 500 });
      return withRequestId(res);
    }

    const token = await getToken({ req, secret });
    if (!token) {
      const url = new URL('/signin', req.url);
      url.searchParams.set('callbackUrl', `${req.nextUrl.pathname}${req.nextUrl.search}`);
      const res = NextResponse.redirect(url);
      return withRequestId(res);
    }

    return nextWithForwardedId();
  }

  return withRequestId(NextResponse.next());
}

export const config = {
  matcher: ['/dashboard', '/dashboard/:path+', '/api/:path*'],
};
