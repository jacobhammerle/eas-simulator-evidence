// One page over many runs. A QA swarm produces one site per lane; this
// scans a folder of built sites, reads each site's evidence.json manifest,
// and writes an index with a card per run: verdict pill, subject, first
// screenshot, device, duration, link.
//
//   buildIndex({ dir, out, subject, projectName, log }) -> { siteDir, runs }
//
// <dir>/<run>/index.html + evidence.json  ->  <out>/index.html (default <dir>/index.html)
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseVerdict } from "./verdict.mjs";

const assetsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const fmtDur = (ms) => {
  if (!Number.isFinite(ms)) return "—";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};
const PILL = { pass: "pill-pass", fail: "pill-fail", replicated: "pill-warn", neutral: "pill-neutral" };
const ORDER = { fail: 0, replicated: 1, neutral: 2, pass: 3 };

// Reads every run under dir: a subfolder with index.html and evidence.json.
export function readRuns(dir) {
  if (!dir || !existsSync(dir)) return [];
  const runs = [];
  for (const name of readdirSync(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const sub = join(dir, name);
    const manifest = join(sub, "evidence.json");
    if (!existsSync(join(sub, "index.html")) || !existsSync(manifest)) continue;
    try {
      const m = JSON.parse(readFileSync(manifest, "utf8"));
      if (!m || typeof m !== "object") continue;
      runs.push({ folder: name, ...m });
    } catch {
      /* not a run */
    }
  }
  return runs;
}

export function buildIndex({ dir, out, subject = "Runs", projectName = "", log = console } = {}) {
  if (!dir || !existsSync(dir)) throw new Error(`runs dir not found: ${dir || "(none)"}`);
  const siteDir = out || dir;
  mkdirSync(siteDir, { recursive: true });
  const runs = readRuns(dir);
  cpSync(join(assetsDir, "colors_and_type.css"), join(siteDir, "colors_and_type.css"));
  cpSync(join(assetsDir, "fonts"), join(siteDir, "fonts"), { recursive: true });

  const counts = { pass: 0, fail: 0, replicated: 0, neutral: 0 };
  for (const r of runs) counts[PILL[r.kind] ? r.kind : "neutral"]++;
  const sorted = [...runs].sort((a, b) => (ORDER[a.kind] ?? 2) - (ORDER[b.kind] ?? 2) || a.folder.localeCompare(b.folder, undefined, { numeric: true }));
  const title = projectName ? `${projectName} · ${subject}` : subject;

  const cards = sorted
    .map((r) => {
      const v = parseVerdict(r.verdict || "");
      const href = "./" + relative(siteDir, join(dir, r.folder)).split(/[\\/]/).map(encodeURIComponent).join("/") + "/";
      const shot = r.firstImage ? `${href}${encodeURIComponent(r.firstImage)}` : "";
      const dev = [r.session?.device, r.session?.runtime].filter(Boolean).join(" · ");
      const nImages = Array.isArray(r.images) ? r.images.length : Number.isFinite(r.images) ? r.images : null;
      return `  <a class="run" href="${esc(href)}">
    <span class="run-shot">${shot ? `<img src="${esc(shot)}" alt="" loading="lazy">` : ""}</span>
    <span class="run-body">
      <span class="pill ${PILL[v.kind] || "pill-neutral"}">${esc(v.label)}</span>
      <span class="run-subject">${esc(r.subject || r.folder)}</span>
      <span class="run-detail">${esc(v.detail)}</span>
      <span class="run-meta">${[dev, r.session?.durationMs != null ? fmtDur(r.session.durationMs) : "", nImages != null ? `${nImages} screenshot${nImages === 1 ? "" : "s"}` : ""].filter(Boolean).map(esc).join(" · ")}</span>
    </span>
  </a>`;
    })
    .join("\n");

  const summary = [
    counts.fail && `${counts.fail} failed`,
    counts.replicated && `${counts.replicated} replicated`,
    counts.pass && `${counts.pass} passed`,
    counts.neutral && `${counts.neutral} inconclusive`,
  ].filter(Boolean).join(" · ");

  writeFileSync(
    join(siteDir, "index.html"),
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(`${runs.length} runs${summary ? ` · ${summary}` : ""}`)}">
<script>
(function () {
  var pref = 'system';
  try { pref = localStorage.getItem('evidence-theme') || 'system'; } catch (e) {}
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
</script>
<link rel="stylesheet" href="./colors_and_type.css">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg-subtle); color: var(--fg-default); font-family: var(--font-sans); }
  body { font-size: 14px; line-height: 1.4; overflow-x: hidden; }
  a { color: inherit; text-decoration: none; }
  main { max-width: 1040px; margin: 0 auto; padding: 48px 24px 64px; display: flex; flex-direction: column; gap: 24px; }
  h1 { margin: 0; font-size: 28px; line-height: 1.3; letter-spacing: -0.02em; font-weight: 600; color: var(--fg-display); overflow-wrap: anywhere; }
  .summary { font-size: 14px; color: var(--fg-secondary); }
  .runs { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
  .run { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 14px; padding: 14px; border: 1px solid var(--border-default); border-radius: 12px; background: var(--bg-default); box-shadow: var(--shadow-micro); }
  .run:hover { border-color: var(--border-strong); }
  .run-shot { display: block; aspect-ratio: 9 / 19.5; border-radius: 8px; overflow: hidden; background: var(--bg-element); border: 1px solid var(--border-default); }
  .run-shot img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .run-body { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .pill { align-self: flex-start; display: inline-flex; padding: 3px 10px; border-radius: 9999px; font-weight: 600; font-size: 11px; letter-spacing: 0.04em; font-family: var(--font-mono); }
  .pill-pass { background: var(--status-success-bg); color: var(--status-success-fg); }
  .pill-fail { background: var(--status-danger-bg); color: var(--status-danger-fg); }
  .pill-warn { background: var(--status-warning-bg); color: var(--status-warning-fg); }
  .pill-neutral { background: var(--bg-element); color: var(--fg-secondary); }
  .run-subject { font-weight: 600; color: var(--fg-display); overflow-wrap: anywhere; }
  .run-detail { color: var(--fg-secondary); overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .run-meta { font-size: 12px; color: var(--fg-tertiary); overflow-wrap: anywhere; }
  .empty { color: var(--fg-secondary); }
  @media (max-width: 640px) { main { padding: 28px 16px 48px; } h1 { font-size: 22px; } .runs { grid-template-columns: minmax(0, 1fr); } }
</style>
</head>
<body>
<main>
  <h1>${esc(title)}</h1>
  <p class="summary">${runs.length ? esc(`${runs.length} run${runs.length === 1 ? "" : "s"}${summary ? ` · ${summary}` : ""}`) : "No runs found. Each run is a folder with index.html and evidence.json."}</p>
  ${runs.length ? `<div class="runs">\n${cards}\n  </div>` : ""}
</main>
</body>
</html>
`,
  );
  log.log(`Index written to ${join(siteDir, "index.html")} (${runs.length} runs)`);
  return { siteDir, runs: runs.length, counts };
}
