import React from 'react';
import { analytics } from '../lib/analytics';

export function PricingPage(): JSX.Element {
  function handleUpgradePlan(planId: string): void {
    analytics.track('plan_upgraded', { plan_id: planId });
  }

  return (
    <button aria-label="Upgrade Plan" onClick={() => handleUpgradePlan('pro')}>
      Upgrade
    </button>
  );
}

