import type { FileContent, TrackingPlanContext, ObjectToObjectRelationship, JoinPath } from '../types';
import type { SynthesizedEvent, InstrumentableEvent, PropertySpec } from './types';
import { analyzeScope } from '../utils/scope-analyzer';

export function inferEventProperties(
  events: SynthesizedEvent[],
  files: FileContent[],
  context?: TrackingPlanContext
): InstrumentableEvent[] {
  return events.map((event) => {
    const file = files.find((f) => f.path === event.location.file);
    const scope = file ? analyzeScope(file.content, event.location.line) : [];
    const properties = buildProperties(event, scope, context);
    return { ...event, insertionPoint: event.location, properties };
  });
}

function buildProperties(
  event: SynthesizedEvent,
  scope: ReturnType<typeof analyzeScope>,
  context?: TrackingPlanContext
): PropertySpec[] {
  const props: PropertySpec[] = [];
  const parts = event.name.split('_');
  const objectName = parts.slice(0, -1).join('_') || 'unknown';

  // Best-effort: if an object variable exists in scope, mark verified.
  const objectVar =
    scope.find((v) => v.name.toLowerCase() === objectName.toLowerCase()) ??
    scope.find((v) => v.name.toLowerCase().includes(objectName.replace(/_/g, '')));

  if (objectName !== 'unknown') {
    props.push({
      name: `${objectName}_id`,
      type: 'string',
      required: true,
      accessPath: objectVar ? `${objectVar.accessPath}.id` : `${objectName}?.id`,
      verified: Boolean(objectVar),
      description: `Unique identifier of the ${objectName}`,
    });
  }

  // Hierarchy enrichment: walk relationships to add parent/grandparent IDs
  if (context) {
    const hierarchyProps = buildHierarchyProps(objectName, scope, context.relationships ?? [], context.joinPaths ?? []);
    props.push(...hierarchyProps);
  }

  // user_id from scope or actors
  const userVar = scope.find((v) => ['user', 'currentUser', 'session'].includes(v.name));
  props.push({
    name: 'user_id',
    type: 'string',
    required: true,
    accessPath: userVar
      ? userVar.name === 'session'
        ? `${userVar.accessPath}?.user?.id`
        : `${userVar.accessPath}?.id`
      : 'user?.id',
    verified: Boolean(userVar),
    description: 'ID of the user who performed the action',
  });

  // Sequence-aware properties
  const sequenceProps = buildSequenceProps(event.name, context);
  props.push(...sequenceProps);

  return deduplicateProps(props);
}

function buildHierarchyProps(
  objectName: string,
  scope: ReturnType<typeof analyzeScope>,
  relationships: ObjectToObjectRelationship[],
  joinPaths: JoinPath[]
): PropertySpec[] {
  const props: PropertySpec[] = [];
  const objectKey = objectName.toLowerCase();

  // Find the Pascal-case object name (e.g. "step" → "Step")
  const objectPascal = toPascalCase(objectName);

  // Direct parents from relationships
  const directParents = relationships
    .filter((r) => r.child.toLowerCase() === objectKey)
    .map((r) => r.parent);

  for (const parent of directParents) {
    const parentSnake = toSnake(parent);
    const parentIdName = `${parentSnake}_id`;

    // Skip if we already have this property
    if (props.some((p) => p.name === parentIdName)) continue;
    // Skip if it's the same as the object itself
    if (parentSnake === objectName) continue;

    const parentVar = scope.find((v) => v.name.toLowerCase() === parentSnake.toLowerCase()) ??
      scope.find((v) => v.name.toLowerCase().includes(parentSnake.replace(/_/g, '')));

    props.push({
      name: parentIdName,
      type: 'string',
      required: true,
      accessPath: parentVar ? `${parentVar.accessPath}.id` : `${parentSnake}?.id`,
      verified: Boolean(parentVar),
      description: `ID of the parent ${parent}`,
      ...(parentVar ? {} : { todo: true }),
    });
  }

  // Grandparent IDs from join paths (optional properties)
  const joinPath = joinPaths.find(
    (jp) => jp.from.toLowerCase() === objectPascal.toLowerCase() && jp.via.length >= 2
  );
  if (joinPath && joinPath.via.length >= 2) {
    // The second hop in join path points to a grandparent
    const grandparentMatch = joinPath.to;
    const grandparentSnake = toSnake(grandparentMatch);
    const grandparentIdName = `${grandparentSnake}_id`;

    if (
      !props.some((p) => p.name === grandparentIdName) &&
      grandparentSnake !== objectName &&
      !directParents.map(toSnake).includes(grandparentSnake)
    ) {
      const gpVar = scope.find((v) => v.name.toLowerCase() === grandparentSnake.toLowerCase());
      props.push({
        name: grandparentIdName,
        type: 'string',
        required: false,
        accessPath: gpVar ? `${gpVar.accessPath}.id` : `${grandparentSnake}?.id`,
        verified: Boolean(gpVar),
        description: `ID of the grandparent ${grandparentMatch} (for cross-entity correlation)`,
        ...(gpVar ? {} : { todo: true }),
      });
    }
  }

  return props;
}

function buildSequenceProps(
  eventName: string,
  context?: TrackingPlanContext
): PropertySpec[] {
  if (!context) return [];

  const props: PropertySpec[] = [];

  // For *_completed events in a known lifecycle, suggest time_since_created
  if (eventName.endsWith('_completed')) {
    const objectSnake = eventName.replace(/_completed$/, '');
    const hasCreated = context.lifecycles?.some(
      (lc) => toSnake(lc.object) === objectSnake
    );
    if (hasCreated) {
      props.push({
        name: 'time_to_complete_ms',
        type: 'number',
        required: false,
        accessPath: undefined,
        verified: false,
        description: 'Milliseconds from creation to completion (for funnel analysis)',
        todo: true,
      });
    }
  }

  // For *_failed events that follow a *_tested pattern, suggest attempt_number
  if (eventName.endsWith('_failed')) {
    const base = eventName.replace(/_failed$/, '');
    const testedEvent = `${base}_tested`;
    const sequences = context.expectedSequences ?? [];
    const inSequence = sequences.some((s) => s.steps.includes(testedEvent));
    if (inSequence) {
      props.push({
        name: 'attempt_number',
        type: 'number',
        required: false,
        accessPath: undefined,
        verified: false,
        description: 'How many times this action was attempted before failing',
        todo: true,
      });
    }
  }

  return props;
}

function deduplicateProps(props: PropertySpec[]): PropertySpec[] {
  const seen = new Set<string>();
  const out: PropertySpec[] = [];
  for (const p of props) {
    if (seen.has(p.name)) continue;
    seen.add(p.name);
    out.push(p);
  }
  return out;
}

function toPascalCase(s: string): string {
  return s
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

function toSnake(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .toLowerCase()
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}
