import type { TrackingGap } from '../discovery/tracking-gap-detector';
import type { SignalType } from '../types';
import { analyzeScope, type ScopeVariable } from './scope-analyzer';

export function generateTrackingCode(
  gap: TrackingGap,
  fileContent?: string,
  effectiveLine?: number,
  options?: {
    functionName?: string;
    signalType?: SignalType;
    logging?: { importPath: string; instanceName: string };
  }
): string {
  const targetLine = effectiveLine ?? gap.location?.line ?? 0;
  const props = fileContent ? inferProperties(gap, fileContent, targetLine) : inferPropertiesFallback(gap);
  const signalType = options?.signalType ?? gap.signalType ?? 'action';
  const fn = options?.functionName?.trim() ? options.functionName.trim() : 'track';
  const loggerName = options?.logging?.instanceName ?? 'logger';

  const propsStr = props
    .map((p) => `  ${p.name}: ${p.value},${p.todo ? ' // TODO: verify' : ''}`)
    .join('\n');

  if (signalType === 'operation') {
    return `// Logline: ${gap.suggestedEvent}
${loggerName}.info('${gap.suggestedEvent}', {
${propsStr}
});`;
  }

  if (signalType === 'error') {
    return `// Logline: ${gap.suggestedEvent}
${loggerName}.error('${gap.suggestedEvent}', {
${propsStr}
});`;
  }

  if (signalType === 'state_change') {
    return `// Logline: ${gap.suggestedEvent}
${fn}('${gap.suggestedEvent}', {
${propsStr}
});
${loggerName}.info('${gap.suggestedEvent}', {
${propsStr}
});`;
  }

  // default: action → track()
  return `// Logline: ${gap.suggestedEvent}
${fn}('${gap.suggestedEvent}', {
${propsStr}
});`;
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

  // 2) User/auth variable (skip if the object IS the user — would duplicate user_id)
  if (objectName !== 'user') {
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

  // 4) _name property when object has 'name' in scope
  if (objectVar && objectVar.properties?.includes('name')) {
    props.push({
      name: `${objectName}_name`,
      value: `${objectVar.accessPath}.name`,
      todo: false,
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
  if (objectName !== 'user') {
    props.push({ name: 'user_id', value: 'user?.id', todo: true });
  }
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
