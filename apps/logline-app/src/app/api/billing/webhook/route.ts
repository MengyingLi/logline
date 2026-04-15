import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/lib/billing/stripe';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const sig = req.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) {
    return NextResponse.json({ error: 'Missing Stripe webhook configuration' }, { status: 400 });
  }

  const body = await req.text();
  try {
    const stripe = getStripe();
    const event = stripe.webhooks.constructEvent(body, sig, secret);

    if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.deleted' ||
      event.type === 'invoice.payment_failed'
    ) {
      console.log('[logline-app] stripe event', event.type);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 400 });
  }
}

