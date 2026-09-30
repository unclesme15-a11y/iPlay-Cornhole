/**
 * A small Markdown-to-HTML renderer for the legal pages (privacy policy, terms). It supports only what those files use:
 * headings, paragraphs, bullet and numbered lists, block quotes, tables, **bold**, *italic*, `code` and [links](https://…).
 * Everything is HTML-escaped first, so a stray "<" in a document can never become markup, and links only allow
 * http(s), mailto and same-site paths.
 */
export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const SAFE_URL = /^(https?:\/\/|mailto:|\/(?!\/))/i;

function inline(text: string): string {
  // Code spans first, parked so their contents are not formatted.
  const parked: string[] = [];
  let t = escapeHtml(text).replace(/`([^`]+)`/g, (_m, code: string) => {
    parked.push(`<code>${code}</code>`);
    return `\u0000${parked.length - 1}\u0000`;
  });
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) =>
    SAFE_URL.test(url.replace(/&amp;/g, '&')) ? `<a href="${url}">${label}</a>` : label,
  );
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>');
  return t.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => parked[Number(i)]!);
}

const isTableRow = (l: string): boolean => /^\s*\|.*\|\s*$/.test(l);
const isTableRule = (l: string): boolean => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l);
const cells = (l: string): string[] => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d+\.\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  const special = (l: string): boolean =>
    l.trim() === '' || HEADING.test(l) || l.trimStart().startsWith('>') || BULLET.test(l) || NUMBERED.test(l) || isTableRow(l);

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i++;
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      const level = h[1]!.length;
      out.push(`<h${level}>${inline(h[2]!)}</h${level}>`);
      i++;
      continue;
    }
    if (line.trimStart().startsWith('>')) {
      const quoted: string[] = [];
      while (i < lines.length && lines[i]!.trimStart().startsWith('>')) quoted.push(lines[i++]!.trimStart().replace(/^>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(quoted.join('\n'))}</blockquote>`);
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && isTableRule(lines[i + 1]!)) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i]!)) rows.push(cells(lines[i++]!));
      out.push(
        '<div class="table"><table><thead><tr>' +
          head.map((c) => `<th>${inline(c)}</th>`).join('') +
          '</tr></thead><tbody>' +
          rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
          '</tbody></table></div>',
      );
      continue;
    }
    const list = BULLET.test(line) ? BULLET : NUMBERED.test(line) ? NUMBERED : null;
    if (list) {
      const items: string[] = [];
      while (i < lines.length && list.test(lines[i]!)) {
        let item = list.exec(lines[i++]!)![1]!;
        // indented continuation lines belong to the item
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]!) && !BULLET.test(lines[i]!) && !NUMBERED.test(lines[i]!)) item += ' ' + lines[i++]!.trim();
        items.push(`<li>${inline(item)}</li>`);
      }
      const tag = list === BULLET ? 'ul' : 'ol';
      out.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && !special(lines[i]!)) para.push(lines[i++]!.trim());
    if (para.length === 0) para.push(lines[i++]!.trim());
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}
