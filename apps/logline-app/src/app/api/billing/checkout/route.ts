import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/lib/billing/stripe';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => ({}));
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      success_url: body.successUrl ?? process.env.BILLING_SUCCESS_URL ?? 'https://example.com/success',
      cancel_url: body.cancelUrl ?? process.env.BILLING_CANCEL_URL ?? 'https://example.com/cancel',
    });

    return NextResponse.json({ ok: true, url: session.url });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}

