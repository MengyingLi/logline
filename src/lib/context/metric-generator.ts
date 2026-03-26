import type { TrackingPlan, TrackingPlanMetric, TrackingPlanEvent, ObjectLifecycle } from '../types';

export function generateMetrics(plan: TrackingPlan): TrackingPlanMetric[] {
  const events = plan.events.filter((e) => e.status !== 'deprecated');
  const lifecycles = plan.context?.lifecycles ?? [];

  const metrics: TrackingPlanMetric[] = [];
  metrics.push(...countMetrics(events));
  metrics.push(...conversionMetrics(events, lifecycles));

  // De-dup by name
  const byName = new Map<string, TrackingPlanMetric>();
  for (const m of metrics) byName.set(m.name.toLowerCase(), m);
  return Array.from(byName.values());
}

function countMetrics(events: TrackingPlanEvent[]): TrackingPlanMetric[] {
  const out: TrackingPlanMetric[] = [];
  for (const e of events) {
    const name = `${e.name}_count`;
    out.push({
      id: `m_${hash8(name)}`,
      name,
      description: `Count of ${e.name}`,
      formula: `count(event = '${e.name}')`,
      events: [e.name],
      category: categorizeFromPriority(e.priority),
      grain: 'daily',
      status: 'suggested',
    });
  }
  return out;
}

function conversionMetrics(events: TrackingPlanEvent[], lifecycles: ObjectLifecycle[]): TrackingPlanMetric[] {
  const names = new Set(events.map((e) => e.name.toLowerCase()));
  const out: TrackingPlanMetric[] = [];

  for (const lc of lifecycles) {
    const obj = toSnake(lc.object);
    const created = `${obj}_created`;
    const completed = `${obj}_completed`;
    if (!names.has(created) || !names.has(completed)) continue;

    const metricName = `${obj}_completion_rate`;
    out.push({
      id: `m_${hash8(metricName)}`,
      name: metricName,
      description: `Share of ${lc.object}s created that reach completed`,
      formula: `count(event = '${completed}') / nullif(count(event = '${created}'), 0)`,
      events: [created, completed],
      category: 'activation',
      grain: 'weekly',
      status: 'suggested',
    });
  }

  return out;
}

function categorizeFromPriority(p: TrackingPlanEvent['priority']): TrackingPlanMetric['category'] {
  if (p === 'critical') return 'activation';
  if (p === 'high') return 'engagement';
  if (p === 'low') return 'retention';
  return 'engagement';
}

function toSnake(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .toLowerCase()
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function hash8(s: string): string {
  // lightweight stable hash (not crypto; sufficient for ids)
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 8);
}

