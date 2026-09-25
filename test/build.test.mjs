import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildSite, imageSize } from "../src/build.mjs";
import {
  fixture,
  fresh,
  quiet,
  recorder,
  makeEvidence,
  makePng,
  makeJpegHeader,
  html,
  cleanOut,
  readFixtureSession,
} from "./helpers.mjs";

after(cleanOut);

const full = () => {
  const out = fresh("full");
  const r = buildSite({
    dir: fixture,
    subject: "QA swarm · iOS · checklist",
    verdict: "PASS: the progress card went from 2 of 9 to 3 of 9 and back",
    out,
    projectName: "Employee Onboarding",
    expoOwner: "sunrise-solutions",
    expoSlug: "employee-onboarding",
    agentName: "expo-bot",
    buildId: "0123456789abcdef0123456789abcdef",
    log: quiet,
  });
  return { out, r, h: html(out) };
};

test("builds the full page from the real fixture", () => {
  const { out, r, h } = full();
  assert.equal(r.images, 3);
  assert.equal(r.videos, 0);
  assert.equal(r.kind, "pass");
  assert.equal(r.session, "01a0d92e-195f-7045-a13c-23181fd8fc70");
  assert.equal(r.siteDir, out);
  assert.equal(r.report, 0);

  assert.match(h, /<title>Employee Onboarding · QA swarm · iOS · checklist verification<\/title>/);
  assert.match(h, /class="pill pill-pass"/);
  assert.match(h, /expo-bot verification/);
  assert.match(h, /Checklist<\/span>/);
  assert.match(h, /Task toggled on/);
  assert.match(h, /Task toggled off/);
  assert.match(h, /What the agent did/);
  assert.match(h, /13 steps/);
  assert.match(h, /App performance/);
  assert.match(h, /101 samples/);
  assert.match(h, /iPhone 17 · iOS 26\.5/);
  assert.match(h, /Try this build on a simulator/);
  assert.match(h, /simulator-sessions\/create\?buildId=0123456789abcdef0123456789abcdef/);
  assert.match(h, /recording\.mp4 ↗/);
  assert.match(h, /Session on expo\.dev/);
  assert.match(h, /<time datetime="2026-09-25T15:31:/);

  for (const f of [
    "1-checklist.png",
    "colors_and_type.css",
    "fonts/Inter-Variable.woff2",
    "fonts/JetBrainsMono-Variable.woff2",
    "session/session.json",
    "session/events.ndjson",
    "session/metrics.ndjson",
  ]) {
    assert.ok(existsSync(join(out, f)), `${f} copied to the site`);
  }
  assert.ok(!existsSync(join(out, "verdict.txt")), "non-media files are not copied");
  assert.ok(!existsSync(join(out, "raw")), "the raw fixture folder is not copied");
});

test("the screenshot tiles carry the image's own aspect ratio", () => {
  const { h } = full();
  assert.equal((h.match(/style="aspect-ratio: 1206 \/ 2622"/g) || []).length, 3);
  assert.doesNotMatch(h, /class="shot wide"/);
});

test("the timeline pairs screenshot commands with the images in order", () => {
  const { h } = full();
  assert.match(h, /Screenshot 1 · Checklist/);
  assert.match(h, /Screenshot 2 · Task toggled on/);
  assert.match(h, /Screenshot 3 · Task toggled off/);
  assert.match(h, /data-index="2"><img src="\.\/3-task-toggled-off\.png"/);
});

test("housekeeping runs fold into one row with a repeat count", () => {
  const { h } = full();
  assert.match(h, /Read screen<\/span><span class="tl-rep">×3<\/span>/);
});

test("the performance charts draw both series and mark the taps", () => {
  const { h } = full();
  assert.match(h, /Peak CPU<\/span><span class="stat-v">173\.4%/);
  assert.match(h, /Peak memory<\/span><span class="stat-v">165 MB/);
  const paths = h.match(/<path d="M\d+\.\d,\d+\.\d/g) || [];
  assert.equal(paths.length, 7, "line + area for cpu and memory, area + two lines for network");
  assert.ok((h.match(/stroke-dasharray="3 3"/g) || []).length >= 1, "at least one tap hairline");
  assert.match(h, /<span class="first" style="left:0\.00%">0:00<\/span>/);
  assert.match(h, /<span class="last" style="left:100\.00%">1:48<\/span>/);
});

test("a FAIL verdict flags the named screenshot and its timeline row", () => {
  const out = fresh("fail");
  const r = buildSite({ dir: fixture, subject: "PR #1", verdict: "FAIL: Screenshot 2 shows the count did not change", out, log: quiet });
  assert.equal(r.kind, "fail");
  const h = html(out);
  assert.match(h, /class="pill pill-fail"/);
  assert.equal((h.match(/shot-tag">FAILED</g) || []).length, 1);
  assert.match(h, /aria-label="Screenshot 2: Task toggled on">\s*<span class="shot-frame"[^>]*><img[^>]+>(<span class="tap-mark"[^>]*><\/span>)?<span class="shot-tag">FAILED<\/span>/);
  assert.equal((h.match(/tl-row flagged/g) || []).length, 1);
  assert.match(h, /Named in the verdict/);
});

test("a REPLICATED verdict gets the amber pill and a REPLICATED tag", () => {
  const out = fresh("rep");
  const r = buildSite({ dir: fixture, subject: "Issue #7", verdict: "REPLICATED: screenshot 1 shows the crash", out, log: quiet });
  assert.equal(r.kind, "replicated");
  const h = html(out);
  assert.match(h, /class="pill pill-warn"/);
  assert.match(h, /shot-tag">REPLICATED</);
  assert.match(h, /<h1 class="h1">screenshot 1 shows the crash<\/h1>/);
});

test("INCONCLUSIVE gets the neutral pill and flags nothing", () => {
  const out = fresh("inc");
  const r = buildSite({ dir: fixture, subject: "x", verdict: "INCONCLUSIVE: Screenshot 2 was blank", out, log: quiet });
  assert.equal(r.kind, "neutral");
  const h = html(out);
  assert.match(h, /class="pill pill-neutral"/);
  assert.doesNotMatch(h, /shot-tag">/);
  assert.doesNotMatch(h, /tl-row flagged/);
});

test("a flagged screenshot number past the last image flags nothing", () => {
  const out = fresh("past");
  buildSite({ dir: fixture, subject: "x", verdict: "FAIL: Screenshot 9 is missing", out, log: quiet });
  const h = html(out);
  assert.match(h, /class="pill pill-fail"/);
  assert.doesNotMatch(h, /shot-tag">/);
  assert.doesNotMatch(h, /tl-row flagged/);
});

test("a stacked verdict gets the last keyword's pill and the normalized line comes back", () => {
  const out = fresh("stacked");
  const r = buildSite({ dir: fixture, subject: "x", verdict: "PASS: FAIL: nope", out, log: quiet });
  assert.equal(r.kind, "fail");
  assert.equal(r.verdict, "FAIL: nope");
  assert.match(html(out), /<h1 class="h1">nope<\/h1>/);
});

test("without session data the page is verdict plus screenshots", () => {
  const dir = makeEvidence({ images: ["1-checklist.png", "2-task-toggled-on.png"] });
  const out = fresh("shots-only");
  const r = buildSite({ dir, subject: "Issue #7", verdict: "NOT-REPLICATED: the crash did not happen", out, log: quiet });
  assert.equal(r.session, null);
  assert.equal(r.kind, "pass");
  const h = html(out);
  assert.match(h, /NOT REPLICATED/);
  assert.match(h, /Every screenshot below is from that run\./);
  assert.doesNotMatch(h, /What the agent did/);
  assert.doesNotMatch(h, /App performance/);
  assert.doesNotMatch(h, /<section id="data">/);
  assert.doesNotMatch(h, /Try this build/);
  assert.doesNotMatch(h, /class="foot-id"/);
  assert.ok(!existsSync(join(out, "session")));
});

test("an empty evidence dir still builds a page that says so", () => {
  const dir = makeEvidence({});
  const out = fresh("empty");
  const r = buildSite({ dir, subject: "Empty", verdict: "INCONCLUSIVE: nothing captured", out, log: quiet });
  assert.equal(r.images, 0);
  const h = html(out);
  assert.match(h, /No media captured\./);
  assert.doesNotMatch(h, /<section id="screenshots">/);
  assert.doesNotMatch(h, /<nav class="nav-links">\s*<a/);
});

test("the default output folder is <dir>/site", () => {
  const dir = makeEvidence({ images: ["1-a.png"] });
  const r = buildSite({ dir, subject: "x", verdict: "PASS: x", log: quiet });
  assert.equal(r.siteDir, join(dir, "site"));
  assert.ok(existsSync(join(dir, "site", "index.html")));
});

test("a nested --out folder is created", () => {
  const dir = makeEvidence({ images: ["1-a.png"] });
  const out = join(fresh("nested"), "a", "b", "c");
  buildSite({ dir, subject: "x", verdict: "PASS: x", out, log: quiet });
  assert.ok(existsSync(join(out, "index.html")));
});

test("building twice into the same folder is idempotent", () => {
  const out = fresh("twice");
  buildSite({ dir: fixture, subject: "x", verdict: "PASS: x", out, log: quiet });
  const first = html(out).replace(/Generated [^<]+/, "");
  buildSite({ dir: fixture, subject: "x", verdict: "PASS: x", out, log: quiet });
  const second = html(out).replace(/Generated [^<]+/, "");
  assert.equal(first, second);
});

test("a missing evidence dir throws", () => {
  assert.throws(() => buildSite({ dir: join(fresh("nope"), "missing"), subject: "x", verdict: "PASS: x", log: quiet }), /evidence dir not found/);
  assert.throws(() => buildSite({ subject: "x", verdict: "PASS: x", log: quiet }), /evidence dir not found/);
});

test("the Try this build button needs an owner, a slug, and a real-looking build id", () => {
  const cases = [
    [{ expoOwner: "a", expoSlug: "b" }, false],
    [{ expoOwner: "a", buildId: "0123456789abcdef0123456789abcdef" }, false],
    [{ expoSlug: "b", buildId: "0123456789abcdef0123456789abcdef" }, false],
    [{ expoOwner: "a", expoSlug: "b", buildId: "short" }, false],
    [{ expoOwner: "a", expoSlug: "b", buildId: "0123456789abcdef0123456789abcdef" }, true],
    [{ expoOwner: "a", expoSlug: "b", buildId: "01a0d92e-195f-7045-a13c-23181fd8fc70" }, true],
  ];
  for (const [opts, expected] of cases) {
    const out = fresh("btn");
    buildSite({ dir: fixture, subject: "x", verdict: "PASS: x", out, log: quiet, ...opts });
    assert.equal(/Try this build/.test(html(out)), expected, JSON.stringify(opts));
  }
});

test("build-time buildId and lane override the ones stored at collect time", () => {
  const s = readFixtureSession();
  s.extra = { build_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", lane: "stored lane" };
  const dir = makeEvidence({ images: ["1-a.png"], session: s });
  const out = fresh("override");
  buildSite({ dir, subject: "x", verdict: "PASS: x", out, log: quiet, expoOwner: "o", expoSlug: "s", buildId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", lane: "build lane" });
  const h = html(out);
  assert.match(h, /buildId=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/);
  assert.match(h, /fact-v mono">bbbbbbbb</);
  assert.match(h, /fact-v">build lane</);
  assert.doesNotMatch(h, /stored lane/);
});

test("the create-session link names the session after the subject with the preview marker", () => {
  const { h } = full();
  const m = h.match(/simulator-sessions\/create\?buildId=[^&]+&amp;name=([^"]+)"/);
  assert.ok(m);
  assert.equal(decodeURIComponent(m[1].replace(/\+/g, " ")), "QA swarm · iOS · checklist · evidence-site preview");
});

test("agent name and project name are escaped and shown in header and footer", () => {
  const out = fresh("names");
  buildSite({ dir: fixture, subject: "<s>", verdict: "PASS: x", out, log: quiet, projectName: "A & B", agentName: "bot<1>" });
  const h = html(out);
  assert.match(h, /<title>A &amp; B · &lt;s&gt; verification<\/title>/);
  assert.match(h, /bot&lt;1&gt; verification/);
  assert.match(h, /<span>bot&lt;1&gt;<\/span>/);
  assert.doesNotMatch(h, /<s>/);
});

test("Android sessions say emulator", () => {
  const s = readFixtureSession();
  s.platform = "ANDROID";
  const dir = makeEvidence({ images: ["1-a.png"], session: s });
  const out = fresh("android");
  buildSite({ dir, subject: "x", verdict: "PASS: x", out, log: quiet });
  assert.match(html(out), /EAS cloud emulator/);
});

test("the agent report renders as text, short ones open, long ones folded", () => {
  const dir = makeEvidence({ images: ["1-a.png"] });
  const out = fresh("report");
  const short = "Line one.\nLine two with <b>html</b> & stuff.";
  const r = buildSite({ dir, subject: "x", verdict: "PASS: x", report: short, out, log: quiet });
  assert.equal(r.report, short.length);
  let h = html(out);
  assert.match(h, /<section id="report">/);
  assert.match(h, /Agent report<\/h2><span class="count">2 lines<\/span>/);
  assert.match(h, /<pre class="report">Line one\.\nLine two with &lt;b&gt;html&lt;\/b&gt; &amp; stuff\.<\/pre>/);
  assert.match(h, /class="card report-card" id="report-card"/);
  assert.match(h, /<a href="#report">Report<\/a>/);

  const long = Array.from({ length: 40 }, (_, i) => `Step ${i + 1}: something happened.`).join("\n");
  buildSite({ dir, subject: "x", verdict: "PASS: x", report: long, out, log: quiet });
  h = html(out);
  assert.match(h, /class="card report-card report-collapsed"/);
  assert.match(h, /id="report-more"/);
  assert.match(h, /40 lines/);

  buildSite({ dir, subject: "x", verdict: "PASS: x", report: "   \n  ", out, log: quiet });
  assert.doesNotMatch(html(out), /<section id="report">/);
});

test("agent clips are embedded and downloadable; the platform recording is only linked", () => {
  const dir = makeEvidence({ images: ["1-a.png"], videos: ["2-flow.mp4", "3-Login Flow.mov"] });
  const out = fresh("video");
  const r = buildSite({ dir, subject: "x", verdict: "PASS: x", out, log: quiet });
  assert.equal(r.videos, 2);
  const h = html(out);
  assert.match(h, /<section id="recording">/);
  assert.match(h, /Agent recording<\/h2><span class="count">2</);
  assert.match(h, /<video[^>]+src="\.\/2-flow\.mp4"/);
  assert.match(h, /<video[^>]+src="\.\/3-Login%20Flow\.mov"/);
  assert.match(h, /Download 3-Login Flow\.mov/);
  assert.ok(existsSync(join(out, "3-Login Flow.mov")));
  assert.doesNotMatch(h, /<video[^>]+src="https?:/);
});

test("natural sort keeps 2 before 10", () => {
  const names = ["10-ten.png", "2-two.png", "1-one.png", "9-nine.png", "11-eleven.png"];
  const dir = makeEvidence({ images: names });
  const out = fresh("sort");
  buildSite({ dir, subject: "x", verdict: "PASS: x", out, log: quiet });
  const order = [...html(out).matchAll(/class="shot-label">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(order, ["One", "Two", "Nine", "Ten", "Eleven"]);
});

test("captions come from file names in several spellings", () => {
  const names = ["01_home_screen.png", "2 - Settings Page.PNG", "3.jpeg", "004-a-b--c.jpg", "no-number.png", "5-.png"];
  const dir = makeEvidence({ images: names });
  const out = fresh("captions");
  buildSite({ dir, subject: "x", verdict: "PASS: x", out, log: quiet });
  const labels = [...html(out).matchAll(/class="shot-label">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(labels, ["Home screen", "Settings Page", "3.jpeg", "A b c", "5-.png", "No number"]);
});

test("file names with spaces, unicode, and reserved characters resolve", () => {
  const names = ["1-Écran d'accueil.png", "2-100% done #1.png", "3-what?.png"];
  const dir = makeEvidence({ images: names });
  const out = fresh("urls");
  buildSite({ dir, subject: "x", verdict: "PASS: x", out, log: quiet });
  const h = html(out);
  const srcs = [...h.matchAll(/<img src="([^"]+)" alt=/g)].map((m) => m[1]);
  assert.deepEqual(srcs, [
    "./1-%C3%89cran%20d'accueil.png",
    "./2-100%25%20done%20%231.png",
    "./3-what%3F.png",
  ]);
  for (const s of srcs) assert.ok(existsSync(join(out, decodeURIComponent(s.slice(2)))), s);
});

test("landscape captures span two columns", () => {
  const dir = makeEvidence({ images: [{ name: "1-tablet.png", w: 400, h: 300 }, "2-phone.png"] });
  const out = fresh("landscape");
  buildSite({ dir, subject: "x", verdict: "PASS: x", out, log: quiet });
  const h = html(out);
  assert.match(h, /class="shot wide" id="shot-1" data-index="0"/);
  assert.match(h, /class="shot" id="shot-2" data-index="1"/);
  assert.match(h, /style="aspect-ratio: 400 \/ 300"/);
  assert.match(h, /style="aspect-ratio: 90 \/ 195"/);
});

test("jpeg sizes are read too, and an unreadable image gets the default ratio", () => {
  const dir = makeEvidence({ images: [{ name: "1-a.jpg", w: 640, h: 1136 }] });
  writeFileSync(join(dir, "2-broken.png"), Buffer.from("not a png"));
  writeFileSync(join(dir, "3-empty.jpeg"), Buffer.alloc(0));
  const out = fresh("jpeg");
  buildSite({ dir, subject: "x", verdict: "PASS: x", out, log: quiet });
  const h = html(out);
  assert.match(h, /style="aspect-ratio: 640 \/ 1136"/);
  assert.equal((h.match(/style="aspect-ratio:/g) || []).length, 1);
  assert.equal((h.match(/class="shot-frame">/g) || []).length, 2, "the two unreadable tiles fall back to the stylesheet ratio");
});

test("imageSize reads PNG and JPEG headers and rejects everything else", () => {
  const d = fresh("sizes");
  writeFileSync(join(d, "a.png"), makePng(7, 9));
  writeFileSync(join(d, "b.jpg"), makeJpegHeader(1234, 56));
  writeFileSync(join(d, "c.bin"), Buffer.from([1, 2, 3]));
  writeFileSync(join(d, "d.png"), makePng(1, 1).subarray(0, 20));
  const zero = makePng(1, 1);
  zero.writeUInt32BE(0, 16);
  writeFileSync(join(d, "e.png"), zero);
  assert.deepEqual(imageSize(join(d, "a.png")), { w: 7, h: 9 });
  assert.deepEqual(imageSize(join(d, "b.jpg")), { w: 1234, h: 56 });
  assert.equal(imageSize(join(d, "c.bin")), null);
  assert.equal(imageSize(join(d, "d.png")), null, "a truncated header");
  assert.equal(imageSize(join(d, "e.png")), null, "a zero width");
  assert.equal(imageSize(join(d, "missing.png")), null);
});

test("many screenshots and a long timeline fold after 40 rows", () => {
  const s = readFixtureSession();
  const base = s.timeline[0];
  s.timeline = Array.from({ length: 120 }, (_, i) => ({ ...base, ts: new Date(Date.parse(base.ts) + i * 1000).toISOString(), label: `Step ${i + 1} tap at (${i}%, ${i}%)`, kind: "tap", tool: "gesture-tap" }));
  s.counts = { operations: 120, taps: 120, screenshots: 0, failed: 0, describes: 0 };
  const dir = makeEvidence({ images: Array.from({ length: 30 }, (_, i) => `${i + 1}-shot.png`), session: s });
  const out = fresh("long");
  const r = buildSite({ dir, subject: "x", verdict: "PASS: x", out, log: quiet });
  assert.equal(r.images, 30);
  const h = html(out);
  assert.match(h, /class="tl tl-folded"/);
  assert.match(h, /Show all 120 steps/);
  assert.equal((h.match(/class="tl-row/g) || []).length, 120, "every row is in the markup; CSS hides the fold");
  assert.equal((h.match(/class="shot"/g) || []).length, 30);
  assert.match(h, /Taps <strong>120<\/strong>/);
});

test("a timeline of exactly 40 rows does not fold", () => {
  const s = readFixtureSession();
  const base = s.timeline[0];
  s.timeline = Array.from({ length: 40 }, (_, i) => ({ ...base, label: `Step ${i}` }));
  const dir = makeEvidence({ images: ["1-a.png"], session: s });
  const out = fresh("forty");
  buildSite({ dir, subject: "x", verdict: "PASS: x", out, log: quiet });
  assert.doesNotMatch(html(out), /class="tl tl-folded"|id="tl-more"/);
});

test("long verdicts step the headline down in size", () => {
  const dir = makeEvidence({ images: ["1-a.png"] });
  const out = fresh("h1");
  const w = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
  buildSite({ dir, subject: "x", verdict: `PASS: ${w(10)}`, out, log: quiet });
  assert.match(html(out), /<h1 class="h1">/);
  buildSite({ dir, subject: "x", verdict: `PASS: ${w(40)}`, out, log: quiet });
  assert.match(html(out), /<h1 class="h1 h1-long">/);
  buildSite({ dir, subject: "x", verdict: `PASS: ${w(90)}`, out, log: quiet });
  assert.match(html(out), /<h1 class="h1 h1-xlong">/);
});

test("warnings go to the given logger, not the console", () => {
  const dir = makeEvidence({ images: ["1-a.png"], session: "{ not json" });
  const rec = recorder();
  const out = fresh("warn");
  const r = buildSite({ dir, subject: "x", verdict: "PASS: x", out, log: rec });
  assert.equal(r.session, null);
  assert.equal(rec.warns.length, 1);
  assert.match(rec.warns[0], /session\.json unreadable/);
  assert.equal(rec.logs.length, 1);
  assert.match(rec.logs[0], /Evidence site written to .*no session data/);
});

test("no icon referenced by any page is missing from assets", () => {
  const rec = recorder();
  const s = readFixtureSession();
  s.timeline.push(
    { ...s.timeline[0], kind: "type", tool: "fill" },
    { ...s.timeline[0], kind: "swipe", tool: "gesture-swipe" },
    { ...s.timeline[0], kind: "wait", tool: "wait" },
    { ...s.timeline[0], kind: "alert", tool: "alert" },
    { ...s.timeline[0], kind: "recording", tool: "record" },
    { ...s.timeline[0], kind: "mystery", tool: "apps" },
    { ...s.timeline[0], kind: "other", tool: "boot-device" },
    { ...s.timeline[0], kind: "other", tool: null, outcome: "failure" },
  );
  const dir = makeEvidence({ images: ["1-a.png"], videos: ["2-b.mp4"], session: s });
  for (const verdict of ["PASS: x", "FAIL: screenshot 1", "REPLICATED: x", "INCONCLUSIVE: x"]) {
    buildSite({ dir, subject: "x", verdict, out: fresh("icons"), log: rec, report: "r", expoOwner: "o", expoSlug: "s", buildId: "0123456789abcdef0123456789abcdef" });
  }
  assert.deepEqual(rec.warns, []);
});
