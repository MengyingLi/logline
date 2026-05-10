/** Mask API keys for safe display in HTML (never log raw keys). */
export function maskApiKey(key: string): string {
  if (!key || key.length < 10) return 'lk_••••';
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}
