import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth-options';
import { getInstallation } from '@/lib/db';
import { getStripe } from '@/lib/billing/stripe';
import { userCanAdministerInstallationAccount } from '@/lib/github-access';
import { CheckoutBodySchema } from '@/lib/validation/schemas';
import { logger } from '@/lib/logger';
import { apiJsonError } from '@/lib/api-error';
import { getOrCreateRequestId } from '@/lib/request-id';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = getOrCreateRequestId(req);
  const log = logger.child({ requestId, route: 'billing/checkout' });

  try {
    const session = await getServerSession(authOptions);
    const accessToken = (session as { accessToken?: string } | null)?.accessToken;
    if (!session?.user || !accessToken) {
      return apiJsonError('UNAUTHORIZED', 'Unauthorized', 401, requestId);
    }

    const raw = await req.json().catch(() => ({}));
    const parsed = CheckoutBodySchema.safeParse(raw);
    if (!parsed.success) {
      return apiJsonError(
        'VALIDATION_ERROR',
        parsed.error.errors.map((e) => e.message).join('; ') || 'Invalid body',
        400,
        requestId
      );
    }

    const { installationId } = parsed.data;

    const installation = await getInstallation(installationId);
    if (!installation) {
      return apiJsonError('NOT_FOUND', 'Installation not found', 404, requestId);
    }

    const allowed = await userCanAdministerInstallationAccount(
      accessToken,
      installation.account_login,
      installation.account_type
    );
    if (!allowed) {
      return apiJsonError('FORBIDDEN', 'Forbidden', 403, requestId);
    }

    const successUrl = process.env.BILLING_SUCCESS_URL;
    const cancelUrl = process.env.BILLING_CANCEL_URL;
    if (!successUrl || !cancelUrl) {
      log.warn('Billing redirect URLs not configured');
      return apiJsonError('SERVICE_ERROR', 'Billing not configured', 500, requestId);
    }

    const priceId = process.env.STRIPE_PRICE_ID;
    if (!priceId) {
      return apiJsonError('SERVICE_ERROR', 'Stripe price not configured', 500, requestId);
    }

    const stripe = getStripe();
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: String(installationId),
      metadata: { installation_id: String(installationId) },
      subscription_data: {
        metadata: { installation_id: String(installationId) },
      },
    });

    log.info({ installationId }, 'Stripe checkout session created');
    return NextResponse.json({ ok: true, url: checkoutSession.url });
  } catch (error) {
    log.error({ err: error }, 'checkout failed');
    return apiJsonError('SERVICE_ERROR', 'Checkout failed', 500, requestId);
  }
}
