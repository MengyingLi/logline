import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/lib/billing/stripe';
import { updateInstallationBilling } from '@/lib/db';
import type Stripe from 'stripe';
import { logger } from '@/lib/logger';

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

    switch (event.type) {
      case 'checkout.session.completed': {
        const sess = event.data.object as Stripe.Checkout.Session;
        const rawId = sess.metadata?.installation_id ?? sess.client_reference_id;
        if (rawId && sess.subscription) {
          const installationId = Number(rawId);
          const subId = typeof sess.subscription === 'string' ? sess.subscription : sess.subscription.id;
          const customerId = typeof sess.customer === 'string' ? sess.customer : sess.customer?.id;
          if (!Number.isNaN(installationId) && customerId) {
            await updateInstallationBilling(installationId, {
              plan: 'pro',
              stripe_customer_id: customerId,
              stripe_subscription_id: subId,
            });
            logger.info({ installationId, type: event.type }, 'Stripe billing updated');
          }
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const rawId = sub.metadata?.installation_id;
        if (!rawId) break;
        const installationId = Number(rawId);
        if (Number.isNaN(installationId)) break;

        const active = sub.status === 'active' || sub.status === 'trialing';
        if (event.type === 'customer.subscription.deleted' || !active) {
          await updateInstallationBilling(installationId, {
            plan: 'free',
            stripe_subscription_id: null,
          });
        } else {
          const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
          await updateInstallationBilling(installationId, {
            plan: 'pro',
            stripe_subscription_id: sub.id,
            ...(customerId ? { stripe_customer_id: customerId } : {}),
          });
        }
        logger.info({ installationId, subscriptionStatus: sub.status, type: event.type }, 'Stripe subscription event');
        break;
      }
      default:
        break;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error({ err: error }, 'stripe webhook processing failed');
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 400 });
  }
}
