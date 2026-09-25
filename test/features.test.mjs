// Tap markers, network chart, health banner, link previews, permalinks,
// the manifest, screenshot download, the index page, and the new CLI
// commands.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { join } from "node:path";
import { buildSite } from "../src/build.mjs";
import { buildIndex, readRuns } from "../src/index-page.mjs";
import { collectSession, orderScreenshots } from "../src/collect.mjs";
import { fixture, fresh, quiet, recorder, makeEvidence, makePng, html, htmlNoScript, cleanOut, cli, readFixtureSession, root } from "./helpers.mjs";

after(cleanOut);

const build = (opts) => {
  const out = fresh("feat");
  const r = buildSite({ dir: fixture, subject: "PR #1", verdict: "PASS: ok", out, log: quiet, ...opts });
  return { out, r, h: html(out) };
};

// --- tap markers -------------------------------------------------------------

test("each screenshot that followed a tap gets a ring at the tap's spot", () => {
  const { h } = build();
  // Fixture: tap (39%, 94%) -> shot 1; tap (90%, 43%) -> shot 2; tap (90%, 43%) -> shot 3.
  assert.match(h, /id="shot-1"[\s\S]*?<span class="tap-mark" style="left:39\.0%;top:94\.0%"/);
  assert.match(h, /id="shot-2"[\s\S]*?<span class="tap-mark" style="left:90\.0%;top:43\.0%"/);
  assert.equal((h.match(/class="tap-mark" style=/g) || []).length, 3);
  const shots = JSON.parse(h.match(/var shots = (\[.*?\]);/s)[1]);
  assert.deepEqual(shots[0].tap, { x: 0.39, y: 0.94 });
  assert.match(h, /id="lb-tap" hidden/);
});

test("no marker without a preceding tap, with point units, or with values outside the screen", () => {
  const s = readFixtureSession();
  s.timeline = [
    { kind: "tap", x: 120, y: 640, xyUnit: "pt", ts: s.timeline[0].ts },
    { kind: "screenshot", screenshotIndex: 0, outcome: "success", ts: s.timeline[0].ts },
    { kind: "tap", x: 1.5, y: 0.2, xyUnit: "fraction", ts: s.timeline[0].ts },
    { kind: "screenshot", screenshotIndex: 1, outcome: "success", ts: s.timeline[0].ts },
    { kind: "tap", x: 0.5, y: 0.5, xyUnit: "fraction", ts: s.timeline[0].ts },
    { kind: "describe", ts: s.timeline[0].ts },
    { kind: "screenshot", screenshotIndex: 2, outcome: "success", ts: s.timeline[0].ts },
    { kind: "screenshot", screenshotIndex: 3, outcome: "success", ts: s.timeline[0].ts },
  ];
  const dir = makeEvidence({ images: ["1-a.png", "2-b.png", "3-c.png", "4-d.png"], session: s });
  const out = fresh("taps");
  buildSite({ dir, subject: "x", verdict: "PASS: x", out, log: quiet });
  const h = html(out);
  assert.equal((h.match(/class="tap-mark" style=/g) || []).length, 1, "only the fraction tap inside the screen, and a screen read in between does not clear it");
  assert.match(h, /id="shot-3"[\s\S]*?left:50\.0%;top:50\.0%/);
  assert.doesNotMatch(h, /id="shot-4"[\s\S]*?class="tap-mark" style=/, "a second screenshot after the same tap gets no marker");
});

// --- network chart -----------------------------------------------------------

test("the network chart appears only when the app moved traffic", () => {
  const s = readFixtureSession();
  const quietNet = { ...s, metrics: { ...s.metrics, samples: s.metrics.samples.map((x) => ({ ...x, netIn: 0, netOut: 0 })) } };
  let dir = makeEvidence({ images: ["1-a.png"], session: quietNet });
  let out = fresh("net0");
  buildSite({ dir, subject: "x", verdict: "PASS: x", out, log: quiet });
  assert.doesNotMatch(html(out), /Network, KB\/s/);

  const busy = { ...s, metrics: { ...s.metrics, samples: s.metrics.samples.map((x, i) => ({ ...x, netIn: i * 2048, netOut: 512 })) } };
  dir = makeEvidence({ images: ["1-a.png"], session: busy });
  out = fresh("net1");
  buildSite({ dir, subject: "x", verdict: "PASS: x", out, log: quiet });
  const h = html(out);
  assert.match(h, /Network, KB\/s · in \(filled\) and out \(line\)/);
  assert.match(h, /peak 200 KB\/s/);
  assert.equal((h.match(/<path d="M\d+\.\d,\d+\.\d/g) || []).length, 7, "cpu line+area, memory line+area, net area+line+out line");
  assert.match(h, /stroke="var\(--brand-orange\)"/);
});

test("a megabyte-scale peak is labelled in MB/s", () => {
  const s = readFixtureSession();
  const busy = { ...s, metrics: { ...s.metrics, samples: s.metrics.samples.map((x) => ({ ...x, netIn: 3 * 1024 * 1024, netOut: 0 })) } };
  const dir = makeEvidence({ images: ["1-a.png"], session: busy });
  const out = fresh("netmb");
  buildSite({ dir, subject: "x", verdict: "PASS: x", out, log: quiet });
  assert.match(html(out), /peak 3\.0 MB\/s/);
});

// --- health banner -----------------------------------------------------------

test("a session that errored or was still running gets a banner; a stopped one does not", () => {
  const cases = [
    ["STOPPED", null],
    ["ERRORED", /banner-danger[^<]*>[\s\S]*?ended with an error/],
    ["IN_PROGRESS", /banner-warn[^<]*>[\s\S]*?still running when this data was collected/],
    ["new", /banner-warn/],
    [null, null],
  ];
  for (const [status, re] of cases) {
    const dir = makeEvidence({ images: ["1-a.png"], session: { ...readFixtureSession(), status } });
    const out = fresh("health");
    buildSite({ dir, subject: "x", verdict: "PASS: x", out, log: quiet });
    const h = html(out);
    if (re) assert.match(h, re, String(status));
    else assert.doesNotMatch(h, /class="banner/, String(status));
  }
});

// --- link previews -----------------------------------------------------------

test("og tags carry the verdict; the image needs a site url", () => {
  const { h } = build({ projectName: "My App", verdict: "FAIL: the <count> stuck" });
  assert.match(h, /<meta name="description" content="FAIL: the &lt;count&gt; stuck">/);
  assert.match(h, /<meta property="og:title" content="My App · PR #1">/);
  assert.match(h, /<meta property="og:description" content="FAIL: the &lt;count&gt; stuck">/);
  assert.match(h, /<meta name="twitter:card" content="summary">/);
  assert.doesNotMatch(h, /og:image|og:url|canonical/);

  const { h: h2, r } = build({ url: "https://example.com/pr-1/" });
  assert.equal(r.url, "https://example.com/pr-1");
  assert.match(h2, /<meta property="og:url" content="https:\/\/example\.com\/pr-1\/">/);
  assert.match(h2, /<link rel="canonical" href="https:\/\/example\.com\/pr-1\/">/);
  assert.match(h2, /<meta property="og:image" content="https:\/\/example\.com\/pr-1\/1-checklist\.png">/);
  assert.match(h2, /<meta name="twitter:card" content="summary_large_image">/);

  const { h: h3 } = build({ url: "javascript:alert(1)" });
  assert.doesNotMatch(h3, /og:image|javascript:/);
});

// --- permalinks --------------------------------------------------------------

test("tiles have shot-N ids and the viewer reads and writes the hash", () => {
  const { h } = build();
  assert.match(h, /id="shot-1" data-index="0"/);
  assert.match(h, /id="shot-3" data-index="2"/);
  assert.match(h, /\/\^#shot-\(\\d\+\)\$\/\.exec\(location\.hash\)/);
  assert.match(h, /history\.replaceState/);
  assert.match(h, /setHash\('shot-' \+ \(current \+ 1\)\)/);
});

// --- manifest ----------------------------------------------------------------

test("evidence.json describes the run for tooling", () => {
  const { out, r } = build({ projectName: "My App", agentName: "bot", buildId: "0123456789abcdef0123456789abcdef", url: "https://e.com/x" });
  assert.equal(r.manifest, join(out, "evidence.json"));
  const m = JSON.parse(readFileSync(r.manifest, "utf8"));
  assert.equal(m.schemaVersion, 1);
  assert.equal(m.subject, "PR #1");
  assert.equal(m.verdict, "PASS: ok");
  assert.equal(m.kind, "pass");
  assert.equal(m.projectName, "My App");
  assert.equal(m.agentName, "bot");
  assert.equal(m.url, "https://e.com/x");
  assert.equal(m.buildId, "0123456789abcdef0123456789abcdef");
  assert.deepEqual(m.images, ["1-checklist.png", "2-task-toggled-on.png", "3-task-toggled-off.png"]);
  assert.equal(m.firstImage, "1-checklist.png");
  assert.equal(m.session.id, "01a0d92e-195f-7045-a13c-23181fd8fc70");
  assert.equal(m.session.device, "iPhone 17");
  assert.equal(m.session.durationMs, 106639);
  assert.equal(m.session.counts.taps, 3);
  assert.match(m.generatedAt, /^\d{4}-/);

  const dir = makeEvidence({ images: [] });
  const r2 = buildSite({ dir, subject: "x", verdict: "PASS: x", out: fresh("m2"), log: quiet });
  const m2 = JSON.parse(readFileSync(r2.manifest, "utf8"));
  assert.equal(m2.session, null);
  assert.equal(m2.firstImage, null);
  assert.equal(m2.url, null);
  assert.equal(r2.durationMs, null);
});

// --- screenshot download -----------------------------------------------------

test("orderScreenshots follows the timeline, then file name order", () => {
  const uploaded = [{ file: "c.png", url: "u3" }, { file: "a.png", url: "u1" }, { file: "b.png", url: "u2" }, { file: "z10.png" }, { file: "z2.png" }];
  const timeline = [
    { kind: "screenshot", artifactFile: "b.png" },
    { kind: "tap" },
    { kind: "screenshot", artifactFile: "a.png" },
    { kind: "screenshot", artifactFile: "missing.png" },
  ];
  assert.deepEqual(orderScreenshots(uploaded, timeline).map((a) => a.file), ["b.png", "a.png", "c.png", "z2.png", "z10.png"]);
  assert.deepEqual(orderScreenshots([], []), []);
  assert.deepEqual(orderScreenshots(undefined, undefined), []);
});

const raw = () => JSON.parse(readFileSync(join(fixture, "raw", "simulator-get.json"), "utf8"));
const io = {
  getSession: async () => raw(),
  fetchText: async (url) => {
    const a = raw().artifacts.find((x) => x.downloadUrl === url);
    const t = a?.metadata?.__eas_type;
    if (t === "session-events") return readFileSync(join(fixture, "session", "events.ndjson"), "utf8");
    if (t === "performance-metrics") return readFileSync(join(fixture, "session", "metrics.ndjson"), "utf8");
    throw new Error("HTTP 404");
  },
  fetchBytes: async (url) => {
    const a = raw().artifacts.find((x) => x.downloadUrl === url);
    if (!a || !/\.png$/.test(a.filename)) throw new Error("HTTP 404");
    return makePng(12, 26);
  },
  sleep: async () => {},
};

test("collect --screenshots downloads the session's captures in capture order into an empty dir", async () => {
  const dir = fresh("dl");
  const rec = recorder();
  const out = await collectSession({ dir, sessionId: "s", screenshots: true, log: rec, ...io });
  assert.deepEqual(out.downloadedScreenshots, ["1-capture.png", "2-capture.png", "3-capture.png"]);
  for (const f of out.downloadedScreenshots) assert.ok(existsSync(join(dir, f)), f);
  // 1-capture.png is the artifact the first screenshot command produced.
  assert.equal(out.timeline.filter((t) => t.kind === "screenshot")[0].artifactFile, "683747000-1790350390691.png");
  assert.ok(rec.logs.some((l) => /downloaded 3 screenshot/.test(l)));
  // And the page builds from them.
  const r = buildSite({ dir, subject: "x", verdict: "PASS: x", out: fresh("dlsite"), log: quiet });
  assert.equal(r.images, 3);
  assert.match(html(r.siteDir), /Screenshot 1 · Capture/);
});

test("collect --screenshots leaves an evidence dir that already has images alone", async () => {
  const dir = fresh("dl2");
  writeFileSync(join(dir, "1-mine.png"), makePng(2, 2));
  const rec = recorder();
  const out = await collectSession({ dir, sessionId: "s", screenshots: true, log: rec, ...io });
  assert.equal(out.downloadedScreenshots, undefined);
  assert.ok(!existsSync(join(dir, "1-capture.png")));
  assert.ok(rec.logs.some((l) => /already in .*not downloading/.test(l)));
});

test("collect --screenshots survives a failed download and a session without captures", async () => {
  let dir = fresh("dl3");
  let out = await collectSession({ dir, sessionId: "s", screenshots: true, log: quiet, ...io, fetchBytes: async () => { throw new Error("HTTP 500"); } });
  assert.deepEqual(out.downloadedScreenshots, []);
  dir = fresh("dl4");
  const rec = recorder();
  out = await collectSession({ dir, sessionId: "s", screenshots: true, log: rec, ...io, getSession: async () => ({ ...raw(), artifacts: raw().artifacts.filter((a) => a.metadata?.__eas_type) }) });
  assert.ok(rec.logs.some((l) => /no screenshots to download/.test(l)));
  assert.equal(await collectSession({ dir: fresh("dl5"), sessionId: "s", screenshots: false, log: quiet, ...io }).then((o) => o.downloadedScreenshots), undefined);
});

// --- index page --------------------------------------------------------------

function runsDir() {
  const dir = fresh("runs");
  const mk = (folder, verdict, extra = {}) => {
    const src = makeEvidence({ images: ["1-home.png"], session: { ...readFixtureSession(), ...extra } });
    buildSite({ dir: src, subject: folder, verdict, out: join(dir, folder), log: quiet, projectName: "My App" });
  };
  mk("ios-home", "PASS: home rendered");
  mk("ios-checklist", "FAIL: Screenshot 1 shows the count stuck");
  mk("android-home", "REPLICATED: the bug", { platform: "ANDROID" });
  mk("android-checklist", "INCONCLUSIVE: no idea");
  mkdirSync(join(dir, "not-a-run"));
  writeFileSync(join(dir, "not-a-run", "index.html"), "<html></html>");
  mkdirSync(join(dir, "broken"));
  writeFileSync(join(dir, "broken", "index.html"), "");
  writeFileSync(join(dir, "broken", "evidence.json"), "{ nope");
  return dir;
}

test("readRuns finds only folders with a page and a valid manifest", () => {
  const runs = readRuns(runsDir());
  assert.deepEqual(runs.map((r) => r.folder), ["android-checklist", "android-home", "ios-checklist", "ios-home"]);
  assert.equal(runs[0].kind, "neutral");
  assert.deepEqual(readRuns(join(fresh("none"), "missing")), []);
});

test("buildIndex writes a card per run, failures first, with counts and links", () => {
  const dir = runsDir();
  const r = buildIndex({ dir, subject: "QA swarm · run 12", projectName: "My App", log: quiet });
  assert.equal(r.runs, 4);
  assert.deepEqual(r.counts, { pass: 1, fail: 1, replicated: 1, neutral: 1 });
  const h = readFileSync(join(dir, "index.html"), "utf8");
  assert.match(h, /<title>My App · QA swarm · run 12<\/title>/);
  assert.match(h, /4 runs · 1 failed · 1 replicated · 1 passed · 1 inconclusive/);
  const order = [...h.matchAll(/class="run-subject">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(order, ["ios-checklist", "android-home", "android-checklist", "ios-home"]);
  assert.match(h, /<a class="run" href="\.\/ios-checklist\/">/);
  assert.match(h, /<img src="\.\/ios-checklist\/1-home\.png"/);
  assert.match(h, /class="pill pill-fail">FAIL</);
  assert.match(h, /iPhone 17 · iOS 26\.5 · 1m 47s · 1 screenshot/);
  assert.ok(existsSync(join(dir, "colors_and_type.css")));
  assert.ok(existsSync(join(dir, "fonts", "Inter-Variable.woff2")));
  assert.doesNotMatch(h.replace(/<script>[\s\S]*?<\/script>/g, ""), /\b(NaN|undefined|null)\b/);
});

test("buildIndex with --out elsewhere links back into the runs dir, and an empty dir says so", () => {
  const dir = runsDir();
  const out = join(fresh("idx-out"), "public");
  buildIndex({ dir, out, log: quiet });
  const h = readFileSync(join(out, "index.html"), "utf8");
  assert.match(h, /href="\.\/\.\.\/(\.\.\/)*[^"]*runs[^"]*\/ios-home\/"/);
  const empty = fresh("idx-empty");
  const r = buildIndex({ dir: empty, log: quiet });
  assert.equal(r.runs, 0);
  assert.match(readFileSync(join(empty, "index.html"), "utf8"), /No runs found/);
  assert.throws(() => buildIndex({ dir: join(empty, "missing"), log: quiet }), /runs dir not found/);
});

// --- CLI ---------------------------------------------------------------------

test("cli: comment prints the markdown block", () => {
  const r = cli(["comment", fixture, "https://e.com/s", "--verdict-file", join(fixture, "verdict.txt"), "--agent", "expo-bot", "--line", "📡 channel `pr-1`", "--max", "1", "--title", "Agent verification"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^## 🤖 Agent verification\n\n\*\*Verdict:\*\* ✅ PASS: the progress card/);
  assert.match(r.stdout, /- 🖼️ \*\*Evidence\*\* — https:\/\/e\.com\/s\n- 📡 channel `pr-1`\n/);
  assert.equal((r.stdout.match(/<img /g) || []).length, 1);
  assert.match(r.stdout, /<details>\n<summary>Full report<\/summary>\n\nThe Checklist tab opened/);
  assert.match(r.stdout, /_Posted by expo-bot\._\n$/);
  assert.equal(cli(["comment", fixture, "https://e.com"]).code, 2, "needs a verdict");
});

test("cli: build --url and --junit", () => {
  const out = fresh("cli-url");
  const junit = join(fresh("junit"), "nested", "evidence.xml");
  const r = cli(["build", fixture, "--subject", "PR #9", "--verdict", "FAIL: Screenshot 2 bad", "--out", out, "--url", "https://e.com/pr-9", "--junit", junit, "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const s = JSON.parse(r.stdout);
  assert.equal(s.url, "https://e.com/pr-9");
  assert.match(readFileSync(join(out, "index.html"), "utf8"), /og:image" content="https:\/\/e\.com\/pr-9\/1-checklist\.png"/);
  const xml = readFileSync(junit, "utf8");
  assert.match(xml, /<testcase name="PR #9"/);
  assert.match(xml, /<failure message="FAIL: Screenshot 2 bad"/);
  assert.match(xml, /URL: https:\/\/e\.com\/pr-9/);
  assert.match(xml, /time="106\.639"/);
  assert.match(r.stderr, /JUnit written to/);
});

test("cli: index builds from a folder of sites", () => {
  const dir = runsDir();
  const r = cli(["index", dir, "--subject", "Swarm", "--name", "My App"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^4 runs\nIndex: .*index\.html\n$/);
  assert.equal(cli(["index", join(dir, "missing")]).code, 1);
  assert.equal(cli(["index"]).code, 2);
});

test("cli: sweep validates its number and accepts a dry run without an account", () => {
  const r = cli(["sweep", "--older-than", "soon"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--older-than must be a number/);
});

test("cli: collect accepts --screenshots and --stop as flags", () => {
  const dir = fresh("flag");
  const r = cli(["collect", dir, "--screenshots", "--stop", "--dotenv", join(dir, "none")], { env: { EAS_SIMULATOR_SESSION_ID: "" } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /no session id/);
});

test("the skill file exists, has frontmatter, and names the real commands", () => {
  const skill = readFileSync(join(root, "skills", "eas-simulator-evidence", "SKILL.md"), "utf8").replace(/\r\n/g, "\n");
  assert.match(skill, /^---\nname: eas-simulator-evidence\ndescription: .+\n---\n/);
  const help = cli(["--help"]).stdout;
  for (const cmd of ["run", "open", "deploy", "comment"]) {
    assert.match(skill, new RegExp(`eas-simulator-evidence@latest ${cmd}\\b`), cmd);
    assert.match(help, new RegExp(`^  eas-simulator-evidence ${cmd} `, "m"), cmd);
  }
  for (const flag of ["--subject", "--verdict-file", "--build-id", "--screenshots", "--json", "--junit", "--alias", "--agent"]) assert.match(help, new RegExp(`${flag}\\b`), flag);
});
