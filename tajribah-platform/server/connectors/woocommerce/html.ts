/**
 * P6 — WooCommerce descriptions arrive as HTML (WordPress wraps paragraphs in <p> and single line
 * breaks in <br />). Our catalogue keeps plain text. `htmlToText` turns paragraphs back into blank
 * lines and breaks into newlines, drops every other tag, decodes entities, and keeps the text's own
 * spacing (a tab or a right-to-left mark in an Arabic description is content, not markup).
 */
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#039': "'" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#039);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1]!.toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = decodeEntities(html
    .replace(/\r\n?/g, '\n')
    .replace(/<\/p>\s*<p(\s[^>]*)?>/gi, '\n\n')
    .replace(/<br\s*\/?>\n?/gi, '\n')
    .replace(/<\/?p(\s[^>]*)?>\n?/gi, '')
    .replace(/<[^>]*>/g, ''))
    .replace(/^\n+|\n+$/g, '');
  return text.trim() === '' ? null : text;
}

/** Plain text → the HTML WordPress would store for it (the store double's side of the round trip). */
export function textToHtml(text: string | null): string {
  if (!text) return '';
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text.split('\n\n').map((para) => `<p>${escape(para).replace(/\n/g, '<br />\n')}</p>`).join('\n');
}
