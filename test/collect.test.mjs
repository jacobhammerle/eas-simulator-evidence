import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  collectSession,
  normalizeSession,
  normalizeTimeline,
  normalizeMetrics,
  dotenvSessionId,
  parseCliJson,
  kindOf,
  ndjson,
} from "../src/collect.mjs";
import { fixture, fresh, quiet, recorder, cleanOut, readFixtureSession } from "./helpers.mjs";

after(cleanOut);

const raw = () => JSON.parse(readFileSync(join(fixture, "raw", "simulator-get.json"), "utf8"));
const eventsText = () => readFileSync(join(fixture, "session", "events.ndjson"), "utf8");
const metricsText = () => readFileSync(join(fixture, "session", "metrics.ndjson"), "utf8");

test("normalizeSession reproduces the committed session.json from the raw artifacts", () => {
  const expected = readFixtureSession();
  const got = normalizeSession({
    session: raw(),
    eventsText: eventsText(),
    metricsText: metricsText(),
    extra: expected.extra,
    collectedAt: expected.collectedAt,
  });
  assert.deepEqual(got, expected);
});

test("the timeline reads argent events: tool ids, outcomes, screenshot pairing", () => {
  const tl = normalizeTimeline(eventsText(), { anchorIso: "2026-09-25T15:31:19.269Z" });
  assert.equal(tl.length, 13);
  assert.deepEqual(tl.map((t) => t.kind), ["other", "describe", "open", "describe", "tap", "describe", "screenshot", "tap", "describe", "screenshot", "tap", "describe", "screenshot"]);
  assert.deepEqual(tl.filter((t) => t.kind === "screenshot").map((t) => t.screenshotIndex), [0, 1, 2]);
  assert.equal(tl[6].artifactFile, "683747000-1790350390691.png");
  assert.deepEqual({ x: tl[4].x, y: tl[4].y, unit: tl[4].xyUnit }, { x: 0.39, y: 0.94, unit: "fraction" });
  assert.equal(tl[1].repeat, 3, "three consecutive screen reads fold into one");
  assert.ok(tl.every((t) => t.outcome === "success"));
  assert.ok(tl.every((t) => typeof t.offsetMs === "number" && t.offsetMs > 0));
});

test("the timeline reads agent-device events: interaction.recorded and 'Started <cmd>' summaries", () => {
  const lines = [
    { ts: "2026-01-01T00:00:01Z", producer: "agent-device", type: "operation.started", operationId: "a", summary: "Started press" },
    { ts: "2026-01-01T00:00:01.100Z", producer: "agent-device", type: "interaction.recorded", operationId: "a", summary: "press @e2 (Sign in)", data: { command: "press", x: 120, y: 640, appBundleId: "com.x" } },
    { ts: "2026-01-01T00:00:01.500Z", producer: "agent-device", type: "operation.completed", operationId: "a", summary: "Finished press", outcome: "success", data: { durationMs: 400 } },
    { ts: "2026-01-01T00:00:02Z", producer: "agent-device", type: "operation.started", operationId: "b", summary: "Started screenshot" },
    { ts: "2026-01-01T00:00:02.300Z", producer: "agent-device", type: "operation.completed", operationId: "b", summary: "Captured screenshot shot-1.png", outcome: "success", durationMs: 300 },
    { ts: "2026-01-01T00:00:03Z", producer: "agent-device", type: "operation.started", operationId: "c", summary: "Started fill" },
    { ts: "2026-01-01T00:00:03.200Z", producer: "agent-device", type: "operation.completed", operationId: "c", summary: "Finished fill", outcome: "failure" },
    { ts: "2026-01-01T00:00:04Z", producer: "agent-device", type: "operation.started", operationId: "d", summary: "Started wait" },
  ];
  const tl = normalizeTimeline(lines.map((l) => JSON.stringify(l)).join("\n"), { anchorIso: "2026-01-01T00:00:00Z" });
  assert.equal(tl.length, 4);
  assert.deepEqual(tl[0], { ts: "2026-01-01T00:00:01Z", offsetMs: 1000, kind: "tap", tool: "press", label: "press @e2 (Sign in)", outcome: "success", durationMs: 400, x: 120, y: 640, xyUnit: "pt" });
  assert.equal(tl[1].kind, "screenshot");
  assert.equal(tl[1].screenshotIndex, 0);
  assert.equal(tl[1].artifactFile, "shot-1.png");
  assert.equal(tl[2].kind, "type");
  assert.equal(tl[2].outcome, "failure");
  assert.equal(tl[3].kind, "wait");
  assert.equal(tl[3].outcome, "unknown", "an operation that never completed");
  assert.equal(tl[3].durationMs, null);
});

test("a failed screenshot does not consume a screenshot index", () => {
  const lines = [
    { ts: "2026-01-01T00:00:01Z", type: "operation.started", operationId: "a", data: { toolId: "screenshot" } },
    { ts: "2026-01-01T00:00:01.100Z", type: "operation.completed", operationId: "a", outcome: "failure", summary: "screenshot failed" },
    { ts: "2026-01-01T00:00:02Z", type: "operation.started", operationId: "b", data: { toolId: "screenshot" } },
    { ts: "2026-01-01T00:00:02.100Z", type: "operation.completed", operationId: "b", outcome: "success", summary: "Captured screenshot x.png" },
  ];
  const tl = normalizeTimeline(lines.map((l) => JSON.stringify(l)).join("\n"));
  assert.equal(tl[0].screenshotIndex, undefined);
  assert.equal(tl[1].screenshotIndex, 0);
});

test("events out of order are sorted by timestamp; a completion without a start still counts", () => {
  const lines = [
    { ts: "2026-01-01T00:00:05Z", type: "operation.completed", operationId: "late", outcome: "success", summary: "Tapped at (10%, 20%)", data: { toolId: "gesture-tap" } },
    { ts: "2026-01-01T00:00:01Z", type: "operation.completed", operationId: "early", outcome: "success", summary: "Read screen", data: { toolId: "describe" } },
    { ts: "2026-01-01T00:00:03Z", type: "service.state_change", summary: "ignored, no operationId" },
  ];
  const tl = normalizeTimeline(lines.map((l) => JSON.stringify(l)).join("\n"));
  assert.deepEqual(tl.map((t) => t.tool), ["describe", "gesture-tap"]);
  assert.deepEqual([tl[1].x, tl[1].y], [0.1, 0.2]);
});

test("malformed ndjson lines are skipped, not fatal", () => {
  const text = 'not json\n{"ts":"2026-01-01T00:00:01Z","type":"operation.completed","operationId":"a","outcome":"success","data":{"toolId":"wait"}}\n\n[1,2]\n"str"\n{"broken":\n';
  const tl = normalizeTimeline(text);
  assert.equal(tl.length, 1);
  assert.equal(tl[0].kind, "wait");
  assert.deepEqual(ndjson(""), []);
  assert.deepEqual(ndjson(null), []);
  assert.deepEqual(ndjson("  \n \n"), []);
});

test("kindOf maps every controller verb, then falls back to the summary", () => {
  const expect = {
    "gesture-tap": "tap", press: "tap", tap: "tap", click: "tap", longpress: "tap",
    keyboard: "type", fill: "type", type: "type", paste: "type",
    "gesture-swipe": "swipe", "gesture-scroll": "swipe", scroll: "swipe", "gesture-pinch": "swipe", "gesture-rotate": "swipe",
    screenshot: "screenshot",
    "screen-recording-start": "recording", record: "recording",
    describe: "describe", snapshot: "describe", "debugger-component-tree": "describe", find: "describe",
    "launch-app": "open", open: "open", "restart-app": "open", "install-from-source": "open", "boot-device": "open", "open-url": "open",
    wait: "wait", "await-ui-element": "wait",
    alert: "alert",
    "list-devices": "other", apps: "other", "": "other",
  };
  for (const [tool, kind] of Object.entries(expect)) assert.equal(kindOf(tool), kind, tool);
  assert.equal(kindOf(null, "Tapped at (1%, 2%)"), "tap");
  assert.equal(kindOf(undefined, "Captured screenshot x.png"), "screenshot");
  assert.equal(kindOf("", "Reading screen"), "describe");
  assert.equal(kindOf("", "Launching app"), "open");
  assert.equal(kindOf("", "Typing hello"), "type");
  assert.equal(kindOf("", "Scrolled down"), "swipe");
  assert.equal(kindOf("", "Waiting for idle"), "wait");
  assert.equal(kindOf("", "Something else"), "other");
  assert.equal(kindOf("", null), "other");
});

test("metrics: samples, summary, anchors, and the app-only filter", () => {
  const session = { startedAt: "2026-01-01T00:00:10Z", createdAt: "2026-01-01T00:00:00Z" };
  const text = [
    { t: 1000.4, bundleId: null, cpuPct: 50, memBytes: 1048576 },
    { t: 2000, bundleId: "com.x", cpuPct: 10, memBytes: 2 * 1048576, netInBytesPerSec: 5 },
    { t: 3000, bundleId: "com.x", cpuPct: 30, memBytes: 4 * 1048576, netInBytesPerSec: 7 },
    { t: "4000", cpuPct: 99 },
    { cpuPct: 99 },
    { t: 5000, bundleId: "com.x", cpuPct: null, memBytes: null },
  ].map((l) => JSON.stringify(l)).join("\n");
  const m = normalizeMetrics(text, { session, metricsArt: { metadata: { sampleIntervalMs: 500 } }, recordingArt: null });
  assert.equal(m.samples.length, 4);
  assert.deepEqual(m.samples[0], { t: 1000, cpu: 50, memMB: 1, netIn: 0, netOut: 0, app: false });
  assert.deepEqual(m.summary, { samples: 4, appSamples: 2, cpuMax: 30, cpuAvg: 20, memMaxMB: 4, memAvgMB: 3, netInMaxBps: 7, netInTotalBytes: 12 });
  assert.equal(m.t0Iso, "2026-01-01T00:00:10Z");
  assert.equal(m.t0Source, "session-start");
  assert.equal(m.sampleIntervalMs, 500);

  const m2 = normalizeMetrics(text, { session, metricsArt: null, recordingArt: { metadata: { firstFrameAt: "2026-01-01T00:00:12Z" } } });
  assert.equal(m2.t0Iso, "2026-01-01T00:00:12Z");
  assert.equal(m2.t0Source, "recording");
  assert.equal(m2.sampleIntervalMs, 1000);

  assert.equal(normalizeMetrics("", { session }), null);
  assert.equal(normalizeMetrics("{}\n{\"t\":\"x\"}", { session }), null);
  const m3 = normalizeMetrics('{"t":1,"bundleId":null,"cpuPct":5}', { session });
  assert.deepEqual(m3.summary, { samples: 1, appSamples: 0, cpuMax: null, cpuAvg: null, memMaxMB: null, memAvgMB: null, netInMaxBps: null, netInTotalBytes: 0 });
});

test("normalizeSession with a bare session: nulls, not crashes", () => {
  const s = normalizeSession({ session: { id: "x" }, collectedAt: "c" });
  assert.equal(s.id, "x");
  assert.equal(s.metrics, null);
  assert.deepEqual(s.timeline, []);
  assert.deepEqual(s.counts, { operations: 0, taps: 0, screenshots: 0, failed: 0, describes: 0 });
  assert.equal(s.bootMs, null);
  assert.equal(s.durationMs, null);
  assert.equal(s.recording, null);
  assert.deepEqual(s.device, { name: null, udid: null, runtime: null, hostCores: null });
  assert.deepEqual(s.raw, { metrics: null, events: null });
  assert.deepEqual(s.uploadedScreenshots, []);
  assert.deepEqual(s.tags, []);
  assert.equal(s.anchorIso, null);
  assert.equal(s.dashboardUrl, null);
  assert.deepEqual(s.extra, {});
  assert.throws(() => normalizeSession({}), /session is required/);
  assert.throws(() => normalizeSession({ session: "str" }), /session is required/);
});

test("normalizeSession: artifacts of the wrong shape, extra of the wrong type", () => {
  const s = normalizeSession({
    session: { id: "x", artifacts: [null, {}, { filename: "a.png" }, { filename: 3 }, { metadata: { __eas_type: "screen-recording" } }] },
    extra: "not an object",
    collectedAt: "c",
  });
  assert.deepEqual(s.uploadedScreenshots, [{ file: "a.png", bytes: null, url: null }]);
  assert.deepEqual(s.recording, { url: null, bytes: null, width: null, height: null, firstFrameAt: null });
  assert.deepEqual(s.extra, {});
});

test("the anchor prefers the recording's first frame, then session start, then the first event", () => {
  const ev = JSON.stringify({ ts: "2026-01-01T00:00:07Z", type: "operation.completed", operationId: "a", outcome: "success" });
  assert.equal(normalizeSession({ session: { startedAt: "2026-01-01T00:00:05Z", artifacts: [{ metadata: { __eas_type: "screen-recording", firstFrameAt: "2026-01-01T00:00:03Z" } }] }, eventsText: ev }).anchorIso, "2026-01-01T00:00:03Z");
  assert.equal(normalizeSession({ session: { startedAt: "2026-01-01T00:00:05Z" }, eventsText: ev }).anchorIso, "2026-01-01T00:00:05Z");
  assert.equal(normalizeSession({ session: {}, eventsText: ev }).anchorIso, "2026-01-01T00:00:07Z");
});

test("dotenvSessionId reads quoted and unquoted values and tolerates a missing file", () => {
  const d = fresh("dotenv");
  const f = join(d, ".env.eas-simulator");
  writeFileSync(f, "# managed\nEAS_SIMULATOR_SESSION_ID='abc-123'\nOTHER=x\n");
  assert.equal(dotenvSessionId(f), "abc-123");
  writeFileSync(f, 'EAS_SIMULATOR_SESSION_ID="q"\n');
  assert.equal(dotenvSessionId(f), "q");
  writeFileSync(f, "EAS_SIMULATOR_SESSION_ID=plain \n");
  assert.equal(dotenvSessionId(f), "plain");
  writeFileSync(f, "# managed by eas-cli\n");
  assert.equal(dotenvSessionId(f), "");
  assert.equal(dotenvSessionId(join(d, "missing")), "");
  assert.equal(dotenvSessionId(""), "");
});

test("parseCliJson skips eas-cli banner lines", () => {
  assert.deepEqual(parseCliJson('★ eas-cli@24.6.0 is now available\n{"a":1}'), { a: 1 });
  assert.deepEqual(parseCliJson('{"a":{"b":2}}'), { a: { b: 2 } });
  assert.throws(() => parseCliJson("no json here"), /no JSON object/);
  assert.throws(() => parseCliJson(""), /no JSON object/);
});

// --- collectSession with injected IO ------------------------------------------

const artifacts = () => raw().artifacts;
const withArts = (arts) => ({ ...raw(), artifacts: arts });
const fetchFromFixture = async (url) => {
  const a = artifacts().find((x) => x.downloadUrl === url);
  if (!a) throw new Error(`HTTP 404 ${url}`);
  if (a.metadata?.__eas_type === "session-events") return eventsText();
  if (a.metadata?.__eas_type === "performance-metrics") return metricsText();
  return "";
};

test("collectSession writes session.json and both ndjson files", async () => {
  const dir = fresh("collect");
  const rec = recorder();
  const out = await collectSession({
    dir, sessionId: "01a0d92e-195f-7045-a13c-23181fd8fc70", extra: { lane: "L" },
    getSession: async () => raw(), fetchText: fetchFromFixture, sleep: async () => {}, log: rec, now: () => "NOW",
  });
  assert.equal(out.id, "01a0d92e-195f-7045-a13c-23181fd8fc70");
  assert.equal(out.collectedAt, "NOW");
  assert.deepEqual(out.extra, { lane: "L" });
  const written = JSON.parse(readFileSync(join(dir, "session", "session.json"), "utf8"));
  assert.deepEqual(written, out);
  assert.equal(readFileSync(join(dir, "session", "events.ndjson"), "utf8"), eventsText());
  assert.equal(readFileSync(join(dir, "session", "metrics.ndjson"), "utf8"), metricsText());
  assert.match(rec.logs.at(-1), /13 operations, 101 metric samples, recording linked/);
});

test("collectSession polls until the events and metrics artifacts exist", async () => {
  const dir = fresh("poll");
  let calls = 0;
  const slept = [];
  const out = await collectSession({
    dir, sessionId: "s", pollMs: 10, maxWaitMs: 100,
    getSession: async () => {
      calls++;
      if (calls < 3) return withArts(artifacts().filter((a) => a.metadata?.__eas_type !== "performance-metrics"));
      return raw();
    },
    fetchText: fetchFromFixture, sleep: async (ms) => slept.push(ms), log: quiet,
  });
  assert.equal(calls, 3);
  assert.deepEqual(slept, [10, 10]);
  assert.equal(out.metrics.samples.length, 101);
});

test("collectSession gives up after maxWaitMs and keeps what it has", async () => {
  const dir = fresh("giveup");
  let calls = 0;
  const rec = recorder();
  const out = await collectSession({
    dir, sessionId: "s", pollMs: 10, maxWaitMs: 35,
    getSession: async () => { calls++; return withArts(artifacts().filter((a) => a.metadata?.__eas_type === "session-events")); },
    fetchText: fetchFromFixture, sleep: async () => {}, log: rec,
  });
  assert.equal(calls, 4, "ceil(35/10) attempts");
  assert.equal(out.metrics, null);
  assert.equal(out.timeline.length, 13);
  assert.equal(out.raw.metrics, null);
  assert.equal(out.raw.events, "events.ndjson");
  assert.ok(rec.logs.some((l) => /artifacts not finalized yet/.test(l)));
});

test("collectSession survives a failing simulator:get and a failing download", async () => {
  const dir = fresh("fail");
  const rec = recorder();
  let calls = 0;
  const out = await collectSession({
    dir, sessionId: "s", pollMs: 1, maxWaitMs: 3,
    getSession: async () => { calls++; if (calls === 1) throw new Error("Not authorized\nmore"); return raw(); },
    fetchText: async () => { throw new Error("HTTP 500"); },
    sleep: async () => {}, log: rec,
  });
  assert.ok(rec.logs.some((l) => /simulator:get failed \(attempt 1\): Not authorized$/.test(l)));
  assert.ok(rec.logs.some((l) => /download of metrics\.ndjson failed: HTTP 500/.test(l)));
  assert.equal(out.metrics, null);
  assert.deepEqual(out.timeline, []);
  assert.ok(existsSync(join(dir, "session", "session.json")));
  assert.ok(!existsSync(join(dir, "session", "events.ndjson")));
});

test("collectSession returns null when simulator:get never answers", async () => {
  const dir = fresh("never");
  const rec = recorder();
  const out = await collectSession({ dir, sessionId: "s", pollMs: 1, maxWaitMs: 2, getSession: async () => { throw new Error("boom"); }, sleep: async () => {}, log: rec });
  assert.equal(out, null);
  assert.ok(!existsSync(join(dir, "session")));
  assert.match(rec.logs.at(-1), /could not read the session/);
});

test("collectSession returns null without a session id, and reads one from the env file", async () => {
  const dir = fresh("noid");
  const rec = recorder();
  const saved = process.env.EAS_SIMULATOR_SESSION_ID;
  delete process.env.EAS_SIMULATOR_SESSION_ID;
  try {
    assert.equal(await collectSession({ dir, envFile: join(dir, "missing.env"), log: rec, getSession: async () => { throw new Error("must not be called"); } }), null);
    assert.match(rec.logs[0], /no session id/);

    const envFile = join(dir, ".env.eas-simulator");
    writeFileSync(envFile, "EAS_SIMULATOR_SESSION_ID='from-env-file'\n");
    let asked;
    await collectSession({ dir, envFile, log: quiet, pollMs: 1, maxWaitMs: 1, getSession: async (id) => { asked = id; return raw(); }, fetchText: fetchFromFixture, sleep: async () => {} });
    assert.equal(asked, "from-env-file");

    process.env.EAS_SIMULATOR_SESSION_ID = "from-env";
    await collectSession({ dir, envFile, log: quiet, pollMs: 1, maxWaitMs: 1, getSession: async (id) => { asked = id; return raw(); }, fetchText: fetchFromFixture, sleep: async () => {} });
    assert.equal(asked, "from-env", "the environment beats the file");
    await collectSession({ dir, sessionId: "explicit", envFile, log: quiet, pollMs: 1, maxWaitMs: 1, getSession: async (id) => { asked = id; return raw(); }, fetchText: fetchFromFixture, sleep: async () => {} });
    assert.equal(asked, "explicit", "an explicit id beats both");
  } finally {
    if (saved === undefined) delete process.env.EAS_SIMULATOR_SESSION_ID;
    else process.env.EAS_SIMULATOR_SESSION_ID = saved;
  }
});

test("collectSession requires a dir", async () => {
  await assert.rejects(collectSession({ sessionId: "s" }), /dir is required/);
});

test("collectSession --stop stops the session first, and a failed stop does not abort", async () => {
  const dir = fresh("stop");
  const calls = [];
  const rec = recorder();
  const out = await collectSession({
    dir, sessionId: "s1", stop: true, pollMs: 1, maxWaitMs: 1, log: rec,
    stopSession: async (id) => { calls.push(id); },
    getSession: async () => { calls.push("get"); return raw(); },
    fetchText: fetchFromFixture, sleep: async () => {},
  });
  assert.deepEqual(calls.slice(0, 2), ["s1", "get"], "stop runs before the first simulator:get");
  assert.equal(out.timeline.length, 13);
  assert.ok(rec.logs.some((l) => /stopped session s1/.test(l)));

  const rec2 = recorder();
  const out2 = await collectSession({
    dir: fresh("stop2"), sessionId: "s2", stop: true, pollMs: 1, maxWaitMs: 1, log: rec2,
    stopSession: async () => { throw new Error("Not authorized\nstack"); },
    getSession: async () => raw(), fetchText: fetchFromFixture, sleep: async () => {},
  });
  assert.equal(out2.id, "01a0d92e-195f-7045-a13c-23181fd8fc70");
  assert.ok(rec2.logs.some((l) => /simulator:stop failed \(continuing\): Not authorized$/.test(l)));

  let stopped = false;
  await collectSession({ dir: fresh("stop3"), sessionId: "s3", stop: false, pollMs: 1, maxWaitMs: 1, log: quiet, stopSession: async () => { stopped = true; }, getSession: async () => raw(), fetchText: fetchFromFixture, sleep: async () => {} });
  assert.equal(stopped, false, "no --stop, no stop");
});
