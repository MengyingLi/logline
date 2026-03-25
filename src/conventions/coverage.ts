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
        let reason = 'Not found in codebase';
        if (convEvent.name.includes('signup')) reason = 'No signup flow handler found';
        else if (convEvent.name.includes('email_verification')) reason = 'No verification email trigger found';
        else if (convEvent.name.includes('onboarding_step')) reason = 'Onboarding flow detected but steps not instrumented';
        else if (convEvent.name === 'onboarding_complete') reason = 'Required: flow_id, steps_completed, steps_skipped';

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
