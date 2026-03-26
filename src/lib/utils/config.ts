import * as fs from 'fs';
import * as path from 'path';

export interface LoglineConfig {
  eventGranularity: 'business' | 'granular';
  tracking: {
    destination: 'segment' | 'posthog' | 'mixpanel' | 'custom';
    importPath: string;
    functionName: string;
  };
  scan: {
    include: string[];
    exclude: string[];
  };
}

export function getDefaultConfig(): LoglineConfig {
  return {
    eventGranularity: 'business',
    tracking: {
      destination: 'custom',
      importPath: '@/lib/analytics',
      functionName: 'track',
    },
    scan: {
      include: ['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.js', 'src/**/*.jsx'],
      exclude: ['**/*.test.*', '**/*.spec.*', '**/node_modules/**'],
    },
  };
}

export function getConfigPath(cwd: string): string {
  return path.join(cwd, '.logline', 'config.json');
}

export function readLoglineConfig(cwd: string): LoglineConfig {
  const defaults = getDefaultConfig();
  const configPath = getConfigPath(cwd);
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<LoglineConfig> | null;
    const cfg = parsed ?? {};

    return {
      eventGranularity:
        cfg.eventGranularity === 'granular' ? 'granular' : 'business',
      tracking: {
        destination:
          cfg.tracking?.destination === 'segment' ||
          cfg.tracking?.destination === 'posthog' ||
          cfg.tracking?.destination === 'mixpanel' ||
          cfg.tracking?.destination === 'custom'
            ? cfg.tracking.destination
            : defaults.tracking.destination,
        importPath:
          typeof cfg.tracking?.importPath === 'string' && cfg.tracking.importPath.trim()
            ? cfg.tracking.importPath.trim()
            : defaults.tracking.importPath,
        functionName:
          typeof cfg.tracking?.functionName === 'string' && cfg.tracking.functionName.trim()
            ? cfg.tracking.functionName.trim()
            : defaults.tracking.functionName,
      },
      scan: {
        include: Array.isArray(cfg.scan?.include) && cfg.scan!.include!.length
          ? cfg.scan!.include!
              .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
              .map((x) => x.trim())
          : defaults.scan.include,
        exclude: Array.isArray(cfg.scan?.exclude)
          ? cfg.scan!.exclude!
              .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
              .map((x) => x.trim())
          : defaults.scan.exclude,
      },
    };
  } catch (err: any) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return defaults;

    const msg = String(err?.message ?? '');
    const posMatch = msg.match(/position\s+(\d+)/i);
    if (posMatch) {
      const pos = Number(posMatch[1]);
      try {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const prefix = raw.slice(0, pos);
        const line = prefix.split('\n').length;
        throw new Error(`Invalid config.json: JSON parse error at line ${line}`);
      } catch {
        // fall through
      }
    }
    throw new Error(`Invalid config.json: ${msg || 'unable to parse JSON'}`);
  }
}

