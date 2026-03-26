import type { ExpectedSequence, ObjectLifecycle, TrackingPlanEvent } from '../types';

export function generateExpectedSequences(args: {
  events: TrackingPlanEvent[];
  lifecycles: ObjectLifecycle[];
}): ExpectedSequence[] {
  const names = new Set(args.events.map((e) => e.name.toLowerCase()));
  const sequences: ExpectedSequence[] = [];

  for (const lc of args.lifecycles) {
    const obj = toSnake(lc.object);
    const created = `${obj}_created`;
    const completed = `${obj}_completed`;
    const edited = `${obj}_edited`;
    const activated = `${obj}_activated`;

    if (names.has(created) && names.has(completed)) {
      const steps = [created];
      if (names.has(edited)) steps.push(edited);
      else if (names.has(activated)) steps.push(activated);
      steps.push(completed);

      sequences.push({
        name: `${obj}_activation`,
        steps,
        expectedWindow: '7d',
        significance: `Measures whether users activate after creating a ${lc.object}`,
      });
    }
  }

  return sequences;
}

function toSnake(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .toLowerCase()
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

