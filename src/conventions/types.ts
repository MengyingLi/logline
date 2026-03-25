/**
 * Logline semantic conventions (inspired by OpenTelemetry).
 * All event names and attribute names use snake_case.
 * Event format: {object}_{action}_{lifecycle}.
 * No PII in attribute values.
 */

export type ConventionStatus = 'stable' | 'experimental' | 'deprecated';

export type ConventionLifecycle =
  | 'attempt'
  | 'success'
  | 'fail'
  | 'start'
  | 'complete'
  | 'skip';

export type ConventionAttributeType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'array';

export interface ConventionAttribute {
  name: string;
  type: ConventionAttributeType;
  values?: string[];
  items?: string;
  description: string;
}

export interface ConventionEvent {
  name: string;
  lifecycle: ConventionLifecycle;
  description: string;
  attributes: {
    required: ConventionAttribute[];
    optional: ConventionAttribute[];
  };
}

export interface Convention {
  domain: string;
  description: string;
  status: ConventionStatus;
  version: string;
  events: ConventionEvent[];
}
