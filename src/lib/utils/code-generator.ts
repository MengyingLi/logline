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

  const propsStr = props.length === 0
    ? '  // TODO: add properties from available context'
    : props
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

/**
 * Semantically meaningful TypeScript object properties we're willing to suggest.
 * Excludes internal framework fields and large data blobs.
 */
const USEFUL_PROPS = new Set(['id', 'email', 'name', 'status', 'role', 'type', 'title', 'slug', 'key', 'url']);

/**
 * Internal / framework-generated properties to skip when enumerating typed fields.
 */
const SKIP_INTERNAL_PROPS = new Set(['__typename', 'loading', 'error', 'isLoading', 'isError', 'isPending']);

function inferProperties(
  gap: TrackingGap,
  fileContent: string,
  targetLine: number
): Array<{ name: string; value: string; todo: boolean }> {
  const scope = analyzeScope(fileContent, targetLine);
  const props: Array<{ name: string; value: string; todo: boolean }> = [];
  const eventParts = gap.suggestedEvent.split('_');
  const objectName = eventParts.slice(0, -1).join('_') || 'unknown';

  // 1) Primary object variable — only emit if found in scope; never guess.
  const objectVar = objectName !== 'unknown' ? findObjectVariable(scope, objectName) : null;
  if (objectVar) {
    const typedProps = (objectVar.properties ?? []).filter((p) => !SKIP_INTERNAL_PROPS.has(p));
    if (typedProps.length > 0) {
      // Emit known meaningful properties from the TypeScript type definition.
      const useful = typedProps.filter((p) => USEFUL_PROPS.has(p)).slice(0, 4);
      for (const prop of useful) {
        props.push({
          name: prop === 'id' ? `${objectName}_id` : prop,
          value: `${objectVar.accessPath}.${prop}`,
          todo: false,
        });
      }
      // If id wasn't in the type, add it with a TODO so instrumentation is complete.
      if (!typedProps.includes('id')) {
        props.push({ name: `${objectName}_id`, value: `${objectVar.accessPath}?.id`, todo: true });
      }
    } else {
      // Variable found but type unknown — suggest .id with TODO rather than omitting.
      props.push({ name: `${objectName}_id`, value: `${objectVar.accessPath}?.id`, todo: true });
    }
  }
  // If objectVar NOT found: don't guess — caller renders a TODO comment.

  // 2) User/auth variable — only emit if a user/session variable exists in scope.
  if (objectName !== 'user') {
    const userVar = findUserVariable(scope);
    if (userVar) {
      const isSession = userVar.name === 'session';
      props.push({
        name: 'user_id',
        value: isSession ? `${userVar.accessPath}?.user?.id` : `${userVar.accessPath}?.id`,
        todo: false,
      });
    }
    // No fallback: if no user variable in scope, omit user_id rather than hallucinating one.
  }

  // 3) Extra context from parameters (type/status-like enum values)
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

  // 4) Changes array for "edited" events
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
  // No scope info: don't guess variable names that may not exist.
  // Only emit the deterministic 'changes' property for _edited events.
  const props: Array<{ name: string; value: string; todo: boolean }> = [];
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
