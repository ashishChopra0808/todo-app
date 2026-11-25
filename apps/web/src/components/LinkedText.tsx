import { Fragment } from 'react';

/** http(s) addresses and www. ones; trailing punctuation stays text. */
const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]}])/gi;

/**
 * Text with web addresses turned into links that open in a new tab. Only http(s) links are
 * made (never javascript: or other schemes); everything else stays plain, escaped text.
 */
export function LinkedText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[1]!;
    const start = m.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    const href = raw.startsWith('www.') ? `https://${raw}` : raw;
    let safe: string | null = null;
    try {
      const u = new URL(href);
      if (u.protocol === 'https:' || u.protocol === 'http:') safe = u.href;
    } catch {
      safe = null;
    }
    parts.push(
      safe ? (
        <a
          key={start}
          href={safe}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          className="text-link"
        >
          {raw}
        </a>
      ) : (
        raw
      ),
    );
    last = start + raw.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return (
    <>{parts.map((p, i) => (typeof p === 'string' ? <Fragment key={`t${i}`}>{p}</Fragment> : p))}</>
  );
}
