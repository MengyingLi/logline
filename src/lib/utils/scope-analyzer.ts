export interface ScopeVariable {
  name: string;
  type?: string;
  accessPath: string;
  source:
    | 'parameter'
    | 'useState'
    | 'useContext'
    | 'useQuery'
    | 'useParams'
    | 'useMutation'
    | 'destructured'
    | 'imported'
    | 'const';
  properties?: string[];
  line: number;
}

type TypeProperties = Map<string, string[]>;

export function analyzeScope(fileContent: string, targetLine: number): ScopeVariable[] {
  const lines = fileContent.split('\n');
  const tLine = clampLine(targetLine, lines.length);
  const types = extractTypeProperties(fileContent);

  const functionRange = findEnclosingFunctionRange(lines, tLine);
  const startLine = functionRange?.startLine ?? 1;

  // Approximate block scoping via brace depth. Variables declared in deeper blocks
  // than the target position are treated as out-of-scope at targetLine.
  const depthByLine = computeBraceDepthByLine(lines);
  const targetDepth = depthByLine[tLine - 1] ?? 0;

  const vars: ScopeVariable[] = [];

  // 1) Parameters (only if we found a plausible function start)
  if (functionRange) {
    const signatureText = collectSignatureText(lines, functionRange.startLine);
    vars.push(...extractParameters(signatureText, functionRange.startLine, types));
  }

  // 2+) Walk forward from function start to targetLine-1 and collect declarations
  for (let i = startLine; i < tLine; i++) {
    const line = lines[i - 1] ?? '';
    const depth = depthByLine[i - 1] ?? 0;
    if (depth > targetDepth) continue;

    vars.push(...extractUseState(line, i, types));
    vars.push(...extractUseContext(line, i));
    vars.push(...extractUseQueryLike(line, i));
    vars.push(...extractUseParams(line, i));
    vars.push(...extractDestructuring(line, i, types));
    vars.push(...extractConstDeclarations(line, i));
  }

  // Deduplicate by variable name (prefer later declarations with more type info)
  const byName = new Map<string, ScopeVariable>();
  for (const v of vars) {
    const existing = byName.get(v.name);
    if (!existing) {
      byName.set(v.name, v);
      continue;
    }
    const existingHasType = Boolean(existing.type);
    const nextHasType = Boolean(v.type);
    if (!existingHasType && nextHasType) {
      byName.set(v.name, v);
      continue;
    }
    if ((v.line ?? 0) > (existing.line ?? 0)) byName.set(v.name, v);
  }

  return Array.from(byName.values());
}

function clampLine(line: number, max: number): number {
  if (!Number.isFinite(line) || line <= 0) return 1;
  if (line > max) return max;
  return Math.floor(line);
}

function computeBraceDepthByLine(lines: string[]): number[] {
  const depths: number[] = [];
  let depth = 0;
  for (const line of lines) {
    // Count braces in a naive way. It's imperfect (strings/comments), but good enough
    // for typical React/TS patterns.
    const open = (line.match(/\{/g) ?? []).length;
    const close = (line.match(/\}/g) ?? []).length;
    depths.push(depth);
    depth += open - close;
    if (depth < 0) depth = 0;
  }
  return depths;
}

function findEnclosingFunctionRange(
  lines: string[],
  targetLine: number
): { startLine: number } | null {
  // Heuristic: walk backwards until we hit a function-ish line that introduces a block.
  for (let i = targetLine; i >= 1; i--) {
    const line = lines[i - 1] ?? '';
    if (/\bfunction\s+\w+\s*\(/.test(line) && line.includes('{')) return { startLine: i };
    if (/\bconst\s+\w+\s*=\s*(?:async\s*)?\(.*\)\s*=>/.test(line) && line.includes('{')) return { startLine: i };
    if (/\)\s*=>\s*\{/.test(line)) return { startLine: i };
  }
  return null;
}

function collectSignatureText(lines: string[], startLine: number): string {
  // Collect a small window until we hit '{' (or a reasonable limit).
  const maxLines = 6;
  const parts: string[] = [];
  for (let i = startLine; i <= Math.min(lines.length, startLine + maxLines); i++) {
    const l = lines[i - 1] ?? '';
    parts.push(l);
    if (l.includes('{')) break;
  }
  return parts.join('\n');
}

function extractParameters(signatureText: string, line: number, types: TypeProperties): ScopeVariable[] {
  const m = signatureText.match(/\(([\s\S]*?)\)/);
  if (!m) return [];

  const rawParams = m[1].trim();
  if (!rawParams) return [];

  const params = splitTopLevelCommas(rawParams);
  const out: ScopeVariable[] = [];

  for (const p of params) {
    const param = p.trim();
    if (!param) continue;

    // Destructured param: ({ user, workflow }: Props)
    const destructured = param.match(/^\{\s*([^}]+)\s*\}\s*(?::\s*([^=]+))?/);
    if (destructured) {
      const inner = destructured[1] ?? '';
      const names = inner
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const parts = s.split(':').map((x) => x.trim());
          return parts[1] || parts[0];
        })
        .filter(Boolean);

      const typeName = cleanTypeName(destructured[2] ?? '');
      const props = typeName ? types.get(typeName) : undefined;

      for (const name of names) {
        out.push({
          name,
          type: undefined,
          accessPath: name,
          source: 'parameter',
          properties: props,
          line,
        });
      }
      continue;
    }

    // Standard param: (workflow: Workflow) or (workflow = default)
    const [namePart, typePartRaw] = param.split(':');
    const name = (namePart ?? '').split('=')[0].trim();
    if (!name) continue;
    const type = typePartRaw ? cleanTypeName(typePartRaw) : undefined;
    out.push({
      name,
      type,
      accessPath: name,
      source: 'parameter',
      properties: type ? types.get(type) : undefined,
      line,
    });
  }

  return out;
}

function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let buf = '';
  let depthParen = 0;
  let depthAngle = 0;
  let depthBrace = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(') depthParen++;
    if (ch === ')') depthParen = Math.max(0, depthParen - 1);
    if (ch === '<') depthAngle++;
    if (ch === '>') depthAngle = Math.max(0, depthAngle - 1);
    if (ch === '{') depthBrace++;
    if (ch === '}') depthBrace = Math.max(0, depthBrace - 1);

    if (ch === ',' && depthParen === 0 && depthAngle === 0 && depthBrace === 0) {
      out.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf);
  return out;
}

function extractUseState(line: string, lineNo: number, types: TypeProperties): ScopeVariable[] {
  // const [workflow, setWorkflow] = useState<Workflow>(...)
  const m = line.match(/\bconst\s*\[\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*set[A-Za-z0-9_]+\s*\]\s*=\s*useState(?:<([^>]+)>)?/);
  if (!m) return [];
  const name = m[1];
  const type = m[2] ? cleanTypeName(m[2]) : undefined;
  return [{
    name,
    type,
    accessPath: name,
    source: 'useState',
    properties: type ? types.get(type) : undefined,
    line: lineNo,
  }];
}

function extractUseContext(line: string, lineNo: number): ScopeVariable[] {
  // const { user } = useContext(AuthContext)
  const destructured = line.match(/\bconst\s*\{\s*([^}]+)\s*\}\s*=\s*useContext\s*\(/);
  if (destructured) {
    const names = destructured[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const parts = s.split(':').map((x) => x.trim());
        return parts[1] || parts[0];
      })
      .filter(Boolean);
    return names.map((name) => ({
      name,
      accessPath: name,
      source: 'useContext' as const,
      line: lineNo,
    }));
  }

  // const auth = useContext(AuthContext)
  const direct = line.match(/\bconst\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*useContext\s*\(/);
  if (direct) {
    const name = direct[1];
    return [{
      name,
      accessPath: name,
      source: 'useContext',
      line: lineNo,
    }];
  }

  return [];
}

function extractUseQueryLike(line: string, lineNo: number): ScopeVariable[] {
  const out: ScopeVariable[] = [];

  // const { data } = useQuery(...)
  const q = line.match(/\bconst\s*\{\s*([^}]+)\s*\}\s*=\s*use(Query|Mutation)\s*[(<]/);
  if (q) {
    const names = (q[1] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const parts = s.split(':').map((x) => x.trim());
        return parts[1] || parts[0];
      })
      .filter(Boolean);
    const source = q[2] === 'Mutation' ? 'useMutation' : 'useQuery';
    for (const name of names) {
      out.push({ name, accessPath: name, source: source as any, line: lineNo });
    }
    return out;
  }

  // const result = useQuery(...)
  const direct = line.match(/\bconst\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*useQuery\s*[(<]/);
  if (direct) {
    out.push({ name: direct[1], accessPath: direct[1], source: 'useQuery', line: lineNo });
  }

  return out;
}

function extractUseParams(line: string, lineNo: number): ScopeVariable[] {
  // const { id } = useParams()
  const m = line.match(/\bconst\s*\{\s*([^}]+)\s*\}\s*=\s*useParams\s*(?:<[^>]+>)?\s*\(/);
  if (!m) return [];
  const names = (m[1] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const parts = s.split(':').map((x) => x.trim());
      return parts[1] || parts[0];
    })
    .filter(Boolean);
  return names.map((name) => ({
    name,
    accessPath: name,
    source: 'useParams',
    line: lineNo,
  }));
}

function extractDestructuring(line: string, lineNo: number, types: TypeProperties): ScopeVariable[] {
  // const { workflow, step } = props
  const m = line.match(/\bconst\s*\{\s*([^}]+)\s*\}\s*=\s*([A-Za-z_][A-Za-z0-9_\.]*)/);
  if (!m) return [];
  const inner = m[1] ?? '';
  const rhs = m[2] ?? '';
  const names = inner
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      // support renames: user: currentUser
      const parts = s.split(':').map((x) => x.trim());
      return parts[1] || parts[0];
    })
    .filter(Boolean);

  // If destructuring includes an explicit annotation on the line, try to capture it:
  // const { workflow }: Props = props
  const typeAnnotation = line.match(/\}\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
  const typeName = typeAnnotation?.[1];
  const props = typeName ? types.get(typeName) : undefined;

  return names.map((name) => ({
    name,
    accessPath: name,
    source: 'destructured' as const,
    properties: props,
    line: lineNo,
  }));
}

function extractConstDeclarations(line: string, lineNo: number): ScopeVariable[] {
  // const foo = ... / let foo = ... / var foo = ...
  const m = line.match(/\b(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
  if (!m) return [];
  const name = m[1];
  if (!name) return [];
  return [{
    name,
    accessPath: name,
    source: 'const',
    line: lineNo,
  }];
}

function cleanTypeName(t: string): string {
  return t
    .trim()
    .replace(/[\s=].*$/, '')
    .replace(/\|.*$/, '')
    .replace(/&.*$/, '')
    .replace(/\[\]$/, '')
    .trim();
}

function extractTypeProperties(fileContent: string): TypeProperties {
  const types: TypeProperties = new Map();
  const lines = fileContent.split('\n');

  const tryParseBlock = (startIdx: number, typeName: string): void => {
    const props: string[] = [];
    for (let i = startIdx; i < lines.length; i++) {
      const l = lines[i] ?? '';
      if (l.includes('}')) break;
      const pm = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\??\s*:/);
      if (pm) props.push(pm[1]);
    }
    if (props.length > 0) types.set(typeName, props);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    const iface = line.match(/^\s*export\s+interface\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/)
      ?? line.match(/^\s*interface\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/);
    if (iface) {
      tryParseBlock(i + 1, iface[1]);
      continue;
    }

    const typeObj = line.match(/^\s*export\s+type\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{/)
      ?? line.match(/^\s*type\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{/);
    if (typeObj) {
      tryParseBlock(i + 1, typeObj[1]);
      continue;
    }
  }

  return types;
}

