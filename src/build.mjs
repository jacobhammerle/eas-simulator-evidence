// Builds a static evidence page from an evidence dir.
//
//   buildSite({ dir, subject, verdict, ... }) -> { siteDir, images, videos, session, kind }
//
// <subject> is the page label, e.g. "PR #12" or "Issue #7". The verdict's
// leading keyword drives the status pill (see verdict.mjs):
//   PASS / NOT-REPLICATED  success (green)
//   FAIL                   danger  (red)
//   REPLICATED / CONFIRMED warning (amber: bug confirmed, not a run failure)
//   anything else          neutral (INCONCLUSIVE etc.)
//
// Inputs, all optional beyond the screenshots:
//   <evidenceDir>/*.png|jpg        screenshots, natural-sorted (capture order)
//   <evidenceDir>/*.mp4|mov        clips the agent recorded itself
//   <evidenceDir>/session/session.json  written by collect-session-evidence.mjs
//     from the EAS simulator session's own artifacts. When present the page
//     adds: run facts, a command breakdown, the action timeline (every
//     command with duration and outcome), CPU and memory charts with the
//     taps marked, the platform's full-session screen recording (linked,
//     not copied), and raw data downloads. Without it the page is the
//     verdict plus the screenshot grid.
//
// Design: tokens come from assets/colors_and_type.css, shipped next to
// index.html; every color on the page is one of its variables, so dark
// mode is the same markup with data-theme="dark" on <html>. Icons are
// Lucide, inlined at build time from assets/icons/ (no CDN at view time).
//
// Interactions: screenshot tiles and timeline "View" links open a lightbox
// (arrows page and wrap, Esc/backdrop/× close, body scroll locks); the
// theme follows the OS with a nav toggle (system / light / dark)
// remembered in localStorage. The platform's full-session recording is
// linked from Raw data, not embedded, and the per-second metrics stay in
// the charts only (no data table).
//
// FAIL state: when the verdict is FAIL (or REPLICATED) and names
// "Screenshot N", tile N gets a FAILED tag and the timeline row that
// captured it is highlighted.
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseVerdict } from "./verdict.mjs";

const assetsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");

// Pixel size of a PNG or JPEG from its header, so every tile gets the
// image's own aspect ratio (phones, tablets, landscape). null when unknown.
export function imageSize(file) {
  try {
    const fd = openSync(file, "r");
    const buf = Buffer.alloc(64 * 1024);
    const n = readSync(fd, buf, 0, buf.length, 0);
    closeSync(fd);
    const b = buf.subarray(0, n);
    const ok = (w, h) =>
      Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0
        ? { w, h }
        : null;
    if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) {
      return ok(b.readUInt32BE(16), b.readUInt32BE(20));
    }
    if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = b[i + 1];
        if (marker === 0xff) {
          i++;
          continue;
        }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
          i += 2;
          continue;
        }
        const len = b.readUInt16BE(i + 2);
        const sof =
          marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
        if (sof) return ok(b.readUInt16BE(i + 7), b.readUInt16BE(i + 5));
        i += 2 + len;
      }
    }
  } catch {}
  return null;
}

// Only http(s) links are rendered as links. Session data is untrusted
// input; a "javascript:" URL in it must not become a clickable href.
const safeUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : "");

// Files land on the site under their own names; the URL form is encoded
// so spaces, "#", "?" and unicode in a filename still resolve.
const fileUrl = (f) => `./${encodeURIComponent(f)}`;

export function buildSite({
  dir: evidenceDir,
  subject = "",
  verdict = "",
  report = "",
  url = "",
  out,
  projectName = "App",
  expoOwner = "",
  expoSlug = "",
  agentName = "Agent",
  buildId,
  lane,
  log = console,
} = {}) {
if (!evidenceDir || !existsSync(evidenceDir)) {
  throw new Error(`evidence dir not found: ${evidenceDir || "(none)"}`);
}
const siteDir = out || join(evidenceDir, "site");
mkdirSync(siteDir, { recursive: true });

// Natural sort so "1-home.png", "2-settings.png", "10-x.png" stay in
// capture order.
const files = readdirSync(evidenceDir)
  .filter((f) => /\.(png|jpg|jpeg|mp4|mov)$/i.test(f))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
for (const f of files) {
  cpSync(join(evidenceDir, f), join(siteDir, f));
}
cpSync(
  join(assetsDir, "colors_and_type.css"),
  join(siteDir, "colors_and_type.css"),
);
// Inter and JetBrains Mono, self-hosted: the stylesheet's @font-face rules point at fonts/.
cpSync(join(assetsDir, "fonts"), join(siteDir, "fonts"), { recursive: true });

// Session artifacts (optional).
let session = null;
const sessionDir = join(evidenceDir, "session");
if (existsSync(join(sessionDir, "session.json"))) {
  try {
    session = JSON.parse(
      readFileSync(join(sessionDir, "session.json"), "utf8"),
    );
    if (!session || typeof session !== "object" || Array.isArray(session)) {
      throw new Error("session.json is not an object");
    }
    // Defaults so a partial session.json (an older collector, a hand-made
    // file, a field the platform dropped) still renders what it has.
    session = {
      ...session,
      id: String(session.id || "unknown"),
      timeline: Array.isArray(session.timeline) ? session.timeline.filter((t) => t && typeof t === "object") : [],
      counts: session.counts && typeof session.counts === "object" ? session.counts : {},
      extra: session.extra && typeof session.extra === "object" ? session.extra : {},
      device: session.device && typeof session.device === "object" ? session.device : {},
      metrics: session.metrics && typeof session.metrics === "object" ? session.metrics : null,
      recording: session.recording && typeof session.recording === "object" ? session.recording : null,
    };
    mkdirSync(join(siteDir, "session"), { recursive: true });
    for (const f of readdirSync(sessionDir)) {
      if (/\.(json|ndjson)$/.test(f))
        cpSync(join(sessionDir, f), join(siteDir, "session", f));
    }
  } catch (e) {
    log.warn(
      `session.json unreadable, building screenshots-only page: ${e.message}`,
    );
    session = null;
  }
}

// ------------------------------------------------------------------ helpers
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// JSON for the page script; "<" is escaped so "</script>" can't break out.
const jsonForScript = (v) => JSON.stringify(v).replace(/</g, "\\u003c");

// "2-settings-toggle.png" -> "Settings toggle"
const caption = (f) => {
  const base = f
    .replace(/\.[^.]+$/, "")
    .replace(/^\d+[-_ ]*/, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : f;
};

// Lucide icons, inlined: 16px, stroke 1.75, currentColor.
const iconCache = new Map();
const icon = (name, cls = "") => {
  if (!iconCache.has(name)) {
    const file = join(assetsDir, "icons", `${name}.svg`);
    let body = "";
    if (existsSync(file)) {
      body = readFileSync(file, "utf8")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/^[\s\S]*?<svg[^>]*>/, "")
        .replace(/<\/svg>\s*$/, "")
        .replace(/\s+/g, " ")
        .trim();
    } else {
      log.warn(`icon missing: ${file}`);
    }
    iconCache.set(name, body);
  }
  const body = iconCache.get(name);
  if (!body) return "";
  return `<svg class="lucide${cls ? ` ${cls}` : ""}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
};

// 128000 -> "2m 08s"; 4200 -> "4s"; 312 -> "0.3s"
const fmtDur = (ms) => {
  if (ms == null || !isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms / 100) / 10}s`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
};
// 128000 -> "2:08"
const fmtClock = (ms) => {
  if (ms == null || !isFinite(ms)) return "–:––";
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const platformLabel = (p) =>
  p === "IOS" ? "iOS" : p === "ANDROID" ? "Android" : p || "—";
// "2026-09-21T16:52:47Z" -> "Sep 21, 2026 · 16:52 UTC"
const fmtWhen = (iso) => {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d)) return "";
  const date = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${date} · ${d.toISOString().slice(11, 16)} UTC`;
};

// ------------------------------------------------------------------ verdict
// verdict.mjs owns the grammar: a stacked "PASS: FAIL: ..." collapses to
// its last keyword, a failing verdict that names "Screenshot N" flags that
// tile and the timeline row that captured it.
const {
  line: v,
  kind,
  label: verdictLabel,
  detail: verdictDetail,
  flaggedScreenshot: flaggedShot,
} = parseVerdict(verdict);
const PILL = {
  pass: ["pill-pass", "circle-check"],
  fail: ["pill-fail", "circle-x"],
  replicated: ["pill-warn", "triangle-alert"],
  neutral: ["pill-neutral", "circle-help"],
}[kind];
const flagTag = kind === "replicated" ? "REPLICATED" : "FAILED";

const sectionHead = (title, count, hint = "") =>
  `<div class="sec-head"><h2>${title}</h2>${count ? `<span class="count">${count}</span>` : ""}${hint ? `<span class="hint">${hint}</span>` : ""}</div>`;

// ------------------------------------------------------------------- media
const images = files.filter((f) => /\.(png|jpg|jpeg)$/i.test(f));
const videos = files.filter((f) => /\.(mp4|mov)$/i.test(f));

// The tap that led to each screenshot: the last tap before the capture,
// when the controller reported it as a fraction of the screen. Points
// (agent-device) need the device's point size, which the session does
// not carry, so those get no marker.
const tapForShot = new Map();
if (session) {
  const frac = (n) => typeof n === "number" && n >= 0 && n <= 1;
  let lastTap = null;
  for (const t of session.timeline) {
    if (t.kind === "tap") lastTap = t.xyUnit === "fraction" && frac(t.x) && frac(t.y) ? { x: t.x, y: t.y } : null;
    else if (t.kind === "screenshot" && Number.isInteger(t.screenshotIndex)) {
      if (lastTap) tapForShot.set(t.screenshotIndex, lastTap);
      lastTap = null;
    }
  }
}
const pct = (f) => `${(f * 100).toFixed(1)}%`;
const tapMark = (tap, cls = "") =>
  tap ? `<span class="tap-mark${cls ? ` ${cls}` : ""}" style="left:${pct(tap.x)};top:${pct(tap.y)}" title="The tap before this screenshot"></span>` : "";

const shots = images.map((f, i) => ({
  n: i + 1,
  src: fileUrl(f),
  label: caption(f),
  flagged: flaggedShot === i + 1,
  size: imageSize(join(evidenceDir, f)),
  tap: tapForShot.get(i) || null,
}));

const shotsHtml = shots
  .map(
    (
      s,
    ) => `<button type="button" class="shot${s.size && s.size.w > s.size.h ? " wide" : ""}" id="shot-${s.n}" data-index="${s.n - 1}" aria-label="Screenshot ${s.n}: ${esc(s.label)}">
  <span class="shot-frame"${s.size ? ` style="aspect-ratio: ${s.size.w} / ${s.size.h}"` : ""}><img src="${esc(s.src)}" alt="${esc(s.label)}" loading="lazy">${tapMark(s.tap)}${s.flagged ? `<span class="shot-tag">${flagTag}</span>` : ""}</span>
  <span class="shot-cap"><span class="shot-n">${s.n}</span><span class="shot-label">${esc(s.label)}</span></span>
</button>`,
  )
  .join("\n");

// Session health: say so above the verdict when the run did not end cleanly.
let healthHtml = "";
if (session) {
  const st = String(session.status || "").toUpperCase();
  const banner = (cls, text) => `<div class="banner banner-${cls}" role="status">${icon("triangle-alert")}<span>${text}</span></div>`;
  if (st === "ERRORED") healthHtml = banner("danger", "The simulator session ended with an error. The run may be incomplete.");
  else if (st === "IN_PROGRESS" || st === "NEW") healthHtml = banner("warn", "The session was still running when this data was collected. Later commands, metrics, and the recording are missing.");
}

// Where the page will live, for the link-preview tags. Only http(s).
const siteUrl = safeUrl(url).replace(/\/+$/, "");

// The agent's written report, when there is one: plain text, kept as
// typed, folded when long.
const reportText = String(report ?? "").replace(/\r\n?/g, "\n").trim();
let reportHtml = "";
if (reportText) {
  const lines = reportText.split("\n").length;
  const long = reportText.length > 1500 || lines > 18;
  reportHtml = `<section id="report">
  ${sectionHead("Agent report", `${lines} ${lines === 1 ? "line" : "lines"}`)}
  <div class="card report-card${long ? " report-collapsed" : ""}" id="report-card">
    <pre class="report">${esc(reportText)}</pre>
    ${long ? `<div class="report-fade"><button type="button" class="btn" id="report-more">Show the full report</button></div>` : ""}
  </div>
</section>`;
}

// A verdict sentence can be five words or a paragraph. The headline
// steps down in size so a long one still reads as a headline.
const h1Class =
  verdictDetail.length > 400
    ? " h1-xlong"
    : verdictDetail.length > 160
      ? " h1-long"
      : "";

// ---------------------------------------------------------------- session
// Timeline kinds (collect-session-evidence.mjs) -> label and Lucide icon.
const KIND_META = {
  tap: ["Taps", "pointer"],
  type: ["Typing", "keyboard"],
  swipe: ["Swipes", "move"],
  open: ["App launches", "play"],
  describe: ["Screen reads", "scan-text"],
  screenshot: ["Screenshots", "camera"],
  wait: ["Waits", "hourglass"],
  alert: ["Alerts", "circle-alert"],
  recording: ["Recording", "video"],
  other: ["Other", "terminal"],
};
// The tool name is more specific than the kind when it has its own icon.
const TOOL_ICON = {
  "list-devices": "smartphone",
  apps: "smartphone",
  "boot-device": "smartphone",
};
const kindOf = (t) => (KIND_META[t.kind] ? t.kind : "other");
const iconFor = (t) => TOOL_ICON[t.tool] || KIND_META[kindOf(t)][1];
// Timeline rows shown before the "Show all" fold. Mirrored in the CSS.
const TIMELINE_FOLD = 40;


let factsHtml = "";
let breakdownHtml = "";
let timelineHtml = "";
let perfHtml = "";
let recordingHtml = "";
let rawHtml = "";
let sessionLink = "";
let launchHtml = "";
let deviceParen = "";
const startedIso = String(session?.startedAt || session?.createdAt || "");
// An unparseable timestamp falls back to the build time.
const startedLabel = fmtWhen(startedIso || undefined) || fmtWhen();
const isEmulator = session?.platform === "ANDROID";

if (session) {
  // Facts passed at build time win over the ones stored at collect time.
  const x = {
    ...(session.extra || {}),
    ...(buildId ? { build_id: buildId } : {}),
    ...(lane ? { lane } : {}),
  };
  const deviceName =
    [session.device?.name, session.device?.runtime]
      .filter(Boolean)
      .join(" · ") || platformLabel(session.platform);
  deviceParen = session.device?.name ? ` (${esc(session.device.name)})` : "";
  const facts = [
    ["Device", deviceName],
    ["Session", fmtDur(session.durationMs), "num"],
    ["Boot to ready", fmtDur(session.bootMs), "num"],
    [
      "Commands",
      session.counts.operations != null
        ? String(session.counts.operations)
        : String(session.timeline.length || "—"),
      "num",
    ],
    ["Controller", session.type || "—"],
  ];
  if (x.build_id) facts.push(["Build", String(x.build_id).slice(0, 8), "mono"]);
  if (x.lane) facts.push(["Lane", String(x.lane)]);
  if (x.metrics) facts.push(["Lane timing", String(x.metrics)]);
  if (session.counts.failed)
    facts.push(["Failed commands", String(session.counts.failed), "num"]);
  factsHtml = `<div class="facts">
${facts.map(([k, val, cls]) => `  <div class="fact${String(val).length > 24 ? " fact-wide" : ""}"><span class="fact-k">${esc(k)}</span><span class="fact-v${cls ? ` ${cls}` : ""}">${esc(val)}</span></div>`).join("\n")}
</div>`;
  if (safeUrl(session.dashboardUrl)) {
    sessionLink = ` <a href="${esc(session.dashboardUrl)}" target="_blank" rel="noopener">Session on expo.dev ↗</a>`;
  }

  // "Try this build": an expo.dev create-session link starts a fresh
  // browser-preview simulator session with the same EAS build the agent
  // ran (docs.expo.dev/preview/eas-simulator/create-session-links). It
  // needs the full build id; the facts strip shows only a prefix. Every
  // open starts a new billable session, so the note says so. Links cannot
  // set a duration, so the name carries a marker suffix ("evidence-site
  // preview") that a cleanup job can match to stop these sessions.
  if (expoOwner && expoSlug && /^[0-9a-f-]{20,}$/i.test(String(x.build_id || ""))) {
    const createUrl = new URL(
      `https://expo.dev/accounts/${expoOwner}/projects/${expoSlug}/simulator-sessions/create`,
    );
    createUrl.searchParams.set("buildId", x.build_id);
    createUrl.searchParams.set(
      "name",
      `${subject} · evidence-site preview`.slice(0, 255),
    );
    launchHtml = `<div class="launch-row">
      <a class="btn" href="${esc(createUrl.toString())}" target="_blank" rel="noopener" title="Starts a new EAS Simulator session with this build">${icon("smartphone")}Try this build on a simulator${icon("external-link")}</a>
      <span class="launch-note">Starts a new browser-preview session on expo.dev that stops by itself within 30 minutes. Sign in with an Expo account that can access this project.</span>
    </div>`;
  }

  // Command breakdown: what the agent spent its device commands on.
  const tl = session.timeline;
  if (tl.length) {
    const per = {};
    for (const t of tl) {
      const k = kindOf(t);
      per[k] = (per[k] || 0) + 1;
    }
    const order = ["tap", "type", "swipe", "open", "describe", "screenshot"];
    const other = Object.keys(per)
      .filter((k) => !order.includes(k))
      .reduce((n, k) => n + per[k], 0);
    const chips = order
      .filter((k) => per[k])
      .map(
        (k) =>
          `<span class="chip">${icon(KIND_META[k][1])}${esc(KIND_META[k][0])} <strong>${per[k]}</strong></span>`,
      );
    if (other)
      chips.push(
        `<span class="chip">${icon("terminal")}Other <strong>${other}</strong></span>`,
      );
    const total = session.counts.operations ?? tl.length;
    breakdownHtml = `<div class="breakdown" aria-label="Device command breakdown">
  ${chips.join("\n  ")}
  <span class="breakdown-total">${total} device commands</span>
</div>`;
  }

  // Timeline.
  const anchorParsed = session.anchorIso ? Date.parse(session.anchorIso) : NaN;
  const anchorMs = Number.isFinite(anchorParsed) ? anchorParsed : null;
  const rows = tl.map((t) => {
    const tsMs = t.ts ? Date.parse(t.ts) : NaN;
    const off =
      anchorMs != null && Number.isFinite(tsMs) ? tsMs - anchorMs : t.offsetMs;
    const failedCmd =
      t.outcome && t.outcome !== "success" && t.outcome !== "unknown";
    const shotIdx =
      t.kind === "screenshot" &&
      Number.isInteger(t.screenshotIndex) &&
      t.screenshotIndex >= 0 &&
      images[t.screenshotIndex]
        ? t.screenshotIndex
        : null;
    const flagged = flaggedShot != null && shotIdx === flaggedShot - 1;
    // A screenshot row is captioned by the image it produced, not the
    // controller's artifact filename.
    const label =
      shotIdx != null
        ? `Screenshot ${shotIdx + 1} · ${caption(images[shotIdx])}`
        : t.label;
    return `  <li class="tl-row${flagged ? " flagged" : ""}">
    <span class="tl-time">${fmtClock(off)}</span>
    <span class="tl-icon">${icon(iconFor(t))}</span>
    <span class="tl-body">
      <span class="tl-label">${esc(label || t.tool || t.kind || "operation")}</span>${Number(t.repeat) > 1 ? `<span class="tl-rep">×${Number(t.repeat)}</span>` : ""}
      <code class="kind">${esc(t.tool || t.kind || "other")}</code>
      ${shotIdx != null ? `<button type="button" class="tl-view" data-index="${shotIdx}"><img src="${esc(fileUrl(images[shotIdx]))}" alt="" loading="lazy">View</button>` : ""}
      ${flagged ? `<span class="tl-note">${icon("triangle-alert")}Named in the verdict</span>` : ""}
      ${failedCmd ? `<span class="tl-note">${icon("triangle-alert")}Command ${t.outcome === "failure" ? "failed" : esc(t.outcome)}</span>` : ""}
    </span>
    <span class="tl-dur">${esc(fmtDur(t.durationMs))}</span>
  </li>`;
  });
  if (rows.length) {
    const fromLabel =
      session.anchorIso && session.recording?.firstFrameAt
        ? "the first recorded frame"
        : "session start";
    // A long run is hundreds of rows. Show the first 40 and fold the rest.
    const folded = rows.length > TIMELINE_FOLD;
    timelineHtml = `<section id="timeline">
  <div class="sec-intro">
    ${sectionHead("What the agent did", `${rows.length} steps`)}
    <p class="lede-sm">Every device command the controller recorded, in order. Times count from ${fromLabel}.</p>
  </div>
  <ol class="tl${folded ? " tl-folded" : ""}" id="tl">
${rows.join("\n")}
  </ol>
  ${folded ? `<div class="tl-more-row"><button type="button" class="btn" id="tl-more">Show all ${rows.length} steps</button></div>` : ""}
</section>`;
  }

  // Performance: stat cards, two static SVG charts, data table.
  const m = session.metrics;
  const num = (v) => typeof v === "number" && Number.isFinite(v);
  const samples = Array.isArray(m?.samples)
    ? m.samples.filter((r) => r && num(r.t) && r.t >= 0)
    : [];
  if (m && samples.length && m.summary && typeof m.summary === "object") {
    const s = m.summary;
    const maxT = Math.max(...samples.map((r) => r.t), 1);
    const cpuPts = samples.filter((r) => num(r.cpu)).map((r) => [r.t, r.cpu]);
    const memPts = samples
      .filter((r) => num(r.memMB))
      .map((r) => [r.t, r.memMB]);
    const cpuHi = Math.max(1, ...cpuPts.map((p) => p[1]));
    const mems = memPts.map((p) => p[1]);
    let memLo = mems.length ? Math.floor(Math.min(...mems) / 10) * 10 : 0;
    let memHi = mems.length ? Math.ceil(Math.max(...mems) / 10) * 10 : 10;
    if (memHi <= memLo) memHi = memLo + 10;
    // viewBox 0 0 1000 120, stretched with preserveAspectRatio="none";
    // strokes keep their width via vector-effect.
    const path = (pts, lo, hi, area) => {
      if (!pts.length) return "";
      const xy = pts.map(([t, val]) => [
        ((t / maxT) * 1000).toFixed(1),
        (120 - ((val - lo) / (hi - lo)) * 110).toFixed(1),
      ]);
      let d = xy.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");
      if (area) d += ` L${xy[xy.length - 1][0]},120 L${xy[0][0]},120 Z`;
      return d;
    };
    const t0Parsed = m.t0Iso ? Date.parse(m.t0Iso) : NaN;
    const t0 = Number.isFinite(t0Parsed) ? t0Parsed : null;
    const tapMarks =
      t0 == null
        ? []
        : tl
            .filter((t) => t.kind === "tap" && t.ts)
            .map((t) => (Date.parse(t.ts) - t0) / maxT)
            .filter((f) => Number.isFinite(f) && f >= 0 && f <= 1)
            .map((f) => (f * 1000).toFixed(1));
    const hairlines = tapMarks
      .map(
        (xp) =>
          `<line x1="${xp}" y1="0" x2="${xp}" y2="120" stroke="var(--brand-pink)" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"></line>`,
      )
      .join("");
    // Time axis: clock-friendly steps, the run's length as the last label.
    const maxS = maxT / 1000;
    const step =
      [15, 30, 60, 120, 300, 600, 900, 1800, 3600].find(
        (st) => maxS / st <= 5,
      ) || 3600;
    const ticks = [];
    for (let sec = 0; sec < maxS; sec += step) {
      const f = sec / maxS;
      if (f > 0.9) break;
      ticks.push([f, fmtClock(sec * 1000)]);
    }
    ticks.push([1, fmtClock(maxT)]);
    const axis = `<div class="axis">${ticks
      .map(
        ([f, label], i) =>
          `<span class="${i === 0 ? "first" : i === ticks.length - 1 ? "last" : ""}" style="left:${(f * 100).toFixed(2)}%">${label}</span>`,
      )
      .join("")}</div>`;
    const chart = (title, right, color, line, area, extra = "") => `<div class="chart">
      <div class="chart-head"><span class="chart-title">${title}</span><span class="chart-right">${right}</span></div>
      <div class="chart-box">
        <svg viewBox="0 0 1000 120" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" y1="60" x2="1000" y2="60" stroke="var(--border-subtle)" stroke-width="1" vector-effect="non-scaling-stroke"></line>
          ${hairlines}
          <path d="${area}" fill="var(--${color})" fill-opacity="0.12"></path>
          <path d="${line}" fill="none" stroke="var(--${color})" stroke-width="1.5" vector-effect="non-scaling-stroke"></path>
          ${extra}
        </svg>
      </div>
      ${axis}
    </div>`;
    // Network: bytes in as an area, bytes out as a line, both in KB/s.
    // Shown only when the app moved any traffic at all.
    const netIn = samples.filter((r) => num(r.netIn)).map((r) => [r.t, r.netIn / 1024]);
    const netOut = samples.filter((r) => num(r.netOut)).map((r) => [r.t, r.netOut / 1024]);
    const netHi = Math.max(...netIn.map((p) => p[1]), ...netOut.map((p) => p[1]), 0);
    const fmtKB = (n) => (n >= 1024 ? `${(n / 1024).toFixed(1)} MB/s` : `${n.toFixed(n < 10 ? 1 : 0)} KB/s`);
    const netHtml =
      netHi > 0
        ? chart(
            "Network, KB/s · in (filled) and out (line)",
            `peak ${fmtKB(netHi)}`,
            "brand-pink",
            path(netIn, 0, netHi, false),
            path(netIn, 0, netHi, true),
            `<path d="${path(netOut, 0, netHi, false)}" fill="none" stroke="var(--brand-orange)" stroke-width="1.5" vector-effect="non-scaling-stroke"></path>`,
          )
        : "";
    const stat = (label, value, sub) =>
      `<div class="stat"><span class="stat-k">${label}</span><span class="stat-v">${value}</span><span class="stat-sub">${sub}</span></div>`;
    const fmtPct = (n) => (num(n) ? `${n.toFixed(1)}%` : "—");
    const fmtMB = (n) => (num(n) ? `${Math.round(n)} MB` : "—");
    const intervalS = (num(m.sampleIntervalMs) ? m.sampleIntervalMs : 1000) / 1000;
    perfHtml = `<section id="performance">
  ${sectionHead("App performance", `${samples.length} samples`)}
  <div class="stats">
    ${stat("Peak CPU", fmtPct(s.cpuMax), "of one core")}
    ${stat("Average CPU", fmtPct(s.cpuAvg), "while the app ran")}
    ${stat("Peak memory", fmtMB(s.memMaxMB), "resident")}
    ${stat("Average memory", fmtMB(s.memAvgMB), "resident")}
  </div>
  <div class="card charts">
    ${chart(`CPU, % of one core, sampled every ${intervalS} s`, `peak ${fmtPct(s.cpuMax)}`, "brand-blue", path(cpuPts, 0, cpuHi, false), path(cpuPts, 0, cpuHi, true))}
    ${chart("Memory, MB resident", mems.length ? `${Math.round(Math.min(...mems))}–${Math.round(Math.max(...mems))} MB` : "—", "brand-green", path(memPts, memLo, memHi, false), path(memPts, memLo, memHi, true))}
    ${netHtml}
    <p class="chart-note"><span class="hairline-key"></span>Hairlines mark the agent's taps. Sample times are aligned to ${m.t0Source === "recording" ? "the first recorded frame" : "session start"}, so the alignment is approximate to about a second.</p>
  </div>
</section>`;
  }

  // Raw data.
  const rawCards = [
    ["./session/session.json", "file-json", "session.json", false],
  ];
  if (session.raw?.metrics)
    rawCards.push([
      "./session/metrics.ndjson",
      "activity",
      "metrics.ndjson",
      false,
    ]);
  if (session.raw?.events)
    rawCards.push(["./session/events.ndjson", "list", "events.ndjson", false]);
  if (safeUrl(session.recording?.url))
    rawCards.push([session.recording.url, "video", "recording.mp4 ↗", true]);
  rawHtml = `<section id="data">
  ${sectionHead("Raw data", `<code class="kind">session ${esc(session.id.slice(0, 8))}</code>`)}
  <div class="raw">
    ${rawCards.map(([href, ic, label, ext]) => `<a class="raw-card" href="${esc(href)}" target="_blank"${ext ? ' rel="noopener"' : ""}>${icon(ic, "raw-icon")}<span>${esc(label)}</span></a>`).join("\n    ")}
  </div>
</section>`;
}

// Recording: only clips the agent recorded itself. The platform's
// full-session video is linked from Raw data, not embedded.
if (videos.length) {
  const blocks = videos.map(
    (f) => `<div class="rec-grid">
    <div class="rec-frame"><video controls muted playsinline preload="metadata" src="${esc(fileUrl(f))}"></video></div>
    <div class="rec-meta">
      <p>Recorded by the agent · ${esc(caption(f))}</p>
      <div class="btn-row"><a class="btn" href="${esc(fileUrl(f))}" target="_blank">${icon("download")}Download ${esc(f)}</a></div>
    </div>
  </div>`,
  );
  recordingHtml = `<section id="recording">
  ${sectionHead("Agent recording", String(videos.length))}
  ${blocks.join("\n  ")}
</section>`;
}

const navLinks = [
  reportHtml && ["#report", "Report"],
  images.length && ["#screenshots", "Screenshots"],
  timelineHtml && ["#timeline", "Timeline"],
  perfHtml && ["#performance", "Performance"],
  recordingHtml && ["#recording", "Recording"],
  rawHtml && ["#data", "Data"],
]
  .filter(Boolean)
  .map(([href, label]) => `<a href="${href}">${label}</a>`)
  .join("\n      ");

const generatedLabel = fmtWhen();
const shotsJson = jsonForScript(
  shots.map((s) => ({ src: s.src, label: s.label, tap: s.tap })),
);

// Link previews: the verdict as the description, the first screenshot as
// the image when the page's own URL is known (og:image must be absolute).
const pageTitle = `${projectName} · ${subject}`;
const ogImage = siteUrl && images.length ? `${siteUrl}/${encodeURIComponent(images[0])}` : "";
const metaHtml = [
  `<meta name="description" content="${esc(v)}">`,
  `<meta property="og:type" content="website">`,
  `<meta property="og:title" content="${esc(pageTitle)}">`,
  `<meta property="og:description" content="${esc(v)}">`,
  siteUrl && `<meta property="og:url" content="${esc(siteUrl + "/")}">`,
  siteUrl && `<link rel="canonical" href="${esc(siteUrl + "/")}">`,
  ogImage && `<meta property="og:image" content="${esc(ogImage)}">`,
  `<meta name="twitter:card" content="${ogImage ? "summary_large_image" : "summary"}">`,
]
  .filter(Boolean)
  .join("\n");

// A small manifest next to the page, for tooling (the index command, a
// bot) that needs the result without parsing HTML.
const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  subject,
  verdict: v,
  kind,
  projectName,
  agentName,
  url: siteUrl || null,
  buildId: buildId || session?.extra?.build_id || null,
  images,
  firstImage: images[0] || null,
  videos,
  report: reportText.length,
  session: session
    ? {
        id: session.id,
        platform: session.platform ?? null,
        status: session.status ?? null,
        device: session.device?.name ?? null,
        runtime: session.device?.runtime ?? null,
        durationMs: session.durationMs ?? null,
        bootMs: session.bootMs ?? null,
        counts: session.counts,
        dashboardUrl: safeUrl(session.dashboardUrl) || null,
      }
    : null,
};
writeFileSync(join(siteDir, "evidence.json"), JSON.stringify(manifest, null, 2) + "\n");

// -------------------------------------------------------------------- page
writeFileSync(
  join(siteDir, "index.html"),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pageTitle)} verification</title>
${metaHtml}
<script>
// Theme before first paint: the stylesheet keys on data-theme. The nav
// toggle stores system | light | dark; system follows the OS.
(function () {
  var pref = 'system';
  try { pref = localStorage.getItem('evidence-theme') || 'system'; } catch (e) {}
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme-pref', pref);
})();
</script>
<link rel="stylesheet" href="./colors_and_type.css">
<style>
  /* Layout and component styles; every color is a token from
     colors_and_type.css. Values mirror the design reference. */
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  html[data-theme="dark"] { color-scheme: dark; }
  html[data-theme="light"] { color-scheme: light; }
  html, body { margin: 0; background: var(--bg-subtle); color: var(--fg-default); font-family: var(--font-sans); }
  body { font-size: 14px; line-height: 1.4; min-height: 100vh; overflow-x: hidden; -webkit-text-size-adjust: 100%; }
  /* Any text the run produced can be one unbroken token (a URL, an id,
     a bundle name). Nothing on the page is allowed to widen the layout. */
  h1, h2, p, span, a, code, pre, li, button, .fact-v, .tl-label, .stat-v { overflow-wrap: anywhere; min-width: 0; }
  img, video, svg { max-width: 100%; }
  a { color: var(--fg-link); text-decoration: none; }
  a:hover { text-decoration: underline; }
  button { font: inherit; color: inherit; }
  p { margin: 0; font-size: inherit; color: inherit; line-height: inherit; }
  svg.lucide { display: inline-block; width: 16px; height: 16px; flex-shrink: 0; }
  .num { font-variant-numeric: tabular-nums; }
  .mono { font-family: var(--font-mono); }
  code.kind { font-size: 11px; padding: 1px 6px; line-height: 1.5; color: var(--fg-secondary); background: var(--code-bg); border: 1px solid var(--code-border); border-radius: var(--radius-sm); }
  :focus-visible { outline: none; box-shadow: var(--shadow-focus); }

  /* Sticky nav */
  .nav { position: sticky; top: 0; z-index: 20; background: color-mix(in srgb, var(--bg-default) 80%, transparent); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border-bottom: 1px solid var(--border-default); }
  .nav-inner { max-width: 1040px; margin: 0 auto; padding: 0 24px; height: 56px; display: flex; align-items: center; gap: 16px; }
  .brand { display: flex; align-items: center; gap: 10px; color: var(--fg-default); font-weight: 600; min-width: 0; flex: 1 1 auto; }
  .brand:hover { text-decoration: none; }
  .brand-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto; min-width: 48px; }
  .brand-sep { color: var(--fg-tertiary); font-weight: 400; flex-shrink: 0; }
  .brand-subject { font-family: var(--font-mono); font-size: 13px; font-weight: 500; color: var(--fg-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1 1 auto; }
  .nav-right { margin-left: auto; display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
  .nav-links { display: flex; gap: 4px; font-size: 13px; font-weight: 500; }
  .nav-links a, .theme-btn { color: var(--fg-secondary); padding: 6px 10px; border-radius: 6px; }
  .nav-links a:hover, .theme-btn:hover { background: var(--bg-hover); color: var(--fg-default); text-decoration: none; }
  .theme-btn { all: unset; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 6px; color: var(--fg-secondary); }
  .theme-btn svg { display: none; }
  html[data-theme-pref="system"] .theme-btn .ic-system, html[data-theme-pref="light"] .theme-btn .ic-light, html[data-theme-pref="dark"] .theme-btn .ic-dark { display: inline-block; }

  /* Page */
  main { max-width: 1040px; margin: 0 auto; padding: 48px 24px 64px; display: flex; flex-direction: column; gap: 64px; }
  section { display: flex; flex-direction: column; gap: 20px; scroll-margin-top: 72px; min-width: 0; }
  section.verdict { gap: 24px; }
  .sec-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .sec-intro { display: flex; flex-direction: column; gap: 6px; }
  h1 { margin: 0; flex: 1 1 480px; min-width: 0; font-size: 28px; line-height: 1.3; letter-spacing: -0.02em; font-weight: 600; color: var(--fg-display); text-wrap: pretty; }
  h1.h1-long { font-size: 22px; line-height: 1.35; letter-spacing: -0.01em; }
  h1.h1-xlong { font-size: 17px; line-height: 1.5; letter-spacing: 0; font-weight: 500; }
  h2 { margin: 0; font-size: 20px; line-height: 1.4; font-weight: 600; letter-spacing: -0.0125em; color: var(--fg-display); }
  .count { font-size: 13px; color: var(--fg-tertiary); font-variant-numeric: tabular-nums; }
  .hint { margin-left: auto; font-size: 13px; color: var(--fg-tertiary); }
  .card { border: 1px solid var(--border-default); border-radius: 12px; background: var(--bg-default); box-shadow: var(--shadow-micro); }
  .lede { max-width: 720px; font-size: 15px; color: var(--fg-secondary); text-wrap: pretty; }
  .lede-sm { max-width: 720px; font-size: 14px; color: var(--fg-secondary); text-wrap: pretty; }

  /* Verdict */
  .run-eyebrow { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 13px; color: var(--fg-tertiary); }
  .run-eyebrow-bot { display: inline-flex; align-items: center; gap: 6px; color: var(--fg-secondary); font-weight: 500; }
  .verdict-row { display: flex; align-items: flex-start; gap: 20px; flex-wrap: wrap; min-width: 0; }
  .launch-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .launch-note { font-size: 12px; color: var(--fg-tertiary); max-width: 480px; text-wrap: pretty; }
  .pill { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px 6px 10px; border-radius: 9999px; font-weight: 600; font-size: 13px; letter-spacing: 0.04em; font-family: var(--font-mono); flex-shrink: 0; margin-top: 6px; }
  .pill-pass { background: var(--status-success-bg); color: var(--status-success-fg); }
  .pill-fail { background: var(--status-danger-bg); color: var(--status-danger-fg); }
  .pill-warn { background: var(--status-warning-bg); color: var(--status-warning-fg); }
  .pill-neutral { background: var(--bg-element); color: var(--fg-secondary); }
  /* Flex, not grid: a wrapped last row stretches to the full width instead
     of leaving an empty cell. */
  .facts { display: flex; flex-wrap: wrap; border: 1px solid var(--border-default); border-radius: 12px; background: var(--bg-default); overflow: hidden; box-shadow: var(--shadow-micro); }
  /* Cell dividers as shadows: they also separate rows when the grid wraps. */
  .fact { flex: 1 1 140px; padding: 16px 20px; display: flex; flex-direction: column; gap: 4px; min-width: 0; box-shadow: 1px 0 0 var(--border-subtle), 0 1px 0 var(--border-subtle); }
  .fact.fact-wide { flex-basis: 220px; flex-grow: 2; }
  .fact-k { font-size: 12px; color: var(--fg-tertiary); }
  .fact-v { font-weight: 500; overflow-wrap: anywhere; }
  .fact-v.mono { font-family: var(--font-mono); font-size: 13px; }
  .breakdown { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; font-size: 13px; color: var(--fg-secondary); }
  .chip { display: inline-flex; align-items: center; gap: 6px; }
  .chip strong { color: var(--fg-default); font-weight: 600; font-variant-numeric: tabular-nums; }
  .breakdown-total { margin-left: auto; color: var(--fg-tertiary); }

  /* Screenshots */
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 16px; }
  /* A landscape capture (tablet, rotated phone) takes two columns. */
  .shot.wide { grid-column: span 2; }
  .shot { all: unset; cursor: zoom-in; display: flex; flex-direction: column; gap: 10px; border-radius: 12px; outline-offset: 3px; }
  .shot:focus-visible { box-shadow: var(--shadow-focus); }
  .shot-frame { aspect-ratio: 1206 / 2622; width: 100%; border-radius: 12px; overflow: hidden; border: 1px solid var(--border-default); background: var(--bg-element); box-shadow: var(--shadow-micro); position: relative; display: block; }
  .shot:hover .shot-frame { border-color: var(--border-strong); }
  .shot-frame img { width: 100%; height: 100%; object-fit: cover; display: block; }
  /* The tap that led to a screenshot, as a ring at the reported spot. */
  .tap-mark { position: absolute; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%; border: 2px solid var(--brand-pink); background: color-mix(in srgb, var(--brand-pink) 28%, transparent); box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.35), 0 0 0 6px color-mix(in srgb, var(--brand-pink) 18%, transparent); pointer-events: none; }
  .tap-mark[hidden] { display: none; }
  .banner { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; border-radius: 10px; font-size: 13px; font-weight: 500; max-width: 720px; }
  .banner svg { margin-top: 1px; }
  .banner-danger { background: var(--status-danger-bg); color: var(--status-danger-fg); }
  .banner-warn { background: var(--status-warning-bg); color: var(--status-warning-fg); }
  .shot-tag { position: absolute; top: 8px; left: 8px; padding: 2px 6px; border-radius: 4px; background: var(--brand-red); color: #fff; font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: 0.04em; }
  .shot-cap { display: flex; gap: 8px; align-items: baseline; font-size: 13px; padding: 0 2px; }
  .shot-n { font-family: var(--font-mono); color: var(--fg-tertiary); font-size: 12px; flex-shrink: 0; }
  .shot-label { color: var(--fg-default); font-weight: 500; text-wrap: pretty; }

  /* Timeline */
  .tl { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border-default); border-radius: 12px; background: var(--bg-default); box-shadow: var(--shadow-micro); overflow: hidden; }
  .tl-row { display: grid; grid-template-columns: 56px 28px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 10px 16px; border-top: 1px solid var(--border-subtle); position: relative; }
  .tl-row:first-child { border-top: 0; }
  .tl-row:hover { background: var(--bg-subtle); }
  .tl-row.flagged, .tl-row.flagged:hover { background: var(--status-danger-bg); }
  .tl-time { font-family: var(--font-mono); font-size: 12px; color: var(--fg-tertiary); font-variant-numeric: tabular-nums; padding: 2px 0; }
  .tl-icon { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 6px; background: var(--bg-element); color: var(--icon-default); }
  .tl-body { display: flex; align-items: center; gap: 10px; min-width: 0; flex-wrap: wrap; }
  .tl-label { font-weight: 500; color: var(--fg-default); overflow-wrap: anywhere; }
  .tl-rep { font-family: var(--font-mono); font-size: 12px; color: var(--fg-tertiary); }
  .tl-view { all: unset; cursor: zoom-in; display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--fg-link); }
  .tl-view:hover { text-decoration: underline; }
  .tl-view:focus-visible { box-shadow: var(--shadow-focus); border-radius: 4px; }
  .tl-view img { width: 20px; height: 36px; object-fit: cover; border-radius: 3px; border: 1px solid var(--border-default); display: block; }
  .tl-note { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 500; color: var(--status-danger-fg); }
  .tl-dur { font-family: var(--font-mono); font-size: 12px; color: var(--fg-tertiary); font-variant-numeric: tabular-nums; }
  .tl.tl-folded > li:nth-child(n + 41) { display: none; }
  .tl-more-row { display: flex; justify-content: center; }

  /* Agent report */
  .report-card { position: relative; overflow: hidden; }
  .report { margin: 0; padding: 20px 24px; font-family: var(--font-sans); font-size: 14px; line-height: 1.6; white-space: pre-wrap; color: var(--fg-default); }
  .report-collapsed .report { max-height: 320px; overflow: hidden; }
  .report-fade { position: absolute; left: 0; right: 0; bottom: 0; padding: 56px 0 20px; display: flex; justify-content: center; background: linear-gradient(to bottom, transparent, var(--bg-default) 60%); }

  /* Performance */
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; }
  .stat { padding: 16px 20px; border: 1px solid var(--border-default); border-radius: 12px; background: var(--bg-default); box-shadow: var(--shadow-micro); display: flex; flex-direction: column; gap: 2px; }
  .stat-k { font-size: 12px; color: var(--fg-tertiary); }
  .stat-v { font-size: 24px; font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; color: var(--fg-display); }
  .stat-sub { font-size: 12px; color: var(--fg-secondary); }
  .charts { padding: 20px; display: flex; flex-direction: column; gap: 24px; }
  .chart { display: flex; flex-direction: column; gap: 8px; }
  .chart-head { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; color: var(--fg-tertiary); }
  .chart-title { font-weight: 500; color: var(--fg-secondary); }
  .chart-right { font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .chart-box { position: relative; height: 120px; border-bottom: 1px solid var(--border-default); }
  .chart-box svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; overflow: visible; }
  .axis { position: relative; height: 14px; font-family: var(--font-mono); font-size: 11px; line-height: 14px; color: var(--fg-tertiary); font-variant-numeric: tabular-nums; }
  .axis span { position: absolute; top: 0; transform: translateX(-50%); white-space: nowrap; }
  .axis span.first { transform: none; }
  .axis span.last { transform: translateX(-100%); }
  .chart-note { font-size: 12px; color: var(--fg-tertiary); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .hairline-key { display: inline-block; width: 14px; border-top: 1px dashed var(--brand-pink); }

  /* Agent recording */
  .rec-grid { display: grid; grid-template-columns: minmax(0, 320px) minmax(0, 1fr); gap: 32px; align-items: start; }
  .rec-frame { border-radius: 12px; overflow: hidden; border: 1px solid var(--border-default); background: #000; aspect-ratio: 1206 / 2622; box-shadow: var(--shadow-tiny); }
  .rec-frame video { width: 100%; height: 100%; display: block; object-fit: contain; background: #000; }
  .rec-meta { display: flex; flex-direction: column; gap: 12px; font-size: 14px; color: var(--fg-secondary); padding-top: 4px; }
  .rec-meta p { text-wrap: pretty; }
  .btn-row { display: flex; gap: 8px; flex-wrap: wrap; }
  .btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 6px; border: 1px solid var(--border-default); background: var(--bg-default); color: var(--fg-default); font-weight: 500; font-size: 13px; box-shadow: var(--shadow-button); }
  .btn:hover { background: var(--bg-hover); text-decoration: none; }

  /* Raw data */
  .raw { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
  .raw-card { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border: 1px solid var(--border-default); border-radius: 8px; background: var(--bg-default); color: var(--fg-default); box-shadow: var(--shadow-micro); font-family: var(--font-mono); font-size: 13px; min-width: 0; }
  .raw-card span { overflow-wrap: anywhere; }
  .raw-card:hover { background: var(--bg-hover); text-decoration: none; }
  .raw-icon { color: var(--icon-secondary); }

  /* Footer */
  footer { border-top: 1px solid var(--border-default); }
  .foot-inner { max-width: 1040px; margin: 0 auto; padding: 20px 24px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; font-size: 12px; color: var(--fg-tertiary); }
  .foot-id { margin-left: auto; font-family: var(--font-mono); overflow-wrap: anywhere; }
  .empty { color: var(--fg-secondary); }

  /* Lightbox: always dark */
  .lb { position: fixed; inset: 0; z-index: 50; background: rgba(11, 15, 20, 0.88); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); display: none; grid-template-rows: auto minmax(0, 1fr) auto; padding: 16px 24px; color: #fff; }
  .lb.open { display: grid; }
  .lb-top { display: flex; align-items: center; gap: 12px; font-size: 13px; min-width: 0; }
  .lb-count { font-family: var(--font-mono); color: #9aa4ae; font-variant-numeric: tabular-nums; flex-shrink: 0; }
  .lb-label { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1 1 auto; }
  .lb-raw { margin-left: auto; color: #9aa4ae; display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; white-space: nowrap; }
  .lb-raw:hover { color: #fff; text-decoration: none; }
  .lb-close { all: unset; cursor: pointer; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; color: #fff; }
  .lb-close:hover { background: rgba(255, 255, 255, 0.1); }
  /* The row must be definite (1fr), or the image takes its intrinsic height and overflows. */
  .lb-stage { display: grid; grid-template-columns: 48px minmax(0, 1fr) 48px; grid-template-rows: minmax(0, 1fr); align-items: center; gap: 16px; min-height: 0; height: 100%; }
  .lb-nav { all: unset; cursor: pointer; width: 40px; height: 40px; display: inline-flex; align-items: center; justify-content: center; border-radius: 9999px; background: rgba(255, 255, 255, 0.08); color: #fff; }
  .lb-nav:hover { background: rgba(255, 255, 255, 0.16); }
  /* The wrap shrinks to the image so the tap ring's percentages land on it. */
  .lb-img-wrap { position: relative; height: 100%; max-width: 100%; justify-self: center; display: block; }
  .lb-img { height: 100%; max-height: 100%; width: auto; max-width: 100%; object-fit: contain; margin: 0 auto; border-radius: 12px; display: block; cursor: default; }
  .lb-tap { width: 32px; height: 32px; margin: -16px 0 0 -16px; }
  .lb-hint { text-align: center; font-size: 12px; color: #9aa4ae; }

  /* Tablets and small laptops */
  @media (max-width: 860px) {
    main { padding: 40px 20px 56px; gap: 48px; }
    .nav-links { gap: 0; }
    .nav-links a { padding: 6px 8px; }
  }

  /* Phones. One column where it helps, tighter type, nothing hidden that
     carries information. The section links in the nav go; the theme
     toggle stays. */
  @media (max-width: 640px) {
    .nav-inner { padding: 0 16px; height: 52px; gap: 10px; }
    .nav-links { display: none; }
    .brand { gap: 8px; }
    main { padding: 28px 16px 48px; gap: 40px; }
    section { gap: 16px; scroll-margin-top: 64px; }
    section.verdict { gap: 18px; }
    h1 { font-size: 22px; line-height: 1.3; flex-basis: 100%; }
    h1.h1-long { font-size: 19px; }
    h1.h1-xlong { font-size: 16px; }
    h2 { font-size: 18px; }
    .hint { display: none; }
    .lede { font-size: 14px; }
    .verdict-row { gap: 12px; }
    .pill { margin-top: 0; }
    .launch-row { align-items: flex-start; flex-direction: column; gap: 8px; }
    .fact { flex-basis: 40%; padding: 12px 14px; }
    .fact.fact-wide { flex-basis: 100%; }
    .breakdown { gap: 12px 16px; }
    .breakdown-total { margin-left: 0; flex-basis: 100%; }
    .grid { grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 12px; }
    .tl-row { grid-template-columns: 40px 24px minmax(0, 1fr); grid-template-rows: auto; gap: 8px 10px; padding: 10px 12px; align-items: start; }
    .tl-time { font-size: 11px; padding-top: 5px; }
    .tl-icon { width: 24px; height: 24px; }
    .tl-icon svg { width: 14px; height: 14px; }
    .tl-body { gap: 6px 8px; padding-top: 3px; }
    .tl-dur { grid-column: 3; grid-row: 2; padding-left: 0; font-size: 11px; }
    .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .stat { padding: 12px 14px; }
    .stat-v { font-size: 20px; }
    .charts { padding: 14px; gap: 18px; }
    .chart-box { height: 96px; }
    .chart-head { flex-wrap: wrap; }
    .rec-grid { grid-template-columns: minmax(0, 1fr); gap: 16px; }
    .rec-frame { max-width: 320px; }
    .raw { grid-template-columns: minmax(0, 1fr); }
    .report { padding: 16px; font-size: 14px; }
    .foot-inner { padding: 16px; gap: 8px 12px; }
    .foot-id { margin-left: 0; flex-basis: 100%; }
    .lb { padding: 12px 12px 16px; }
    .lb-stage { grid-template-columns: 36px minmax(0, 1fr) 36px; gap: 6px; }
    .lb-nav { width: 36px; height: 36px; }
    .lb-img { border-radius: 8px; }
    .lb-hint { display: none; }
  }

  /* Narrow phones */
  @media (max-width: 380px) {
    .fact { flex-basis: 100%; }
    .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .stats { grid-template-columns: minmax(0, 1fr); }
    .brand-name { display: none; }
    .brand-sep { display: none; }
    /* The eyebrow wraps here; drop its middle dot so no line ends on one. */
    .run-eyebrow-sep { display: none; }
    /* Only the first and last time labels fit under a chart this narrow. */
    .axis span:not(.first):not(.last) { display: none; }
  }

  /* Pointer-less devices: no hover-only affordances, larger tap targets */
  @media (hover: none) {
    .theme-btn, .lb-close { width: 40px; height: 40px; }
    .tl-view { padding: 4px 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
  }
</style>
</head>
<body>
<header class="nav">
  <div class="nav-inner">
    <a class="brand" href="#top"><span class="brand-name">${esc(projectName)}</span><span class="brand-sep">/</span><span class="brand-subject">${esc(subject)}</span></a>
    <div class="nav-right">
      <nav class="nav-links">
      ${navLinks}
      </nav>
      <button type="button" class="theme-btn" id="theme-btn" title="Theme: system" aria-label="Switch theme">${icon("monitor", "ic-system")}${icon("sun", "ic-light")}${icon("moon", "ic-dark")}</button>
    </div>
  </div>
</header>

<main id="top">
  <section class="verdict">
    <div class="run-eyebrow">
      <span class="run-eyebrow-bot">${icon("bot")}${esc(agentName)} verification</span>
      <span class="run-eyebrow-sep">·</span>
      <span>${startedIso ? `<time datetime="${esc(startedIso)}">${esc(startedLabel)}</time>` : esc(generatedLabel)}</span>
    </div>
    ${healthHtml}
    <div class="verdict-row">
      <div class="pill ${PILL[0]}">${icon(PILL[1])}${esc(verdictLabel)}</div>
      <h1 class="h1${h1Class}">${esc(verdictDetail)}</h1>
    </div>
    <p class="lede">An agent drove the app on an EAS cloud ${isEmulator ? "emulator" : "simulator"}${deviceParen}. ${session ? "Every screenshot, device command, and performance sample below is from that run." : "Every screenshot below is from that run."}${sessionLink}</p>
    ${launchHtml}
    ${factsHtml}
    ${breakdownHtml}
  </section>

${reportHtml}
${
  images.length
    ? `  <section id="screenshots">
    ${sectionHead("Screenshots", String(images.length), "Click to view full screen · ← → to page")}
    <div class="grid">
${shotsHtml}
    </div>
  </section>`
    : ""
}
${!images.length && !videos.length && !session ? '  <p class="empty">No media captured.</p>' : ""}
${timelineHtml}
${perfHtml}
${recordingHtml}
${rawHtml}
</main>

<footer>
  <div class="foot-inner">
    <span>Generated ${esc(generatedLabel)}</span>
    <span>·</span>
    <span>${esc(agentName)}</span>
    <span>·</span>
    <span>EAS Simulator</span>
    ${session ? `<span class="foot-id">session ${esc(session.id)}</span>` : ""}
  </div>
</footer>

<div class="lb" id="lb" role="dialog" aria-modal="true" aria-label="Screenshot viewer">
  <div class="lb-top">
    <span class="lb-count" id="lb-count"></span>
    <span class="lb-label" id="lb-label"></span>
    <a class="lb-raw" id="lb-raw" href="#" target="_blank" rel="noopener">Open raw file${icon("external-link")}</a>
    <button type="button" class="lb-close" id="lb-close" aria-label="Close">${icon("x")}</button>
  </div>
  <div class="lb-stage">
    <button type="button" class="lb-nav" id="lb-prev" aria-label="Previous screenshot">${icon("chevron-left")}</button>
    <span class="lb-img-wrap"><img class="lb-img" id="lb-img" alt=""><span class="tap-mark lb-tap" id="lb-tap" hidden></span></span>
    <button type="button" class="lb-nav" id="lb-next" aria-label="Next screenshot">${icon("chevron-right")}</button>
  </div>
  <div class="lb-hint">← → to page · Esc to close</div>
</div>

<script>
(function () {
  // Theme toggle: system -> light -> dark -> system.
  var btn = document.getElementById('theme-btn');
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  var root = document.documentElement;
  function apply(pref) {
    var dark = pref === 'dark' || (pref === 'system' && mq.matches);
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    root.setAttribute('data-theme-pref', pref);
    if (btn) btn.title = 'Theme: ' + pref;
  }
  var pref = root.getAttribute('data-theme-pref') || 'system';
  apply(pref);
  if (btn) btn.addEventListener('click', function () {
    pref = pref === 'system' ? 'light' : pref === 'light' ? 'dark' : 'system';
    try { localStorage.setItem('evidence-theme', pref); } catch (e) {}
    apply(pref);
  });
  mq.addEventListener('change', function () { if (pref === 'system') apply(pref); });
})();

(function () {
  // Folds: the long timeline and the long report open on one click.
  function unfold(btnId, targetId, cls) {
    var btn = document.getElementById(btnId);
    var el = document.getElementById(targetId);
    if (!btn || !el) return;
    btn.addEventListener('click', function () {
      el.classList.remove(cls);
      btn.parentNode.removeChild(btn);
    });
  }
  unfold('tl-more', 'tl', 'tl-folded');
  unfold('report-more', 'report-card', 'report-collapsed');
})();

(function () {
  var shots = ${shotsJson};
  if (!shots.length) return;
  var lb = document.getElementById('lb');
  var img = document.getElementById('lb-img');
  var count = document.getElementById('lb-count');
  var label = document.getElementById('lb-label');
  var raw = document.getElementById('lb-raw');
  var tap = document.getElementById('lb-tap');
  var current = 0;
  // #shot-N in the URL is a permalink to a screenshot: it opens the viewer
  // on load, and paging keeps it current.
  function setHash(h) {
    try { history.replaceState(null, '', h ? '#' + h : location.pathname + location.search); } catch (e) {}
  }
  function show(i) {
    current = (i + shots.length) % shots.length;
    var s = shots[current];
    img.src = s.src;
    img.alt = s.label;
    label.textContent = s.label;
    raw.href = s.src;
    count.textContent = (current + 1) + ' / ' + shots.length;
    if (s.tap) { tap.hidden = false; tap.style.left = (s.tap.x * 100) + '%'; tap.style.top = (s.tap.y * 100) + '%'; }
    else { tap.hidden = true; }
    setHash('shot-' + (current + 1));
    // Preload neighbors so paging feels instant.
    [current + 1, current - 1].forEach(function (n) {
      new Image().src = shots[(n + shots.length) % shots.length].src;
    });
  }
  function open(i) { show(i); lb.classList.add('open'); document.body.style.overflow = 'hidden'; }
  function close() { lb.classList.remove('open'); document.body.style.overflow = ''; setHash(''); }
  var m = /^#shot-(\\d+)$/.exec(location.hash);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= shots.length) open(Number(m[1]) - 1);
  document.querySelectorAll('.shot, .tl-view').forEach(function (b) {
    b.addEventListener('click', function () { open(Number(b.dataset.index)); });
  });
  document.getElementById('lb-close').addEventListener('click', close);
  document.getElementById('lb-prev').addEventListener('click', function (e) { e.stopPropagation(); show(current - 1); });
  document.getElementById('lb-next').addEventListener('click', function (e) { e.stopPropagation(); show(current + 1); });
  img.addEventListener('click', function (e) { e.stopPropagation(); });
  raw.addEventListener('click', function (e) { e.stopPropagation(); });
  // Anything else inside the backdrop closes.
  lb.addEventListener('click', close);
  document.addEventListener('keydown', function (e) {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') show(current - 1);
    else if (e.key === 'ArrowRight') show(current + 1);
  });
})();
</script>
</body>
</html>
`,
);

log.log(
  `Evidence site written to ${siteDir} (${images.length} images, ${videos.length} videos${session ? `, session ${session.id.slice(0, 8)}: ${session.timeline?.length ?? 0} timeline entries, ${session.metrics?.samples?.length ?? 0} metric samples` : ", no session data"})`,
);
return {
  siteDir,
  images: images.length,
  videos: videos.length,
  session: session ? session.id : null,
  kind,
  verdict: v,
  report: reportText.length,
  url: siteUrl || "",
  durationMs: session?.durationMs ?? null,
  manifest: join(siteDir, "evidence.json"),
};
}
