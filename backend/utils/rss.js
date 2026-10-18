// Just enough RSS 2.0 (and Atom) reading for news headlines: title, link
// and date per item. A full XML parser would be a new dependency for
// three fields from well-formed feeds; anything this can't read is
// skipped rather than guessed at.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

// Text of the first <tag>, CDATA unwrapped, any markup inside dropped,
// entities decoded and whitespace collapsed.
function tagText(block, tag) {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return '';
  const raw = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return decodeEntities(raw.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// Only plain web links are kept: a feed that carries "javascript:" or
// "data:" links can't put a script behind a headline on the dashboard.
function safeLink(href) {
  try {
    const u = new URL(href.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

// Returns [{ title, link, publishedAt (ISO string or null) }].
function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const block of blocks) {
    const title = tagText(block, 'title');
    let href = tagText(block, 'link');
    if (!href) {
      const atom = block.match(/<link\b[^>]*\bhref="([^"]+)"/i); // Atom: <link href="..."/>
      href = atom ? decodeEntities(atom[1]) : '';
    }
    const link = safeLink(href);
    if (!title || !link) continue;
    const dateText = tagText(block, 'pubDate') || tagText(block, 'published') || tagText(block, 'updated') || tagText(block, 'dc:date');
    const time = Date.parse(dateText);
    items.push({ title: title.slice(0, 300), link, publishedAt: Number.isFinite(time) ? new Date(time).toISOString() : null });
  }
  return items;
}

module.exports = { parseFeed, decodeEntities, safeLink };
