// The built page is self-contained: every local URL resolves, every CSS
// token is defined, no CDN, both themes covered, valid-looking markup.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildSite } from "../src/build.mjs";
import { fixture, fresh, quiet, html, cleanOut, root, makeEvidence, readFixtureSession } from "./helpers.mjs";

after(cleanOut);

const built = () => {
  const out = fresh("integrity");
  buildSite({
    dir: fixture, subject: "x", verdict: "FAIL: screenshot 2", out, log: quiet, report: "r".repeat(2000),
    expoOwner: "o", expoSlug: "s", buildId: "0123456789abcdef0123456789abcdef",
  });
  return { out, h: html(out) };
};

test("every local src/href in the page exists in the site folder", () => {
  const { out, h } = built();
  const refs = [...h.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 8, `found ${refs.length} local refs`);
  for (const ref of refs) {
    const file = decodeURIComponent(ref.slice(2)).split("#")[0];
    assert.ok(existsSync(join(out, file)), `${ref} -> ${file}`);
  }
});

test("the stylesheet's font files exist and are referenced by the css", () => {
  const css = readFileSync(join(root, "assets", "colors_and_type.css"), "utf8");
  const fonts = [...css.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => m[1]);
  assert.ok(fonts.length >= 2);
  for (const f of fonts) assert.ok(existsSync(join(root, "assets", f)), f);
});

test("every css token the page uses is defined in the stylesheet", () => {
  const { h } = built();
  const css = readFileSync(join(root, "assets", "colors_and_type.css"), "utf8");
  const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const used = new Set([...h.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]));
  assert.ok(used.size >= 20);
  const missing = [...used].filter((t) => !defined.has(t));
  assert.deepEqual(missing, []);
});

test("the stylesheet defines its color tokens for both themes", () => {
  const css = readFileSync(join(root, "assets", "colors_and_type.css"), "utf8");
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const light = new Set();
  const dark = new Set();
  for (const [, sel, body] of blocks) {
    const tokens = [...body.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]);
    const s = sel.trim();
    if (/data-theme="dark"/.test(s)) tokens.forEach((t) => dark.add(t));
    else if (/^:root|^html/.test(s)) tokens.forEach((t) => light.add(t));
  }
  assert.ok(dark.size >= 20, `dark tokens: ${dark.size}`);
  const colorish = [...dark].filter((t) => /bg|fg|border|status|icon|code|shadow/.test(t));
  for (const t of colorish) assert.ok(light.has(t), `${t} defined for dark but not light`);
});

test("nothing loads from the network at view time", () => {
  const { h } = built();
  const external = [...h.matchAll(/(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]);
  for (const u of external) {
    assert.ok(/expo\.dev/.test(u), `unexpected external url ${u}`);
  }
  assert.doesNotMatch(h, /<link[^>]+href="https?:/);
  assert.doesNotMatch(h, /<script[^>]+src=/);
  assert.doesNotMatch(h, /@import/);
});

test("external links open safely", () => {
  const { h } = built();
  for (const m of h.matchAll(/<a [^>]*href="https?:[^"]*"[^>]*>/g)) {
    assert.match(m[0], /target="_blank"/, m[0]);
    assert.match(m[0], /rel="noopener"/, m[0]);
  }
});

test("the markup is balanced for the tags that matter", () => {
  const { h } = built();
  for (const tag of ["section", "div", "main", "header", "footer", "ol", "li", "button", "span", "a", "pre", "h1", "h2", "p", "svg", "nav"]) {
    const open = (h.match(new RegExp(`<${tag}(\\s|>)`, "g")) || []).length;
    const close = (h.match(new RegExp(`</${tag}>`, "g")) || []).length;
    assert.equal(open, close, `<${tag}> opened ${open}, closed ${close}`);
  }
  assert.match(h, /^<!doctype html>\n<html lang="en">/);
  assert.match(h, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.equal((h.match(/<title>/g) || []).length, 1);
});

test("every id on the page is unique", () => {
  const { h } = built();
  const ids = [...h.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(ids)].sort(), ids.slice().sort());
});

test("every nav link targets a section on the page", () => {
  const { h } = built();
  const links = h.match(/<nav class="nav-links">([\s\S]*?)<\/nav>/)[1];
  const targets = [...links.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(targets, ["report", "screenshots", "timeline", "performance", "data"]);
  for (const t of targets) assert.match(h, new RegExp(`<section id="${t}"`));
});

test("the page has the responsive rules a phone needs", () => {
  const { h } = built();
  assert.match(h, /@media \(max-width: 640px\)/);
  assert.match(h, /@media \(max-width: 380px\)/);
  assert.match(h, /@media \(hover: none\)/);
  assert.match(h, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(h, /overflow-wrap: anywhere/);
  assert.match(h, /body \{[^}]*overflow-x: hidden/);
  assert.match(h, /img, video, svg \{ max-width: 100%; \}/);
});

test("images are lazy and every img has alt text", () => {
  const { h } = built();
  const imgs = h.match(/<img [^>]+>/g) || [];
  assert.ok(imgs.length >= 6);
  for (const i of imgs) {
    assert.match(i, / alt="/, i);
    assert.match(i, /loading="lazy"|id="lb-img"/, i);
  }
});

test("interactive controls are buttons with labels", () => {
  const { h } = built();
  assert.match(h, /<button type="button" class="shot" id="shot-1" data-index="0" aria-label="Screenshot 1: Checklist">/);
  assert.match(h, /aria-label="Switch theme"/);
  assert.match(h, /aria-label="Close"/);
  assert.match(h, /role="dialog" aria-modal="true"/);
});

test("the theme is applied before first paint and remembered", () => {
  const { h } = built();
  const head = h.split("</head>")[0];
  assert.match(head, /<script>[\s\S]*localStorage\.getItem\('evidence-theme'\)[\s\S]*<\/script>[\s\S]*<link rel="stylesheet"/, "the theme script runs before the stylesheet");
  assert.match(h, /localStorage\.setItem\('evidence-theme'/);
});

test("all committed assets are referenced by the builder or the stylesheet", () => {
  const src = readFileSync(join(root, "src", "build.mjs"), "utf8");
  const icons = readdirSync(join(root, "assets", "icons")).map((f) => f.replace(/\.svg$/, ""));
  assert.ok(icons.length >= 20);
  for (const name of icons) assert.match(src, new RegExp(`"${name}"`), `icon ${name} is unused`);
});

test("the demo fixture's session.json matches the documented schema", () => {
  const s = readFixtureSession();
  assert.equal(s.schemaVersion, 1);
  for (const k of ["id", "name", "platform", "type", "status", "createdAt", "startedAt", "finishedAt", "bootMs", "durationMs", "dashboardUrl", "device", "recording", "anchorIso", "metrics", "timeline", "counts", "uploadedScreenshots", "raw", "extra"]) {
    assert.ok(k in s, k);
  }
  for (const t of s.timeline) {
    for (const k of ["ts", "offsetMs", "kind", "tool", "label", "outcome", "durationMs"]) assert.ok(k in t, `timeline.${k}`);
  }
  for (const m of s.metrics.samples) {
    for (const k of ["t", "cpu", "memMB", "netIn", "netOut", "app"]) assert.ok(k in m, `sample.${k}`);
  }
});

test("a page built without a session has no dangling nav links or ids", () => {
  const dir = makeEvidence({ images: ["1-a.png"] });
  const out = fresh("nosess");
  buildSite({ dir, subject: "x", verdict: "PASS: x", out, log: quiet });
  const h = html(out);
  const targets = h.match(/<nav class="nav-links">([\s\S]*?)<\/nav>/)[1].match(/href="#([^"]+)"/g);
  assert.deepEqual(targets, ['href="#screenshots"']);
});
