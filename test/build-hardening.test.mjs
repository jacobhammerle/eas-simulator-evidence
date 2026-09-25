// Any shape of session.json must render without leaking "undefined",
// "NaN", or "[object Object]" into the page, and without throwing.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { buildSite } from "../src/build.mjs";
import { fresh, quiet, makeEvidence, html, htmlNoScript, cleanOut, readFixtureSession } from "./helpers.mjs";

after(cleanOut);
const notWindows = { skip: process.platform === "win32" ? "file name not allowed on Windows" : false };

const LEAK = /\b(NaN|undefined|\[object Object\])\b|(?<![\w-])null(?![\w-])/;

function renders(session, extra = {}) {
  const dir = makeEvidence({ images: ["1-a.png", "2-b.png"], session });
  const out = fresh("hard");
  const r = buildSite({ dir, subject: "x", verdict: "FAIL: Screenshot 2 bad", out, log: quiet, ...extra });
  const body = htmlNoScript(out);
  assert.doesNotMatch(body, LEAK, "leaked value in page");
  assert.match(body, /<\/html>\s*$/);
  return { r, h: html(out), body };
}

test("the real fixture leaks nothing", () => {
  const { body } = renders(readFixtureSession());
  assert.doesNotMatch(body, LEAK);
});

test("an empty object session renders the screenshots and a bare facts strip", () => {
  const { r, h } = renders({});
  assert.equal(r.session, "unknown");
  assert.match(h, /fact-v">—</);
  assert.match(h, /session unknown/);
  assert.doesNotMatch(h, /What the agent did/);
  assert.doesNotMatch(h, /App performance/);
});

test("a session that is not an object falls back to screenshots only", () => {
  for (const bad of ["[]", "null", "42", '"str"', "true"]) {
    const dir = makeEvidence({ images: ["1-a.png"], session: bad });
    const out = fresh("notobj");
    const r = buildSite({ dir, subject: "x", verdict: "PASS: x", out, log: quiet });
    assert.equal(r.session, null, bad);
    assert.doesNotMatch(htmlNoScript(out), LEAK);
  }
});

test("wrong types in every top-level field", () => {
  renders({
    id: 12345,
    platform: 7,
    type: { a: 1 },
    status: null,
    startedAt: "not a date",
    createdAt: 0,
    finishedAt: [],
    bootMs: "fast",
    durationMs: NaN,
    dashboardUrl: 5,
    device: "iPhone",
    recording: "yes",
    metrics: [],
    timeline: "none",
    counts: 3,
    extra: "lane",
    anchorIso: {},
  });
});

test("timeline entries with missing or odd fields", () => {
  const { h } = renders({
    ...readFixtureSession(),
    timeline: [
      {},
      { kind: "tap" },
      { kind: "screenshot", screenshotIndex: 99 },
      { kind: "screenshot", screenshotIndex: -1 },
      { kind: "screenshot", screenshotIndex: "0" },
      { kind: "screenshot", screenshotIndex: 1, outcome: "success" },
      { kind: "weird-kind", tool: "weird-tool", label: "<b>x</b>", outcome: "timeout", durationMs: "slow", repeat: "3" },
      { kind: "tap", repeat: "abc", label: "nonsense repeat" },
      { kind: "tap", ts: "garbage", durationMs: -5 },
      { kind: "tap", ts: "2026-09-25T15:33:10.680Z", repeat: 2 },
      null,
      "string",
      42,
    ],
  });
  assert.match(h, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(h, /Command timeout/);
  assert.match(h, /Screenshot 2 · B/);
  assert.equal((h.match(/class="tl-view"/g) || []).length, 1, "only the in-range screenshot index links to a tile");
  assert.match(h, /tl-rep">×2</);
  assert.match(h, /tl-rep">×3</, "a numeric string repeat count is read");
});

test("metrics with nulls, strings, one sample, and no summary", () => {
  const s = readFixtureSession();
  renders({ ...s, metrics: { ...s.metrics, summary: null } });
  renders({ ...s, metrics: { ...s.metrics, samples: [] } });
  renders({ ...s, metrics: { ...s.metrics, samples: [{ t: 0, cpu: null, memMB: null }] } });
  renders({ ...s, metrics: { ...s.metrics, samples: [{ t: "1", cpu: "2" }, { t: NaN }, null, {}] } });
  const { h } = renders({ ...s, metrics: { ...s.metrics, samples: [{ t: 5000, cpu: 10, memMB: 100 }], summary: { cpuMax: "x", cpuAvg: null, memMaxMB: undefined, memAvgMB: Infinity }, sampleIntervalMs: "1s", t0Iso: "nope" } });
  assert.match(h, /App performance/);
  assert.match(h, /stat-v">—</);
  assert.match(h, /sampled every 1 s/);
});

test("all-null cpu samples skip the cpu line but keep the page", () => {
  const s = readFixtureSession();
  const { h } = renders({ ...s, metrics: { ...s.metrics, samples: s.metrics.samples.map((x) => ({ ...x, cpu: null })) } });
  assert.match(h, /App performance/);
  assert.equal((h.match(/<path d="M\d+\.\d,\d+\.\d/g) || []).length, 5, "memory line and area, network area and two lines; no cpu");
  assert.doesNotMatch(h, /tl-rep">×NaN</);
});

test("device, recording, and counts partially filled", () => {
  const s = readFixtureSession();
  const { h } = renders({ ...s, device: { name: null, runtime: "iOS 18" }, recording: { url: "ftp://nope" }, counts: { operations: null, failed: "2" } });
  assert.match(h, /fact-v">iOS 18</);
  assert.doesNotMatch(h, /recording\.mp4/, "a non-http recording url is not linked");
  assert.match(h, /Failed commands/);
});

test("extra facts of the wrong type", () => {
  const s = readFixtureSession();
  const { h } = renders({ ...s, extra: { build_id: 12345678901234567890, lane: ["a", "b"], metrics: { x: 1 } } });
  assert.match(h, /fact-v mono">12345678</);
});

test("timestamps that do not parse fall back cleanly", () => {
  const s = readFixtureSession();
  const { h } = renders({ ...s, startedAt: "yesterday", createdAt: "", anchorIso: "never", timeline: s.timeline.map((t) => ({ ...t, offsetMs: null })), metrics: { ...s.metrics, t0Iso: "never" } });
  assert.match(h, /<time datetime="yesterday">[A-Z][a-z]{2} \d+, \d{4} · \d\d:\d\d UTC<\/time>/, "falls back to the build time label");
  assert.match(h, /tl-time">–:––</);
});

test("html and script injection through every text field is escaped", () => {
  const evil = `</script><script>alert(1)</script><img src=x onerror=alert(1)>"'&`;
  const s = readFixtureSession();
  const { h, body } = renders(
    {
      ...s,
      name: evil,
      device: { name: evil, runtime: evil },
      type: evil,
      dashboardUrl: `javascript:alert(1)`,
      timeline: [{ kind: "tap", tool: evil, label: evil, outcome: evil, ts: s.timeline[0].ts }],
      extra: { lane: evil, build_id: evil, metrics: evil },
      recording: { url: `https://example.com/${evil}` },
    },
    { subject: evil, verdict: `FAIL: ${evil}`, report: evil, projectName: evil, agentName: evil },
  );
  assert.doesNotMatch(body, /<script>alert/);
  assert.doesNotMatch(body, /<img src=x/);
  assert.doesNotMatch(h, /<\/script><script>alert/);
  assert.doesNotMatch(h, /href="javascript:/);
  assert.match(h, /&lt;\/script&gt;/);
  // The JSON handed to the page script cannot close the script tag either.
  const scriptJson = h.match(/var shots = (\[.*?\]);/s)[1];
  assert.doesNotMatch(scriptJson, /<\//);
});

test("a screenshot named like html cannot break the markup", notWindows, () => {
  const dir = makeEvidence({ images: [`1-<img src=x onerror=alert(1)>.png`, `2-"quoted".png`] });
  const out = fresh("evilname");
  buildSite({ dir, subject: "x", verdict: "PASS: x", out, log: quiet });
  const h = html(out);
  assert.doesNotMatch(h, /<img src=x/);
  assert.match(h, /alt="&lt;img src=x onerror=alert\(1\)&gt;"/);
  assert.match(h, /alt="&quot;quoted&quot;"/);
});

test("very long strings everywhere", () => {
  const long = "verylongtoken".repeat(400);
  const s = readFixtureSession();
  const { h } = renders(
    { ...s, name: long, device: { name: long, runtime: long }, timeline: [{ kind: "tap", tool: long, label: long, ts: s.timeline[0].ts }], extra: { lane: long } },
    { subject: long, verdict: `PASS: ${long}`, report: long.repeat(5), projectName: long, agentName: long },
  );
  assert.match(h, /h1 h1-xlong/);
  assert.match(h, /report-collapsed/);
  assert.ok(h.length > long.length * 8);
});

test("a huge timeline and metric set builds in reasonable time", () => {
  const s = readFixtureSession();
  const base = s.timeline[0];
  s.timeline = Array.from({ length: 5000 }, (_, i) => ({ ...base, label: `Step ${i}`, ts: new Date(Date.parse(base.ts) + i * 200).toISOString() }));
  s.metrics.samples = Array.from({ length: 20000 }, (_, i) => ({ t: i * 1000, cpu: (i % 100) / 2, memMB: 100 + (i % 50), app: true }));
  const t = Date.now();
  const { h } = renders(s);
  assert.ok(Date.now() - t < 5000, `took ${Date.now() - t} ms`);
  assert.match(h, /Show all 5000 steps/);
  assert.match(h, /20000 samples/);
});

test("session.json with a BOM or trailing garbage", () => {
  const good = JSON.stringify(readFixtureSession());
  const dir1 = makeEvidence({ images: ["1-a.png"], session: "\uFEFF" + good });
  const r1 = buildSite({ dir: dir1, subject: "x", verdict: "PASS: x", out: fresh("bom"), log: quiet });
  const dir2 = makeEvidence({ images: ["1-a.png"], session: good + "\n}" });
  const r2 = buildSite({ dir: dir2, subject: "x", verdict: "PASS: x", out: fresh("trail"), log: quiet });
  // Both are invalid JSON to Node; both degrade to a screenshots-only page.
  assert.equal(r1.session, null);
  assert.equal(r2.session, null);
});

test("the session dir copies only json and ndjson files to the site", () => {
  const dir = makeEvidence({ images: ["1-a.png"], session: readFixtureSession(), sessionFiles: { "notes.txt": "hi", "events.ndjson": "{}\n", "x.json": "{}" } });
  const out = fresh("copy");
  buildSite({ dir, subject: "x", verdict: "PASS: x", out, log: quiet });
  assert.ok(existsSync(`${out}/session/events.ndjson`));
  assert.ok(existsSync(`${out}/session/x.json`));
  assert.ok(!existsSync(`${out}/session/notes.txt`));
});
