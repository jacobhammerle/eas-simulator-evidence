// Renders the subset of Markdown that agents write in a report: headings,
// paragraphs, bullet and numbered lists, fenced code, block quotes, rules,
// `code`, **bold**, [links](https://...), and bare URLs. Nothing else, on
// purpose. The report is untrusted text, so every character is escaped
// before any tag is added, a link is only made for an http(s) URL, and
// unknown syntax stays visible as typed. Line breaks inside a paragraph
// are kept, the way GitHub renders a comment, because the same report
// goes into the pull-request comment.
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const link = (href, label) =>
  `<a href="${esc(href)}" target="_blank" rel="noopener">${label}</a>`;

// Inline: code spans, bold, explicit links, bare URLs. Leftmost match
// wins, so a `**` inside a code span is never bold.
const INLINE =
  /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])/g;

export function inlineMarkdown(raw) {
  let out = "";
  let last = 0;
  // matchAll works on its own copy of the regex, so the recursion for
  // bold cannot disturb this loop's position.
  for (const m of String(raw ?? "").matchAll(INLINE)) {
    out += esc(raw.slice(last, m.index));
    if (m[1] !== undefined) out += `<code>${esc(m[1])}</code>`;
    else if (m[2] !== undefined) out += `<strong>${inlineMarkdown(m[2])}</strong>`;
    else if (m[3] !== undefined) out += link(m[4], esc(m[3]));
    else out += link(m[5], esc(m[5]));
    last = m.index + m[0].length;
  }
  return out + esc(raw.slice(last));
}

const BULLET = /^\s*[-*+]\s+/;
const NUMBER = /^\s*(\d+)[.)]\s+/;
const QUOTE = /^\s*>\s?/;
const FENCE = /^\s*```/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;

export function renderMarkdown(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let para = [];
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(inlineMarkdown).join("<br>")}</p>`);
    para = [];
  };
  // Collects consecutive lines that match `re`, stripped of the marker.
  const run = (i, re) => {
    const items = [];
    while (i < lines.length && re.test(lines[i])) items.push(lines[i++].replace(re, ""));
    return { items, next: i };
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (FENCE.test(raw)) {
      flush();
      const buf = [];
      for (i++; i < lines.length && !FENCE.test(lines[i]); i++) buf.push(esc(lines[i]));
      out.push(`<pre><code>${buf.join("\n")}</code></pre>`);
      continue;
    }
    if (!raw.trim()) {
      flush();
      continue;
    }
    let m;
    if ((m = HEADING.exec(raw))) {
      flush();
      const tag = m[1].length <= 2 ? "h3" : "h4";
      out.push(`<${tag}>${inlineMarkdown(m[2])}</${tag}>`);
      continue;
    }
    if (RULE.test(raw)) {
      flush();
      out.push("<hr>");
      continue;
    }
    if (BULLET.test(raw)) {
      flush();
      const r = run(i, BULLET);
      out.push(`<ul>${r.items.map((t) => `<li>${inlineMarkdown(t)}</li>`).join("")}</ul>`);
      i = r.next - 1;
      continue;
    }
    if ((m = NUMBER.exec(raw))) {
      flush();
      const r = run(i, NUMBER);
      const start = Number(m[1]) !== 1 ? ` start="${Number(m[1])}"` : "";
      out.push(`<ol${start}>${r.items.map((t) => `<li>${inlineMarkdown(t)}</li>`).join("")}</ol>`);
      i = r.next - 1;
      continue;
    }
    if (QUOTE.test(raw)) {
      flush();
      const r = run(i, QUOTE);
      out.push(`<blockquote><p>${r.items.map(inlineMarkdown).join("<br>")}</p></blockquote>`);
      i = r.next - 1;
      continue;
    }
    para.push(raw);
  }
  flush();
  return out.join("\n");
}
