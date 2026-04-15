import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const installationId = req.nextUrl.searchParams.get('installation_id');
  return NextResponse.json({
    ok: true,
    message: 'Install callback received',
    installationId,
  });
}

