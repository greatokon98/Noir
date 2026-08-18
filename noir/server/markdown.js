// markdown.js
// Tiny, dependency-free Markdown renderer. HTML is escaped first, then block
// and inline transforms are applied — no user HTML ever reaches the page.

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inline(text) {
  let t = escapeHtml(text);
  // links: [label](url) — reject non-http(s) URIs (e.g. javascript:)
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function(_, label, url) {
    return /^https?:\/\//i.test(url)
      ? '<a href="' + url + '" target="_blank" rel="noopener">' + label + '</a>'
      : label;
  });
  // bold **x**
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // italic *x* (not part of a bold run)
  t = t.replace(/\B\*([^*\n]+)\*\B/g, '<em>$1</em>');
  return t;
}

function render(md) {
  const lines = String(md || '').split('\n');
  const html = [];
  let list = [];

  const flushList = () => {
    if (list.length) {
      html.push('<ul>' + list.join('') + '</ul>');
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trim();

    if (/^([-*]|\d+\.)\s+/.test(line)) {
      list.push('<li>' + inline(line.replace(/^([-*]|\d+\.)\s+/, '')) + '</li>');
      continue;
    }
    flushList();

    if (line === '') continue;
    if (/^---+\s*$/.test(line)) {
      html.push('<hr>');
      continue;
    }
    if (/^###\s+/.test(line)) {
      html.push('<h4>' + inline(line.replace(/^###\s+/, '')) + '</h4>');
      continue;
    }
    if (/^##\s+/.test(line)) {
      html.push('<h3>' + inline(line.replace(/^##\s+/, '')) + '</h3>');
      continue;
    }
    if (/^#\s+/.test(line)) {
      html.push('<h2>' + inline(line.replace(/^#\s+/, '')) + '</h2>');
      continue;
    }
    if (/^>\s?/.test(line)) {
      html.push('<blockquote>' + inline(line.replace(/^>\s?/, '')) + '</blockquote>');
      continue;
    }
    html.push('<p>' + inline(line) + '</p>');
  }
  flushList();
  return html.join('\n');
}

module.exports = { render, escapeHtml };
