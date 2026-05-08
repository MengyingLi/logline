import type { ConventionEvent } from './types';
import type { LoadedConventions } from './loader';
import type { DetectedEvent } from '../lib/types';
import type { FileContent } from '../lib/types';

export interface ConventionMatchedEvent {
  eventName: string;
  location: string;
  missingRequired: string[];
  requiredHint?: string;
}

export interface ConventionMissingEvent {
  eventName: string;
  reason: string;
  required: string[];
}

export interface ConventionCoverage {
  domain: string;
  matched: ConventionMatchedEvent[];
  missing: ConventionMissingEvent[];
}

/**
 * Check if required attributes appear in the track() call at the given location.
 * Uses a simple heuristic: look for "attr_name" or attr_name: in the same line and next few lines.
 */
function getMissingRequiredAttributes(
  fileContent: string,
  lineNumber: number,
  requiredAttrs: ConventionEvent['attributes']['required']
): string[] {
  const lines = fileContent.split('\n');
  const start = Math.max(0, lineNumber - 1);
  const end = Math.min(lines.length, lineNumber + 5);
  const context = lines.slice(start, end).join('\n');
  const missing: string[] = [];
  for (const attr of requiredAttrs) {
    const name = attr.name;
    if (!new RegExp(`["']?${name.replace(/_/g, '[_\s]?')}["']?\\s*:`).test(context) &&
        !new RegExp(`\\b${name}\\b`).test(context)) {
      missing.push(name);
    }
  }
  return missing;
}

function missingReason(domain: string, eventName: string): string {
  // Onboarding
  if (eventName.includes('signup')) return 'No signup flow handler found';
  if (eventName.includes('email_verification')) return 'No verification email trigger found';
  if (eventName.includes('onboarding_step')) return 'Onboarding flow detected but steps not instrumented';
  if (eventName === 'onboarding_complete') return 'Onboarding complete handler not instrumented';

  // Billing
  if (eventName === 'subscription_trial_start') return 'Trial start not instrumented — required for conversion funnel';
  if (eventName === 'subscription_trial_convert') return 'Trial conversion not instrumented — key revenue event';
  if (eventName === 'subscription_trial_expire') return 'Trial expiry not instrumented — required for churn analysis';
  if (eventName === 'subscription_cancelled') return 'Cancellation flow not instrumented — required for churn analysis';
  if (eventName === 'subscription_upgraded') return 'Upgrade path not instrumented';
  if (eventName === 'subscription_downgraded') return 'Downgrade path not instrumented';
  if (eventName === 'payment_fail') return 'Payment failure handler not instrumented — required for revenue recovery';
  if (domain === 'billing') return 'Billing event not instrumented';

  // Search
  if (eventName === 'search_performed') return 'Search handler not instrumented';
  if (eventName === 'search_no_results') return 'Zero-results state not instrumented — key quality signal';
  if (eventName === 'search_result_clicked') return 'Result click not instrumented — needed for relevance analysis';
  if (domain === 'search') return 'Search event not instrumented';

  // Collaboration
  if (eventName === 'member_invited') return 'Invitation flow not instrumented — required for PLG seat expansion';
  if (eventName === 'member_invite_accepted') return 'Invite acceptance not instrumented';
  if (eventName === 'workspace_created') return 'Workspace creation not instrumented';
  if (domain === 'collaboration') return 'Collaboration event not instrumented';

  return 'Not found in codebase';
}

function formatRequiredHint(attrs: ConventionEvent['attributes']['required']): string {
  return attrs.map((a) => (a.type === 'enum' && a.values ? `${a.name} (enum: ${a.values.join(', ')})` : a.name)).join(', ');
}

/**
 * Compute convention coverage for a scan result: which convention events are
 * matched (tracked in code) and which are missing, plus property gaps.
 */
export async function computeConventionCoverage(
  files: FileContent[],
  detectedEvents: DetectedEvent[],
  loaded: LoadedConventions,
  domains: string[]
): Promise<ConventionCoverage[]> {
  const result: ConventionCoverage[] = [];
  const fileByPath = new Map<string, FileContent>();
  for (const f of files) fileByPath.set(f.path, f);

  for (const domain of domains) {
    const convention = loaded.byDomain.get(domain);
    if (!convention) continue;

    const matched: ConventionMatchedEvent[] = [];
    const missing: ConventionMissingEvent[] = [];
    const detectedByName = new Map(detectedEvents.map((e) => [e.name.toLowerCase(), e]));

    for (const convEvent of convention.events) {
      const key = convEvent.name.toLowerCase();
      const detected = detectedByName.get(key);

      if (detected?.locations?.length) {
        const loc = detected.locations[0];
        const file = loc?.file ? fileByPath.get(loc.file) : undefined;
        const line = loc?.line ?? 0;
        const required = convEvent.attributes.required ?? [];
        const missingAttrs = file
          ? getMissingRequiredAttributes(file.content, line, required)
          : required.map((a) => a.name);

        matched.push({
          eventName: convEvent.name,
          location: loc ? `${loc.file}:${loc.line}` : 'unknown',
          missingRequired: missingAttrs,
          requiredHint: required.length ? formatRequiredHint(required) : undefined,
        });
      } else {
        const required = (convEvent.attributes.required ?? []).map((a) =>
          a.type === 'enum' && a.values ? `${a.name} (enum)` : a.name
        );
        const reason = missingReason(domain, convEvent.name);

        missing.push({
          eventName: convEvent.name,
          reason,
          required,
        });
      }
    }

    result.push({ domain, matched, missing });
  }

  return result;
}
