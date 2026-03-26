import type { FileContent } from '../types';
import type { SynthesizedEvent, InstrumentableEvent, PropertySpec } from './types';
import { analyzeScope } from '../utils/scope-analyzer';

export function inferEventProperties(
  events: SynthesizedEvent[],
  files: FileContent[]
): InstrumentableEvent[] {
  return events.map((event) => {
    const file = files.find((f) => f.path === event.location.file);
    if (!file) {
      return {
        ...event,
        insertionPoint: event.location,
        properties: [],
      };
    }

    const scope = analyzeScope(file.content, event.location.line);
    const properties = buildProperties(event, scope);
    return { ...event, insertionPoint: event.location, properties };
  });
}

function buildProperties(
  event: SynthesizedEvent,
  scope: ReturnType<typeof analyzeScope>
): PropertySpec[] {
  const props: PropertySpec[] = [];
  const parts = event.name.split('_');
  const objectName = parts.slice(0, -1).join('_') || 'unknown';

  // Best-effort: if an object variable exists, mark verified.
  const objectVar = scope.find((v) => v.name.toLowerCase() === objectName.toLowerCase())
    ?? scope.find((v) => v.name.toLowerCase().includes(objectName.replace(/_/g, '')));

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

  if (objectName.includes('workflow')) {
    const workflowVar = scope.find((v) => v.name === 'workflow');
    props.push({
      name: 'workflow_name',
      type: 'string',
      required: false,
      accessPath: `${workflowVar?.accessPath ?? 'workflow'}?.name`,
      verified: Boolean(workflowVar),
    });
  }

  return props;
}

