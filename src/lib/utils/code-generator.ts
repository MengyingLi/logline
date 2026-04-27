import type { TrackingGap } from '../discovery/tracking-gap-detector';
import type { SignalType } from '../types';
import { analyzeScope, type ScopeVariable } from './scope-analyzer';

// ─── useMutation detection ────────────────────────────────────────────────────

export interface MutationContext {
  found: boolean;
  hasOnSuccess: boolean;
  /** 1-indexed line of the first body line inside an existing onSuccess callback */
  onSuccessBodyLine: number | null;
  /** 1-indexed line of the useMutation closing `});` — insert new onSuccess just before it */
  mutationClosingLine: number | null;
  /** Typed props extracted from `async (arg: { prop: type }) =>` in the mutationFn */
  typedParams: Array<{ name: string; type: string }>;
  /** Whether the mutationFn destructs a `data` return from a DB call */
  hasDataReturn: boolean;
}

/**
 * Detect whether a given line is inside a useMutation hook and extract
 * structural information needed to place track() in the onSuccess callback.
 *
 * Searches ≤60 lines backward for `useMutation(`, then scans forward tracking
 * brace depth to find the closing `});` and any existing `onSuccess:` block.
 */
export function detectUseMutation(fileContent: string, nearLine: number): MutationContext {
  const none: MutationContext = {
    found: false, hasOnSuccess: false,
    onSuccessBodyLine: null, mutationClosingLine: null,
    typedParams: [], hasDataReturn: false,
  };

  const lines = fileContent.split('\n');
  const targetIdx = Math.max(0, nearLine - 1); // 0-indexed

  // Search backward for useMutation(
  let mutationStartIdx: number | null = null;
  const searchBack = Math.max(0, targetIdx - 60);
  for (let i = targetIdx; i >= searchBack; i--) {
    if (/\buseMutation\s*\(/.test(lines[i])) {
      mutationStartIdx = i;
      break;
    }
  }
  if (mutationStartIdx === null) return none;

  // Scan forward from mutationStartIdx tracking brace depth.
  // Start at 0 — the opening `{` of the useMutation object literal increments to 1.
  let depth = 0;
  let onSuccessIdx: number | null = null;
  let mutationEndIdx: number | null = null;

  for (let i = mutationStartIdx; i < Math.min(lines.length, mutationStartIdx + 150); i++) {
    const line = lines[i];
    if (onSuccessIdx === null && /\bonSuccess\s*:/.test(line)) onSuccessIdx = i;
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0 && i > mutationStartIdx) { mutationEndIdx = i; break; }
      }
    }
    if (mutationEndIdx !== null) break;
  }

  if (mutationEndIdx === null) return none;

  // Find the first body line of the onSuccess callback.
  let onSuccessBodyLine: number | null = null;
  if (onSuccessIdx !== null) {
    for (let i = onSuccessIdx; i < Math.min(lines.length, onSuccessIdx + 6); i++) {
      if (lines[i].includes('{')) {
        onSuccessBodyLine = i + 2; // 1-indexed: line after the opening `{`
        break;
      }
    }
  }

  // Extract typed params from `async (arg: { prop: type }) =>`
  const mutationContent = lines.slice(mutationStartIdx, mutationEndIdx + 1).join('\n');
  const typedParams: Array<{ name: string; type: string }> = [];
  const typedMatch = mutationContent.match(
    /(?:mutationFn\s*:\s*)?async\s*\(\s*\w+\s*:\s*\{([^}]+)\}\s*\)\s*=>/
  );
  if (typedMatch) {
    for (const field of typedMatch[1].split(/[;,]/)) {
      const fm = field.trim().match(/^(\w+)\??\s*:\s*(.+)$/);
      if (!fm || !fm[1] || fm[1].length < 2) continue;
      typedParams.push({ name: fm[1].trim(), type: fm[2].trim() });
    }
  }

  const hasDataReturn = /const\s*\{\s*data\b/.test(mutationContent);

  return {
    found: true,
    hasOnSuccess: onSuccessIdx !== null,
    onSuccessBodyLine,
    mutationClosingLine: mutationEndIdx + 1, // 1-indexed
    typedParams,
    hasDataReturn,
  };
}

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
  const mutCtx = fileContent ? detectUseMutation(fileContent, targetLine) : null;
  const props = fileContent ? inferProperties(gap, fileContent, targetLine, mutCtx) : inferPropertiesFallback(gap);
  const signalType = options?.signalType ?? gap.signalType ?? 'action';
  const fn = options?.functionName?.trim() ? options.functionName.trim() : 'track';
  const loggerName = options?.logging?.instanceName ?? 'logger';

  const propsStr = props.length === 0
    ? '  // TODO: add properties from available context'
    : props
        .map((p) => `  ${p.name}: ${p.value},${p.todo ? ' // TODO: verify' : ''}`)
        .join('\n');

  let trackCall: string;
  if (signalType === 'operation') {
    trackCall = `// Logline: ${gap.suggestedEvent}
${loggerName}.info('${gap.suggestedEvent}', {
${propsStr}
});`;
  } else if (signalType === 'error') {
    trackCall = `// Logline: ${gap.suggestedEvent}
${loggerName}.error('${gap.suggestedEvent}', {
${propsStr}
});`;
  } else if (signalType === 'state_change') {
    trackCall = `// Logline: ${gap.suggestedEvent}
${fn}('${gap.suggestedEvent}', {
${propsStr}
});
${loggerName}.info('${gap.suggestedEvent}', {
${propsStr}
});`;
  } else {
    // default: action → track()
    trackCall = `// Logline: ${gap.suggestedEvent}
${fn}('${gap.suggestedEvent}', {
${propsStr}
});`;
  }

  // For useMutation without an existing onSuccess, wrap in an onSuccess callback.
  if (mutCtx?.found && !mutCtx.hasOnSuccess) {
    const inner = trackCall.split('\n').map((l) => `  ${l}`).join('\n');
    return `onSuccess: (data, variables) => {\n${inner}\n},`;
  }

  return trackCall;
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
  targetLine: number,
  mutCtx?: MutationContext | null
): Array<{ name: string; value: string; todo: boolean }> {
  // For useMutation hooks, use data/variables as property sources.
  if (mutCtx?.found) {
    return inferMutationProperties(gap, mutCtx);
  }

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

/**
 * Property inference for useMutation hooks.
 * In onSuccess callbacks, `data` is the server return value and
 * `variables` is the input passed to mutate(). We always use these
 * standard names regardless of what the mutationFn parameter is called.
 */
function inferMutationProperties(
  gap: TrackingGap,
  mutCtx: MutationContext
): Array<{ name: string; value: string; todo: boolean }> {
  const props: Array<{ name: string; value: string; todo: boolean }> = [];
  const eventParts = gap.suggestedEvent.split('_');
  const objectName = eventParts.slice(0, -1).join('_') || 'unknown';

  // Input properties from typed mutationFn params → variables.prop in onSuccess
  const useful = mutCtx.typedParams.filter((p) => USEFUL_PROPS.has(p.name)).slice(0, 4);
  for (const param of useful) {
    props.push({ name: param.name, value: `variables.${param.name}`, todo: false });
  }
  // All remaining non-skipped params not already included
  for (const param of mutCtx.typedParams) {
    if (SKIP_INTERNAL_PROPS.has(param.name)) continue;
    if (props.some((p) => p.name === param.name)) continue;
    props.push({ name: param.name, value: `variables.${param.name}`, todo: false });
  }

  // Entity ID from the DB return value (data?.id)
  if (mutCtx.hasDataReturn && objectName !== 'unknown') {
    props.push({ name: `${objectName}_id`, value: 'data?.id', todo: false });
  }

  // Changes array for _edited events
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
