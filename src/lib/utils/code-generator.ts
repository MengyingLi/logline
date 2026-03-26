import type { TrackingGap } from '../discovery/tracking-gap-detector';
import { analyzeScope, type ScopeVariable } from './scope-analyzer';

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
  effectiveLine?: number,
  options?: { functionName?: string }
): string {
  const targetLine = effectiveLine ?? gap.location?.line ?? 0;
  const props = fileContent ? inferProperties(gap, fileContent, targetLine) : inferPropertiesFallback(gap);
  const fn = options?.functionName?.trim() ? options.functionName.trim() : 'track';

  const propsStr = props
    .map((p) => `  ${p.name}: ${p.value},${p.todo ? ' // TODO: verify' : ''}`)
    .join('\n');

  return `// Logline: ${gap.suggestedEvent}
${fn}('${gap.suggestedEvent}', {
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

function inferProperties(
  gap: TrackingGap,
  fileContent: string,
  targetLine: number
): Array<{ name: string; value: string; todo: boolean }> {
  const scope = analyzeScope(fileContent, targetLine);
  const props: Array<{ name: string; value: string; todo: boolean }> = [];
  const eventParts = gap.suggestedEvent.split('_');
  const objectName = eventParts.slice(0, -1).join('_') || 'unknown';

  // 1) Primary object variable
  const objectVar = findObjectVariable(scope, objectName);
  if (objectVar && objectName !== 'unknown') {
    const hasId = objectVar.properties?.includes('id') ?? false;
    props.push({
      name: `${objectName}_id`,
      value: hasId ? `${objectVar.accessPath}.id` : `${objectVar.accessPath}?.id`,
      todo: false,
    });
  } else if (objectName !== 'unknown') {
    props.push({ name: `${objectName}_id`, value: `${objectName}?.id`, todo: true });
  }

  // 2) User/auth variable
  const userVar = findUserVariable(scope);
  if (userVar) {
    const isSession = userVar.name === 'session';
    props.push({
      name: 'user_id',
      value: isSession ? `${userVar.accessPath}?.user?.id` : `${userVar.accessPath}?.id`,
      todo: false,
    });
  } else {
    props.push({ name: 'user_id', value: 'user?.id', todo: true });
  }

  // 3) Extra context from parameters (type/status-like)
  const paramVars = scope.filter((v) => v.source === 'parameter');
  for (const param of paramVars) {
    const n = param.name.toLowerCase();
    const isTypeOrStatus =
      n === 'type' ||
      n === 'status' ||
      (param.type?.includes('Type') ?? false) ||
      (param.type?.includes('Status') ?? false) ||
      (param.type?.includes('Kind') ?? false);
    if (!isTypeOrStatus) continue;
    if (props.some((p) => p.name.includes('type') || p.name.includes('status'))) continue;
    if (objectName === 'unknown') continue;
    props.push({ name: `${objectName}_${param.name}`, value: param.accessPath, todo: false });
  }

  // 4) workflow_name if we actually have workflow in scope
  if (objectName.includes('workflow')) {
    const workflowVar = findObjectVariable(scope, 'workflow');
    props.push({
      name: 'workflow_name',
      value: `${workflowVar?.accessPath ?? 'workflow'}?.name`,
      todo: !workflowVar,
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

function inferPropertiesFallback(gap: TrackingGap): Array<{ name: string; value: string; todo: boolean }> {
  const eventParts = gap.suggestedEvent.split('_');
  const objectName = eventParts.slice(0, -1).join('_') || 'unknown';
  const props: Array<{ name: string; value: string; todo: boolean }> = [];
  if (objectName !== 'unknown') {
    props.push({ name: `${objectName}_id`, value: `${objectName}?.id`, todo: true });
  }
  props.push({ name: 'user_id', value: 'user?.id', todo: true });
  if (gap.suggestedEvent.endsWith('_edited') && gap.includes?.length) {
    props.push({
      name: 'changes',
      value: `[${gap.includes.map((c) => `'${c}'`).join(', ')}]`,
      todo: false,
    });
  }
  return props;
}

function normalizeObjectName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
}

function findObjectVariable(scope: ScopeVariable[], objectName: string): ScopeVariable | null {
  const target = normalizeObjectName(objectName);
  const targetParts = target.split('_').filter(Boolean);

  // Prefer exact match against common variants.
  const exactNames = new Set<string>([
    target,
    targetParts[targetParts.length - 1] ?? target,
  ]);

  for (const v of scope) {
    const vNorm = normalizeObjectName(v.name);
    if (exactNames.has(vNorm)) return v;
  }

  // Next: match variables containing the object name token.
  for (const v of scope) {
    const vNorm = normalizeObjectName(v.name);
    for (const part of targetParts) {
      if (part.length >= 3 && vNorm === part) return v;
    }
  }

  return null;
}

function findUserVariable(scope: ScopeVariable[]): ScopeVariable | null {
  const candidates = new Set(['user', 'currentuser', 'session', 'me']);
  for (const v of scope) {
    const n = v.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (candidates.has(n)) return v;
  }
  // Often user comes from context hooks: const { user } = useContext(...)
  const fromContext = scope.find((v) => v.source === 'useContext' && v.name.toLowerCase().includes('user'));
  return fromContext ?? null;
}
