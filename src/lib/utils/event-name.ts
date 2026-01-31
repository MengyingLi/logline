export function isValidEventName(name: string): boolean {
  // Reject known garbage patterns
  const GARBAGE_PATTERNS = [
    /^save_saved$/,
    /^add_added$/,
    /^remove_removed$/,
    /^remove_deleted$/,
    /^delete_deleted$/,
    /^update_updated$/,
    /^change_changed$/,
    /^click_clicked$/,
    /^submit_submitted$/,
  ];

  if (GARBAGE_PATTERNS.some((p) => p.test(name))) {
    return false;
  }

  // Must be object_verb format with actual object
  const parts = name.split('_').filter(Boolean);
  if (parts.length < 2) return false;

  const verb = parts[parts.length - 1];
  const object = parts.slice(0, -1).join('_');
  if (!object || !verb) return false;

  // Object must be meaningful (not just verb repeated)
  if (object === verb || object === verb.replace(/ed$/, '') || object === verb.replace(/d$/, '')) {
    return false;
  }

  // Avoid "x_action" style placeholders
  if (object.length < 3) return false;

  return true;
}

const IGNORED_EVENTS = [
  /^key_/,
  /^mouse_/,
  /^drag_/,
  /^scroll_/,
  /^focus_/,
  /^blur_/,
  /^hover_/,
  /^resize_/,
];

export function isBusinessEvent(eventName: string): boolean {
  return !IGNORED_EVENTS.some((p) => p.test(eventName));
}

export function toSnakeCaseFromWords(words: string[]): string {
  return words
    .map((w) => w.trim())
    .filter(Boolean)
    .join('_')
    .replace(/__+/g, '_')
    .toLowerCase();
}

export function toSnakeCaseFromPascalOrCamel(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .toLowerCase()
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function extractLikelyObjectFromPath(filePath: string): string | null {
  // Use the nearest meaningful directory/file name
  const base = filePath.split(/[\\/]/).filter(Boolean).pop() ?? '';
  const cleaned = base.replace(/\.(ts|tsx|js|jsx)$/, '');
  if (!cleaned) return null;

  // Index/route components are not meaningful objects
  if (['index', 'route', 'page', 'app'].includes(cleaned.toLowerCase())) return null;

  // Convert CamelCase/PascalCase to snake-ish
  const snake = toSnakeCaseFromPascalOrCamel(cleaned);

  return snake.length >= 3 ? snake : null;
}

