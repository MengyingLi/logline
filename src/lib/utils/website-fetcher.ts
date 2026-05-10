/**
 * Fetch a product website and extract the most useful text for product understanding:
 * title, meta description, og tags, and h1/h2 headings.
 *
 * Uses no external dependencies — just fetch + regex on the raw HTML.
 * Designed to be fast and gracefully degrade on failures.
 */

function extractTag(html: string, pattern: RegExp): string {
  return html.match(pattern)?.[1]?.trim().replace(/\s+/g, ' ') ?? '';
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export async function fetchWebsiteContent(url: string): Promise<string> {
  // Normalize — add https:// if missing
  const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;

  const res = await fetch(normalized, {
    headers: {
      'User-Agent': 'logline-cli (product analytics setup; fetches homepage text only)',
      Accept: 'text/html',
    },
    signal: AbortSignal.timeout(8000),
    redirect: 'follow',
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const parts: string[] = [];

  const title = extractTag(html, /<title[^>]*>([^<]{1,200})<\/title>/i);
  if (title) parts.push(`Title: ${decodeEntities(title)}`);

  const ogTitle = extractTag(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,300})["']/i)
    || extractTag(html, /<meta[^>]+content=["']([^"']{1,300})["'][^>]+property=["']og:title["']/i);
  if (ogTitle && ogTitle !== title) parts.push(`OG title: ${decodeEntities(ogTitle)}`);

  const metaDesc = extractTag(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,500})["']/i)
    || extractTag(html, /<meta[^>]+content=["']([^"']{1,500})["'][^>]+name=["']description["']/i);
  if (metaDesc) parts.push(`Description: ${decodeEntities(metaDesc)}`);

  const ogDesc = extractTag(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{1,500})["']/i)
    || extractTag(html, /<meta[^>]+content=["']([^"']{1,500})["'][^>]+property=["']og:description["']/i);
  if (ogDesc && ogDesc !== metaDesc) parts.push(`OG description: ${decodeEntities(ogDesc)}`);

  // h1 and h2 headings (first 5)
  const headings: string[] = [];
  const headingRe = /<h[12][^>]*>([\s\S]{1,200}?)<\/h[12]>/gi;
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(html)) !== null && headings.length < 5) {
    const text = decodeEntities(stripTags(m[1]));
    if (text.length > 3) headings.push(text);
  }
  if (headings.length) parts.push(`Headings: ${headings.join(' · ')}`);

  return parts.join('\n');
}
