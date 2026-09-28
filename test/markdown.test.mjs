import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown, inlineMarkdown } from "../src/markdown.mjs";

test("paragraphs keep their line breaks and escape html", () => {
  assert.equal(
    renderMarkdown("Line one.\nLine two with <b>html</b> & stuff.\n\nNext."),
    "<p>Line one.<br>Line two with &lt;b&gt;html&lt;/b&gt; &amp; stuff.</p>\n<p>Next.</p>",
  );
});

test("headings, lists, rules, and quotes", () => {
  const h = renderMarkdown("## Step 1: Home\n\n- one\n- two <x>\n\n1. first\n2. second\n\n3) third\n\n---\n\n> quoted\n> more\n\n#### Deep");
  assert.match(h, /^<h3>Step 1: Home<\/h3>/);
  assert.match(h, /<ul><li>one<\/li><li>two &lt;x&gt;<\/li><\/ul>/);
  assert.match(h, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.match(h, /<ol start="3"><li>third<\/li><\/ol>/);
  assert.match(h, /<hr>/);
  assert.match(h, /<blockquote><p>quoted<br>more<\/p><\/blockquote>/);
  assert.match(h, /<h4>Deep<\/h4>$/);
});

test("fenced code is verbatim and escaped; inline code, bold, links", () => {
  const h = renderMarkdown("```\n<script>alert(1)</script>\n**not bold**\n```\nUse `describe` and **bold `code`** then [Expo](https://expo.dev).");
  assert.match(h, /<pre><code>&lt;script&gt;alert\(1\)&lt;\/script&gt;\n\*\*not bold\*\*<\/code><\/pre>/);
  assert.match(h, /Use <code>describe<\/code> and <strong>bold <code>code<\/code><\/strong> then <a href="https:\/\/expo.dev" target="_blank" rel="noopener">Expo<\/a>\./);
});

test("bare http(s) URLs are linked; other schemes and markup stay text", () => {
  assert.equal(
    inlineMarkdown("see https://expo.dev/x?a=1&b=2, then javascript:alert(1)"),
    'see <a href="https://expo.dev/x?a=1&amp;b=2" target="_blank" rel="noopener">https://expo.dev/x?a=1&amp;b=2</a>, then javascript:alert(1)',
  );
  assert.equal(inlineMarkdown('[x](javascript:alert(1)) <img src=x onerror="y">'), '[x](javascript:alert(1)) &lt;img src=x onerror=&quot;y&quot;&gt;');
});

test("plain lines without markup render unchanged, one paragraph per block", () => {
  const long = Array.from({ length: 5 }, (_, i) => `Step ${i + 1}: something happened.`).join("\n");
  assert.equal(renderMarkdown(long), `<p>${long.split("\n").join("<br>")}</p>`);
  assert.equal(renderMarkdown(""), "");
});
