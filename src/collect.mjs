// Collects an EAS Simulator session's own artifacts into the evidence dir so
// the evidence site can show more than screenshots.
//
//   await collectSession({ dir, sessionId, extra, ... }) -> session summary | null
//   normalizeSession({ session, eventsText, metricsText, extra }) -> session summary
//
// The session id comes from the sessionId option, EAS_SIMULATOR_SESSION_ID,
// or .env.eas-simulator (eas-cli leaves the id there after simulator:stop).
// Run it AFTER simulator:stop: the platform finalizes the artifacts on stop
// (performance metrics, session events, the screen recording, screenshots).
// It polls simulator:get for up to maxWaitMs until the events and metrics
// artifacts appear.
//
// Writes <dir>/session/:
//   session.json      normalized facts, timeline, metrics, recording link
//   metrics.ndjson    raw per-second cpu/mem/net samples (when present)
//   events.ndjson     raw activity events (when present)
// The recording is linked by its expo.dev artifact URL, not copied: a
// session video is 10-40 MB, more than a static host should carry.
//
// Never throws for a missing session: any problem prints a note and returns
// null with whatever it managed to write. An absent session/ dir leaves the
// site as it was (screenshots only).
//
// normalizeSession is pure: it turns the raw simulator:get JSON plus the
// two NDJSON artifacts into session.json. Everything that touches the
// network or eas-cli is injectable (getSession, fetchText, sleep), so the
// whole path is testable without an account.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SCHEMA_VERSION = 1;

export function dotenvSessionId(file = ".env.eas-simulator") {
  if (!file || !existsSync(file)) return "";
  const m = readFileSync(file, "utf8").match(
    /^EAS_SIMULATOR_SESSION_ID=['"]?([^'"\n]+)/m,
  );
  return m ? m[1].trim() : "";
}

// eas-cli prints banner lines before its JSON. Take the JSON.
export function parseCliJson(raw) {
  const s = String(raw ?? "");
  const start = s.indexOf("{");
  if (start < 0) throw new Error("no JSON object in eas-cli output");
  return JSON.parse(s.slice(start));
}

export function runEasSimulatorGet(sessionId, easCliVersion = "latest") {
  const raw = execFileSync(
    "npx",
    [
      "--yes",
      `eas-cli@${easCliVersion}`,
      "simulator:get",
      "--id",
      sessionId,
      "--json",
      "--non-interactive",
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  return parseCliJson(raw);
}

const artType = (a) => a?.metadata?.__eas_type || "";

export const ndjson = (text) =>
  String(text || "")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((v) => v && typeof v === "object");

// Timeline kinds by the controller's tool name. agent-device and argent
// name their commands differently; both map onto one small set.
const KIND_BY_TOOL = [
  [/^(gesture-tap|press|click|longpress|tap)$/, "tap"],
  [/^(keyboard|fill|type|paste)$/, "type"],
  [
    /^(gesture-swipe|gesture-scroll|gesture-drag|scroll|swipe|gesture-custom|gesture-pinch|gesture-rotate)$/,
    "swipe",
  ],
  [/^(screenshot)$/, "screenshot"],
  [/^(screen-recording-start|screen-recording-stop|record)$/, "recording"],
  [
    /^(describe|snapshot|native-describe-screen|debugger-component-tree|find|get|is)$/,
    "describe",
  ],
  [
    /^(launch-app|restart-app|open|reinstall-app|install|install-from-source|boot-device|open-url)$/,
    "open",
  ],
  [/^(wait|await-ui-element|await-screen-idle)$/, "wait"],
  [/^(alert)$/, "alert"],
];
export const kindOf = (tool, summary) => {
  for (const [re, kind] of KIND_BY_TOOL) if (re.test(tool || "")) return kind;
  const s = String(summary || "").toLowerCase();
  if (/^tap/.test(s)) return "tap";
  if (/screenshot/.test(s)) return "screenshot";
  if (/read(ing)? screen|snapshot/.test(s)) return "describe";
  if (/^(open|launch|restart)/.test(s)) return "open";
  if (/^(fill|typ)/.test(s)) return "type";
  if (/swip|scroll/.test(s)) return "swipe";
  if (/^wait/.test(s)) return "wait";
  return "other";
};

const isoMs = (iso) => {
  const n = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(n) ? n : null;
};
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const numbers = (a) => a.filter((x) => typeof x === "number");
const max = (a) => (a.length ? Math.max(...a) : null);
const avg = (a) =>
  a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : null;

// --- Metrics: one sample per second of app cpu %, memory, network ----------
export function normalizeMetrics(metricsText, { metricsArt, recordingArt, session }) {
  const samples = ndjson(metricsText)
    .filter((r) => num(r.t) != null)
    .map((r) => ({
      t: Math.round(r.t),
      cpu: num(r.cpuPct),
      memMB: num(r.memBytes) != null ? +(r.memBytes / 1048576).toFixed(1) : null,
      netIn: num(r.netInBytesPerSec) ?? 0,
      netOut: num(r.netOutBytesPerSec) ?? 0,
      app: r.bundleId != null,
    }));
  if (!samples.length) return null;
  const appSamples = samples.filter((s) => s.app && s.cpu != null);
  return {
    // Sample time is relative. The recording starts with the device, so its
    // first frame is the best available anchor; the session start is the
    // fallback. Marked approximate on the page.
    t0Iso:
      recordingArt?.metadata?.firstFrameAt ||
      session.startedAt ||
      session.createdAt ||
      null,
    t0Source: recordingArt?.metadata?.firstFrameAt ? "recording" : "session-start",
    sampleIntervalMs: num(metricsArt?.metadata?.sampleIntervalMs) ?? 1000,
    samples,
    summary: {
      samples: samples.length,
      appSamples: appSamples.length,
      cpuMax: max(numbers(appSamples.map((s) => s.cpu))),
      cpuAvg: avg(numbers(appSamples.map((s) => s.cpu))),
      memMaxMB: max(numbers(appSamples.map((s) => s.memMB))),
      memAvgMB: avg(numbers(appSamples.map((s) => s.memMB))),
      netInMaxBps: max(numbers(appSamples.map((s) => s.netIn))),
      netInTotalBytes: appSamples.reduce((x, s) => x + (s.netIn || 0), 0),
    },
  };
}

// --- Timeline: one entry per device operation ---------------------------------
const parsePct = (s) => {
  const m = String(s || "").match(/\((\d+(?:\.\d+)?)%,\s*(\d+(?:\.\d+)?)%\)/);
  return m ? { x: +m[1] / 100, y: +m[2] / 100 } : null;
};
const shotFileFromSummary = (s) =>
  String(s || "").match(/screenshot\s+(\S+\.(?:png|jpe?g))/i)?.[1] || null;

export function normalizeTimeline(eventsText, { anchorIso } = {}) {
  const events = ndjson(eventsText);
  const ops = new Map();
  for (const e of events) {
    if (!e.operationId) continue;
    const op = ops.get(e.operationId) || {
      id: e.operationId,
      producer: e.producer,
    };
    if (e.type === "operation.started") {
      op.ts = e.ts;
      op.startSummary = e.summary;
      // agent-device names the command only in the summary ("Started wait").
      op.tool =
        e.data?.toolId ||
        e.data?.command ||
        op.tool ||
        String(e.summary || "").match(/^Started (\S+)/)?.[1];
    } else if (e.type === "operation.completed") {
      op.endTs = e.ts;
      op.ts = op.ts || e.ts;
      op.summary = e.summary;
      op.outcome = e.outcome;
      op.durationMs = num(e.durationMs) ?? num(e.data?.durationMs);
      op.tool = op.tool || e.data?.toolId || e.data?.command;
      op.artifact = e.data?.artifactBasename || e.data?.artifact || null;
    } else if (e.type === "interaction.recorded") {
      // agent-device: the structural detail of the action (command, x/y, ref).
      op.ts = op.ts || e.ts;
      op.tool = e.data?.command || op.tool;
      op.detail = e.summary;
      if (typeof e.data?.x === "number") op.x = e.data.x;
      if (typeof e.data?.y === "number") op.y = e.data.y;
      op.xyUnit = "pt";
      op.app = e.data?.appBundleId || null;
    }
    ops.set(e.operationId, op);
  }
  const anchorMs = isoMs(anchorIso);

  let screenshotIndex = 0;
  const timeline = [...ops.values()]
    .filter((o) => o.ts)
    .sort((a, b) => String(a.ts).localeCompare(String(b.ts)))
    .map((o) => {
      const kind = kindOf(o.tool, o.summary || o.startSummary);
      const pct = parsePct(o.summary || o.startSummary);
      const tsMs = isoMs(o.ts);
      const entry = {
        ts: o.ts,
        offsetMs: anchorMs != null && tsMs != null ? tsMs - anchorMs : null,
        kind,
        tool: o.tool || null,
        label:
          (o.detail && /^Finished /.test(o.summary || "") ? o.detail : o.summary) ||
          o.detail ||
          o.startSummary ||
          o.tool ||
          "operation",
        outcome: o.outcome || (o.endTs ? "success" : "unknown"),
        durationMs: o.durationMs != null ? Math.round(o.durationMs) : null,
      };
      if (pct) Object.assign(entry, { x: pct.x, y: pct.y, xyUnit: "fraction" });
      else if (typeof o.x === "number")
        Object.assign(entry, { x: o.x, y: o.y, xyUnit: o.xyUnit });
      if (kind === "screenshot" && entry.outcome === "success") {
        // The site pairs the n-th capture with the n-th image in the evidence
        // dir (agents save their screenshots in capture order).
        entry.screenshotIndex = screenshotIndex++;
        entry.artifactFile = shotFileFromSummary(o.summary);
      }
      return entry;
    });

  // Runs of identical housekeeping (waits, screen reads) fold into one row.
  const housekeeping = (t) =>
    t.kind === "other" || t.kind === "wait" || t.kind === "describe";
  for (let i = timeline.length - 1; i > 0; i--) {
    const cur = timeline[i],
      prev = timeline[i - 1];
    if (
      housekeeping(cur) &&
      cur.kind === prev.kind &&
      cur.label === prev.label &&
      cur.outcome === prev.outcome
    ) {
      prev.repeat = (prev.repeat || 1) + (cur.repeat || 1);
      prev.durationMs = (prev.durationMs || 0) + (cur.durationMs || 0);
      timeline.splice(i, 1);
    }
  }
  return timeline;
}

export function normalizeSession({
  session,
  eventsText = "",
  metricsText = "",
  extra = {},
  collectedAt = new Date().toISOString(),
} = {}) {
  if (!session || typeof session !== "object") {
    throw new Error("normalizeSession: session is required");
  }
  const artifacts = Array.isArray(session.artifacts) ? session.artifacts : [];
  const metricsArt = artifacts.find((a) => artType(a) === "performance-metrics");
  const recordingArt = artifacts.find((a) => artType(a) === "screen-recording");
  const shotArts = artifacts.filter(
    (a) => /\.(png|jpe?g)$/i.test(a?.filename || "") && !artType(a),
  );

  const metrics = normalizeMetrics(metricsText, { metricsArt, recordingArt, session });
  const firstTs = ndjson(eventsText)
    .map((e) => e.ts)
    .filter(Boolean)
    .sort()[0];
  const anchorIso =
    recordingArt?.metadata?.firstFrameAt || session.startedAt || firstTs || null;
  const timeline = normalizeTimeline(eventsText, { anchorIso });

  const counts = {
    operations: timeline.length,
    taps: timeline.filter((t) => t.kind === "tap").length,
    screenshots: timeline.filter(
      (t) => t.kind === "screenshot" && t.outcome === "success",
    ).length,
    failed: timeline.filter(
      (t) => t.outcome && t.outcome !== "success" && t.outcome !== "unknown",
    ).length,
    describes: timeline.filter((t) => t.kind === "describe").length,
  };

  const startedMs = isoMs(session.startedAt);
  const createdMs = isoMs(session.createdAt);
  const finishedMs = isoMs(session.finishedAt);

  return {
    schemaVersion: SCHEMA_VERSION,
    collectedAt,
    id: session.id ?? null,
    name: session.name ?? null,
    platform: session.platform ?? null,
    type: session.type ?? null,
    status: session.status ?? null,
    tags: Array.isArray(session.tags) ? session.tags : [],
    createdAt: session.createdAt ?? null,
    startedAt: session.startedAt ?? null,
    finishedAt: session.finishedAt ?? null,
    bootMs: startedMs != null && createdMs != null ? startedMs - createdMs : null,
    durationMs: finishedMs != null && startedMs != null ? finishedMs - startedMs : null,
    dashboardUrl: session.deviceRunSessionUrl || null,
    device: {
      name: recordingArt?.metadata?.deviceName || metricsArt?.metadata?.deviceName || null,
      udid: recordingArt?.metadata?.udid || metricsArt?.metadata?.udid || null,
      runtime: recordingArt?.metadata?.runtimeDisplayName || null,
      hostCores: num(metricsArt?.metadata?.hostCores),
    },
    recording: recordingArt
      ? {
          url: recordingArt.downloadUrl || null,
          bytes: num(recordingArt.fileSizeBytes),
          width: num(recordingArt.metadata?.width),
          height: num(recordingArt.metadata?.height),
          firstFrameAt: recordingArt.metadata?.firstFrameAt || null,
        }
      : null,
    anchorIso,
    metrics,
    timeline,
    counts,
    uploadedScreenshots: shotArts.map((a) => ({
      file: a.filename,
      bytes: num(a.fileSizeBytes),
      url: a.downloadUrl || null,
    })),
    raw: {
      metrics: metricsText ? "metrics.ndjson" : null,
      events: eventsText ? "events.ndjson" : null,
    },
    extra: extra && typeof extra === "object" ? extra : {},
  };
}

// The order the platform's screenshots were taken in: the timeline names
// each capture's artifact file, so follow it; artifacts the timeline does
// not name come after, by file name.
export function orderScreenshots(uploaded, timeline) {
  const byFile = new Map((uploaded || []).map((a) => [a.file, a]));
  const ordered = [];
  for (const t of timeline || []) {
    if (t.kind === "screenshot" && t.artifactFile && byFile.has(t.artifactFile)) {
      ordered.push(byFile.get(t.artifactFile));
      byFile.delete(t.artifactFile);
    }
  }
  const rest = [...byFile.values()].sort((a, b) => String(a.file).localeCompare(String(b.file), undefined, { numeric: true }));
  return [...ordered, ...rest];
}

export async function collectSession({
  dir: evidenceDir,
  sessionId: sessionIdOpt,
  envFile = ".env.eas-simulator",
  extra = {},
  easCliVersion = process.env.EAS_CLI_VERSION || "latest",
  maxWaitMs = 180_000,
  pollMs = 10_000,
  // Download the platform's own screenshots into the evidence dir when it
  // holds no images yet, so a run that never saved a file still gets a page.
  screenshots = false,
  log = console,
  // Injection points for tests.
  getSession = (id) => runEasSimulatorGet(id, easCliVersion),
  fetchText = async (url) => {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  },
  fetchBytes = async (url) => {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  },
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => new Date().toISOString(),
} = {}) {
  if (!evidenceDir) throw new Error("collectSession: dir is required");
  const note = (m) => log.log(`[collect] ${m}`);

  const sessionId =
    sessionIdOpt || process.env.EAS_SIMULATOR_SESSION_ID || dotenvSessionId(envFile);
  if (!sessionId) {
    note(
      "no session id (pass --session, set EAS_SIMULATOR_SESSION_ID, or keep .env.eas-simulator); skipping.",
    );
    return null;
  }

  // After simulator:stop the platform uploads the events first and the
  // performance metrics and screen recording up to a minute later (observed
  // 2026-09-21: events at +0 s, metrics and recording by +60 s). Wait for the
  // metrics too, up to maxWaitMs, then take whatever is there.
  const maxAttempts = Math.max(1, Math.ceil(maxWaitMs / pollMs));
  let session;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      session = await getSession(sessionId);
    } catch (e) {
      note(`simulator:get failed (attempt ${attempt}): ${String(e.message).split("\n")[0]}`);
    }
    const arts = Array.isArray(session?.artifacts) ? session.artifacts : [];
    const have = (t) => arts.some((a) => artType(a) === t);
    if (have("session-events") && have("performance-metrics")) break;
    if (attempt < maxAttempts) {
      note(
        `artifacts not finalized yet (${arts.length} so far, events=${have("session-events")}, metrics=${have("performance-metrics")}); waiting ${Math.round(pollMs / 1000)} s...`,
      );
      await sleep(pollMs);
    }
  }
  if (!session || typeof session !== "object") {
    note("could not read the session; skipping.");
    return null;
  }

  const outDir = join(evidenceDir, "session");
  mkdirSync(outDir, { recursive: true });

  const artifacts = Array.isArray(session.artifacts) ? session.artifacts : [];
  const download = async (artifact, filename) => {
    if (!artifact?.downloadUrl) return "";
    try {
      const text = await fetchText(artifact.downloadUrl);
      writeFileSync(join(outDir, filename), text);
      return text;
    } catch (e) {
      note(`download of ${filename} failed: ${e.message}`);
      return "";
    }
  };
  const [metricsText, eventsText] = await Promise.all([
    download(artifacts.find((a) => artType(a) === "performance-metrics"), "metrics.ndjson"),
    download(artifacts.find((a) => artType(a) === "session-events"), "events.ndjson"),
  ]);

  const out = normalizeSession({ session, eventsText, metricsText, extra, collectedAt: now() });

  if (screenshots) {
    const existing = readdirSync(evidenceDir).filter((f) => /\.(png|jpe?g)$/i.test(f));
    const ordered = orderScreenshots(out.uploadedScreenshots, out.timeline);
    if (existing.length) {
      note(`${existing.length} screenshot(s) already in ${evidenceDir}; not downloading the session's ${ordered.length}.`);
    } else if (!ordered.length) {
      note("the session has no screenshots to download.");
    } else {
      const saved = [];
      for (const [i, a] of ordered.entries()) {
        if (!a.url) continue;
        const ext = (String(a.file).match(/\.(png|jpe?g)$/i)?.[1] || "png").toLowerCase();
        const name = `${i + 1}-capture.${ext}`;
        try {
          writeFileSync(join(evidenceDir, name), await fetchBytes(a.url));
          saved.push(name);
        } catch (e) {
          note(`download of ${a.file} failed: ${e.message}`);
        }
      }
      out.downloadedScreenshots = saved;
      note(`downloaded ${saved.length} screenshot(s) from the session into ${evidenceDir}`);
    }
  }

  writeFileSync(join(outDir, "session.json"), JSON.stringify(out));
  note(
    `session ${out.id} (${out.status}): ${out.timeline.length} operations, ${out.metrics?.samples?.length ?? 0} metric samples, recording ${out.recording ? "linked" : "absent"} -> ${join(outDir, "session.json")}`,
  );
  return out;
}
