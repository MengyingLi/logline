import chalk from 'chalk';

/** ASCII progress bar: green filled, dim empty. */
export function coverageBar(pct: number, width = 20): string {
  const filled = Math.round((pct / 100) * width);
  return chalk.green('█'.repeat(filled)) + chalk.dim('░'.repeat(width - filled));
}

/** Color-coded priority label, padded to 8 chars for column alignment. */
export function priorityLabel(priority: string | undefined): string {
  switch (priority) {
    case 'critical': return chalk.red.bold('critical');
    case 'high':     return chalk.yellow('high    ');
    case 'medium':   return chalk.cyan('medium  ');
    default:         return chalk.dim('low     ');
  }
}

/** Truncate a string to max chars, appending … if cut. */
export function trunc(s: string, max: number): string {
  if (s.length <= max) return s.padEnd(max);
  return s.slice(0, max - 1) + '…';
}
