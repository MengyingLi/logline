/**
 * TrackingGapDetector: identifies suggested events that are missing from existing tracking.
 *
 * Ported/adapted from logline_old/packages/saas-engine/src/discovery/tracking-gap-detector.ts
 * but simplified to the subset needed by the unified scan pipeline.
 */

import type { CodeLocation, ProductProfile } from '../types';
import type { InteractionTypes } from './interaction-scanner';

export interface TrackingGap {
  suggestedEvent: string;
  reason: string;
  location: CodeLocation;
  confidence: number; // 0-1
  priority: 'critical' | 'high' | 'medium' | 'low';
  searchPatterns?: string[];
  hint?: string;
  /** Business grouping: human-readable description of what this event represents */
  description?: string;
  /** Granular event names rolled up into this business event */
  includes?: string[];
  /** All file paths involved (for display when grouped) */
  locations?: string[];
}

export class TrackingGapDetector {
  detectGapsFromInteractions(args: {
    interactions: InteractionTypes;
    existingEventNames: string[];
    profile?: ProductProfile;
  }): TrackingGap[] {
    const existing = new Set(args.existingEventNames.map((e) => e.toLowerCase()));
    const gaps: TrackingGap[] = [];

    for (const interaction of args.interactions.actorToObject) {
      const eventName = interaction.suggestedEvent.toLowerCase();
      if (existing.has(eventName)) continue;

      const loc = interaction.location ?? { file: 'unknown', line: 0 };
      gaps.push({
        suggestedEvent: interaction.suggestedEvent,
        reason: `${interaction.actor} ${interaction.action} ${interaction.object} but no "${interaction.suggestedEvent}" event is tracked`,
        location: loc,
        confidence: typeof loc.confidence === 'number' ? loc.confidence : 0.6,
        priority: 'medium',
        searchPatterns: interaction.searchPatterns,
        hint: interaction.hint ?? loc.hint,
      });
    }

    // Priority heuristic (business profile aware if provided)
    return prioritizeGaps(gaps, args.profile);
  }
}

function prioritizeGaps(gaps: TrackingGap[], profile?: ProductProfile): TrackingGap[] {
  const keyMetricSet = new Set((profile?.keyMetrics ?? []).map((m: string) => m.toLowerCase()));
  const goalText = (profile?.businessGoals ?? []).join(' ').toLowerCase();

  const score = (g: TrackingGap): number => {
    let s = 0;
    const name = g.suggestedEvent.toLowerCase();

    // 1) explicit key metrics mention
    for (const metric of keyMetricSet) {
      if (metric && name.includes(metric.replace(/\s+/g, '_'))) s += 50;
    }

    // 2) business goals keyword match
    if (goalText) {
      const tokens = goalText.split(/\W+/).filter((t: string) => t.length >= 5);
      for (const t of tokens.slice(0, 30)) {
        if (name.includes(t)) s += 5;
      }
    }

    // 3) user-facing actions (crud-ish)
    if (/(created|deleted|updated|saved|invited|shared|selected|started)/.test(name)) s += 20;
    if (/test_/.test(name)) s += 10;

    // 4) location confidence
    s += Math.round((g.confidence ?? 0.5) * 10);
    return s;
  };

  const withPriority = gaps.map((g) => {
    const s = score(g);
    const priority: TrackingGap['priority'] =
      s >= 60 ? 'critical' : s >= 40 ? 'high' : s >= 20 ? 'medium' : 'low';
    return { ...g, priority };
  });

  return withPriority.sort((a, b) => score(b) - score(a));
}

