import type { TrackingGap } from '../discovery/tracking-gap-detector';

export interface CodeContext {
  availableVariables: Map<string, string>;
  componentProps: string[];
  stateVariables: string[];
  hasAuthContext: boolean;
  hasUserSession: boolean;
  handlerSignature?: string;
}

export function generateTrackingCode(
  gap: TrackingGap,
  fileContent?: string,
  effectiveLine?: number
): string {
  const targetLine = effectiveLine ?? gap.location?.line ?? 0;
  const context = fileContent ? analyzeCodeContext(fileContent, targetLine) : null;
  const props = inferProperties(gap, context);

  const propsStr = props
    .map((p) => `  ${p.name}: ${p.value},${p.todo ? ' // TODO: verify' : ''}`)
    .join('\n');

  return `// Logline: ${gap.suggestedEvent}
track('${gap.suggestedEvent}', {
${propsStr}
});`;
}

export function analyzeCodeContext(content: string, targetLine: number): CodeContext {
  const lines = content.split('\n');
  const context: CodeContext = {
    availableVariables: new Map(),
    componentProps: [],
    stateVariables: [],
    hasAuthContext: false,
    hasUserSession: false,
  };

  // 1. Props destructuring: const { workflow, user } = props
  const propsMatch = content.match(/const\s*\{([^}]+)\}\s*=\s*props/);
  if (propsMatch) {
    context.componentProps = propsMatch[1]
      .split(',')
      .map((s) => s.trim().split(':')[0].trim())
      .filter(Boolean);
    for (const p of context.componentProps) {
      context.availableVariables.set(p, 'props');
    }
  }

  // 2. useState: const [workflow, setWorkflow] = useState
  const stateMatches = content.matchAll(/const\s*\[(\w+),\s*set\w+\]\s*=\s*useState/g);
  for (const m of stateMatches) {
    context.stateVariables.push(m[1]);
    context.availableVariables.set(m[1], 'state');
  }

  // 3. Function params: handleWorkflow(workflow), (step: Step) =>
  const paramMatches = content.matchAll(/\(([^)]*)\)\s*=>|function\s+\w+\s*\(([^)]*)\)/g);
  for (const m of paramMatches) {
    const params = (m[1] || m[2] || '')
      .split(',')
      .map((s) => s.trim().split(':')[0].trim().split('=')[0].trim())
      .filter(Boolean);
    for (const p of params) {
      context.availableVariables.set(p, 'param');
    }
  }

  // 4. Auth/session hooks
  if (content.includes('useAuth') || content.includes('useSession') || content.includes('useUser')) {
    context.hasAuthContext = true;
  }
  if (
    content.includes('session') ||
    content.includes('currentUser') ||
    content.includes('user?.') ||
    content.includes('user?.id')
  ) {
    context.hasUserSession = true;
  }

  // 5. Look for object variables near target line
  const nearbyLines = lines
    .slice(Math.max(0, targetLine - 50), targetLine + 10)
    .join('\n');

  if (
    nearbyLines.includes('workflow.') ||
    nearbyLines.includes('workflow?.') ||
    nearbyLines.includes('workflow?.id')
  ) {
    context.availableVariables.set('workflow', 'object');
  }
  if (
    nearbyLines.includes('step.') ||
    nearbyLines.includes('step?.') ||
    nearbyLines.includes('selectedStep') ||
    nearbyLines.includes('(step:')
  ) {
    context.availableVariables.set('step', 'object');
  }
  if (nearbyLines.includes('template.') || nearbyLines.includes('template?.') || nearbyLines.includes('(template:')) {
    context.availableVariables.set('template', 'object');
  }
  if (
    nearbyLines.includes('trigger') ||
    nearbyLines.includes('workflow.trigger') ||
    nearbyLines.includes('handleTriggerSelect')
  ) {
    context.availableVariables.set('trigger', 'object');
  }

  // 6. Handler signature for param inference (at effective target line)
  const handlerLineIndex = targetLine > 0 ? targetLine - 1 : 0;
  if (handlerLineIndex < lines.length) {
    context.handlerSignature = lines[handlerLineIndex] ?? '';
  }

  return context;
}

function inferPropertyFromParam(
  paramName: string,
  paramType: string | null,
  objectName: string
): { name: string; value: string } | null {
  // If param is the object itself (template, workflow, step, item)
  if (paramName === objectName || paramName === 'item' || paramName === 'data') {
    return { name: `${objectName}_id`, value: `${paramName}?.id` };
  }

  // If param is a primitive type indicator (type, status, value, id)
  if (['type', 'status', 'value', 'id', 'key', 'name'].includes(paramName)) {
    return { name: `${objectName}_${paramName}`, value: paramName };
  }

  // If param type is a known enum/union (TriggerType, Status, etc.)
  if (paramType?.includes('Type') || paramType?.includes('Status') || paramType?.includes('Kind')) {
    return { name: `${objectName}_type`, value: paramName };
  }

  // Default: assume it's the object
  return { name: `${objectName}_id`, value: `${paramName}?.id` };
}

function inferPropertiesFromHandler(
  handlerSignature: string,
  objectName: string
): { name: string; value: string } | null {
  // Extract first param: (type: TriggerType) or (template: WorkflowTemplate) or (step, index) or ()
  const paramMatch = handlerSignature.match(/\(([^)]*)\)/);
  if (!paramMatch || !paramMatch[1].trim()) return null;

  const firstParam = paramMatch[1].split(',')[0].trim();
  if (!firstParam) return null;

  const colonIdx = firstParam.indexOf(':');
  const paramName = colonIdx >= 0 ? firstParam.slice(0, colonIdx).trim() : firstParam.split('=')[0].trim();
  const paramType = colonIdx >= 0 ? firstParam.slice(colonIdx + 1).trim() : null;

  if (!paramName) return null;
  return inferPropertyFromParam(paramName, paramType, objectName);
}

function inferProperties(
  gap: TrackingGap,
  context: CodeContext | null
): Array<{ name: string; value: string; todo: boolean }> {
  const props: Array<{ name: string; value: string; todo: boolean }> = [];
  const eventParts = gap.suggestedEvent.split('_');
  const objectName = eventParts.slice(0, -1).join('_') || 'unknown';

  // 1. Check handler params first (trigger_type: type, template_id: template?.id)
  const handlerProp = context?.handlerSignature
    ? inferPropertiesFromHandler(context.handlerSignature, objectName)
    : null;

  if (handlerProp) {
    props.push({ name: handlerProp.name, value: handlerProp.value, todo: false });
  } else {
    // 2. Fallback: infer object ID from variables
    const hasObjectVar =
      context?.availableVariables.has(objectName) || context?.stateVariables.includes(objectName);
    if (hasObjectVar) {
      props.push({ name: `${objectName}_id`, value: `${objectName}?.id`, todo: false });
    } else if (objectName !== 'unknown') {
      props.push({ name: `${objectName}_id`, value: `${objectName}?.id`, todo: true });
    }
  }

  // 3. Try to infer user ID
  if (context?.hasAuthContext || context?.hasUserSession) {
    props.push({ name: 'user_id', value: 'user?.id || session?.user?.id', todo: false });
  } else {
    props.push({ name: 'user_id', value: 'user?.id', todo: true });
  }

  // 4. workflow_name for workflow events (skip if we used handler param for primitive like trigger_type)
  if (objectName.includes('workflow') && !props.some((p) => p.name.startsWith('workflow_type'))) {
    const hasWorkflow =
      context?.availableVariables.has('workflow') || context?.stateVariables.includes('workflow');
    props.push({
      name: 'workflow_name',
      value: 'workflow?.name',
      todo: !hasWorkflow,
    });
  }

  // Add changes array for "edited" events
  if (gap.suggestedEvent.endsWith('_edited') && gap.includes?.length) {
    props.push({
      name: 'changes',
      value: `[${gap.includes.map((c) => `'${c}'`).join(', ')}]`,
      todo: false,
    });
  }

  return props;
}
