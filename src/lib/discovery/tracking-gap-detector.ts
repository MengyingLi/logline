import type { CodeLocation } from '../types';

export interface TrackingGap {
  suggestedEvent: string;
  reason: string;
  location: CodeLocation;
  confidence: number; // 0-1
  priority: 'critical' | 'high' | 'medium' | 'low';
  signalType?: import('../types').SignalType;
  searchPatterns?: string[];
  hint?: string;
  /** Business grouping: human-readable description of what this event represents */
  description?: string;
  /** Granular event names rolled up into this business event */
  includes?: string[];
  /** All file paths involved (for display when grouped) */
  locations?: string[];
}
