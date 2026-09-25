#!/usr/bin/env node
// CLI for eas-simulator-evidence. See docs/reference.md for the full reference.
//
// Conventions: results on stdout, notes and errors on stderr; exit 0 on
// success, 1 on a failure while working, 2 on a usage error; --json for
// machine-readable output; color only on a TTY and never with NO_COLOR.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs, pairsToObject } from "../src/args.mjs";
import { buildSite } from "../src/build.mjs";
import { collectSession } from "../src/collect.mjs";
import { resolveProject } from "../src/config.mjs";
import { deploySite } from "../src/deploy.mjs";
import { initRecipe, TARGETS } from "../src/init.mjs";
import { commentMarkdown } from "../src/comment.mjs";
import { buildIndex } from "../src/index-page.mjs";
import { junitXml } from "../src/junit.mjs";
import { sweepSessions, PREVIEW_SUFFIX } from "../src/sweep.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { openInBrowser, serveSite } from "../src/serve.mjs";
import { KIND_COLOR, paint } from "../src/term.mjs";
import { thumbsHtml } from "../src/thumbs.mjs";
import { normalizeVerdict, verdictBadge, verdictKind } from "../src/verdict.mjs";

const HELP = `eas-simulator-evidence — turn an EAS Simulator run into an evidence site

Usage
  eas-simulator-evidence run     <dir> --subject "<label>" --verdict "<line>" [options]
  eas-simulator-evidence build   <dir> --subject "<label>" --verdict "<line>" [options]
  eas-simulator-evidence collect <dir> [--session <id>] [--extra k=v]...
  eas-simulator-evidence open    <dir> [--port <n>] [--no-browser]
  eas-simulator-evidence deploy  <dir> [--alias <name>]
  eas-simulator-evidence thumbs  <dir> <siteUrl> [--max 4]
  eas-simulator-evidence verdict "<line>" [--badge]
  eas-simulator-evidence comment <dir> <siteUrl> --verdict "<line>" [options]
  eas-simulator-evidence index   <dir-of-sites> [--out <dir>] [--subject "<label>"]
  eas-simulator-evidence sweep   [--older-than <minutes>] [--dry-run]
  eas-simulator-evidence init    <eas-workflows|github-actions|gitlab-ci|local>

<dir> is the evidence directory: screenshots the agent saved in capture
order (1-home.png, 2-settings.png, ...) and optional .mp4/.mov clips.

run      collect, then build. Takes every option of both.
  --deploy-alias <name> Also deploy to EAS Hosting under this alias and print the URL

build    Write the static site to <dir>/site/ (or --out).
  --subject <label>     Page label, e.g. "PR #12" or "Issue #7"        (required)
  --verdict <line>      "PASS: ...", "FAIL: ...", "REPLICATED: ..."   (required, or:)
  --verdict-file <path> Read the verdict from the file's first line; the rest
                        of the file becomes the "Agent report" section
  --report-file <path>  Text for the "Agent report" section
  --out <dir>           Output folder. Default: <dir>/site
  --name <text>         App display name. Default: app.json expo.name
  --owner <account>     Expo account. Default: app.json expo.owner
  --slug <slug>         Expo project slug. Default: app.json expo.slug
  --project-dir <dir>   Where app.json lives. Default: current directory
  --agent <text>        Agent name shown on the page. Default: Agent
  --build-id <id>       EAS build id: adds the "Try this build" button
  --lane <text>         Lane label shown in the run facts
  --url <siteUrl>       Where the page will be hosted: enables link previews (og:image)
  --junit <path>        Also write a JUnit XML file with one test case for the run
  --json                Print a JSON summary to stdout

collect  Pull the session's own artifacts (events, metrics, recording link)
         into <dir>/session/. Run it after \`eas simulator:stop\`. Never fails
         the pipeline: a missing session prints a note and exits 0.
  --session <id>        EAS Simulator session id. Default: EAS_SIMULATOR_SESSION_ID,
                        then .env.eas-simulator
  --dotenv <path>       Dotenv to read the session id from. Default: .env.eas-simulator
  --extra k=v           Extra fact stored in session.json (repeatable)
  --wait <seconds>      Max wait for the artifacts to finalize. Default: 180
  --eas-cli-version <v> eas-cli version for npx. Default: EAS_CLI_VERSION or latest
  --screenshots         Download the session's own screenshots into <dir> when it has none
  --json                Print a JSON summary to stdout

open     Serve <dir>/site (or --out) on localhost and open it in the browser.
  --port <n>            Port. Default: 9323, or a free one
  --host <host>         Host. Default: 127.0.0.1
  --no-browser          Print the URL only

deploy   Deploy <dir>/site (or --out) to EAS Hosting. Prints the URL.
  --alias <name>        Stable alias, e.g. pr-12-evidence
  --project-dir <dir>   Expo project root. Default: current directory

thumbs   Print an HTML row of linked thumbnails for a PR comment.
  --max <n>             How many. Default: 4

verdict  Print the normalized verdict line.
  --badge               Add the status emoji
  --fallback <KEYWORD>  Keyword for a malformed line. Default: FAIL

comment  Print a pull-request comment: badge, evidence link, thumbnails, the report folded.
  --verdict <line>      The verdict line, or --verdict-file <path> (line 1 + report)
  --report-file <path>  Report text for the folded section
  --title <text>        Heading. Default: Simulator evidence
  --agent <text>        Footer "Posted by <agent>"
  --line <text>         Extra bullet (repeatable), e.g. "📡 **Channel** — pr-12"
  --max <n>             Thumbnails. Default: 4

index    One page over many built sites: a card per run with its verdict.
         Each run is a subfolder of <dir> with index.html and evidence.json.
  --out <dir>           Output folder. Default: <dir>
  --subject <label>     Page title. Default: Runs
  --name <text>         App display name

sweep    Stop live simulator sessions started by the "Try this build" button
         once they are older than the limit. Run it on a schedule.
  --older-than <min>    Age limit in minutes. Default: 30
  --name-suffix <text>  Match sessions whose name ends with this. Default: "evidence-site preview"
  --type <type>         Session type to consider. Default: web-preview-only
  --dry-run             List what would be stopped
  --json                Print the result as JSON

init     Copy a recipe into the project and add the evidence paths to .gitignore.
  --force               Overwrite an existing file
  --project-dir <dir>   Project root. Default: current directory

Global
  -h, --help            Show this help
  -v, --version         Show the version
`;

const REPEAT = ["extra", "line"];
const FLAGS = ["json", "badge", "help", "version", "force", "no-browser", "dry-run", "screenshots", "h", "v"];

// Every option each command accepts, camelCase. Anything else is a typo,
// and a typo that is silently ignored is worse than an error.
const COMMON_BUILD = ["subject", "verdict", "verdictFile", "reportFile", "out", "name", "owner", "slug", "projectDir", "agent", "buildId", "lane", "url", "junit", "json"];
const COMMON_COLLECT = ["session", "dotenv", "extra", "wait", "easCliVersion", "screenshots", "json"];
const OPTIONS = {
  run: [...COMMON_BUILD, ...COMMON_COLLECT, "deployAlias"],
  build: COMMON_BUILD,
  collect: COMMON_COLLECT,
  open: ["out", "port", "host", "noBrowser"],
  deploy: ["out", "alias", "projectDir", "easCliVersion", "json"],
  thumbs: ["max"],
  verdict: ["badge", "fallback"],
  init: ["force", "projectDir"],
  comment: ["verdict", "verdictFile", "reportFile", "title", "agent", "line", "max"],
  index: ["out", "subject", "name"],
  sweep: ["olderThan", "nameSuffix", "type", "dryRun", "json", "easCliVersion"],
  version: [],
  help: [],
};

function fail(msg, code = 2) {
  console.error(`error: ${msg}`);
  process.exit(code);
}

function checkOptions(cmd, a) {
  const allowed = new Set([...(OPTIONS[cmd] || []), "help", "h", "version", "v"]);
  const given = Object.keys(a).filter((k) => k !== "positional" && k !== "command" && a[k] !== undefined);
  const unknown = given.filter((k) => !allowed.has(k) && !(Array.isArray(a[k]) && a[k].length === 0));
  if (unknown.length) {
    const kebab = (k) => "--" + k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
    fail(`unknown option ${unknown.map(kebab).join(", ")} for "${cmd}". Run with --help to see its options.`);
  }
}

// The verdict is one line. A verdict file may carry a report after it,
// which becomes the page's "Agent report" section unless --report-file
// names another.
function readVerdictAndReport(a) {
  let verdict = a.verdict || "";
  let report = "";
  if (a.verdictFile) {
    if (!existsSync(a.verdictFile)) fail(`verdict file not found: ${a.verdictFile}`);
    const [first, ...rest] = readFileSync(a.verdictFile, "utf8").split("\n");
    verdict ||= first;
    report = rest.join("\n").trim();
  }
  if (a.reportFile) {
    if (!existsSync(a.reportFile)) fail(`report file not found: ${a.reportFile}`);
    report = readFileSync(a.reportFile, "utf8").trim();
  }
  return { verdict, report };
}

// Notes go to stderr so stdout stays clean for --json and for pipes.
const notes = { log: (m) => console.error(m), warn: (m) => console.error(m) };

function buildOptions(a, dir) {
  const project = resolveProject({ projectDir: a.projectDir, name: a.name, owner: a.owner, slug: a.slug });
  const { verdict, report } = readVerdictAndReport(a);
  if (!a.subject) fail("--subject is required");
  if (!verdict.trim()) fail("--verdict or --verdict-file is required");
  return {
    dir,
    subject: a.subject,
    verdict: normalizeVerdict(verdict),
    report,
    url: a.url,
    out: a.out,
    ...project,
    agentName: a.agent || "Agent",
    buildId: a.buildId,
    lane: a.lane,
    log: notes,
  };
}

function collectOptions(a, dir) {
  if (a.wait !== undefined && !(Number(a.wait) >= 0)) fail(`--wait must be a number of seconds, got "${a.wait}"`);
  return {
    dir,
    sessionId: a.session,
    envFile: a.dotenv,
    extra: pairsToObject(a.extra),
    maxWaitMs: a.wait !== undefined ? Number(a.wait) * 1000 : undefined,
    easCliVersion: a.easCliVersion,
    screenshots: Boolean(a.screenshots),
    log: notes,
  };
}

// --junit writes one test case for the run next to whatever else CI collects.
function writeJunit(a, r) {
  if (!a.junit) return;
  mkdirSync(dirname(resolve(a.junit)), { recursive: true });
  writeFileSync(resolve(a.junit), junitXml({ subject: a.subject, verdict: r.verdict, siteDir: r.siteDir, url: r.url, durationMs: r.durationMs }));
  notes.log(`JUnit written to ${resolve(a.junit)}`);
}

function summaryLine(r) {
  const kind = verdictKind(r.verdict);
  return `${paint(r.verdict, KIND_COLOR[kind])}\n${paint(`Evidence site: ${r.siteDir}`, "dim")}`;
}

async function main() {
  let a;
  try {
    // The two short flags everyone expects.
    const argv = process.argv.slice(2).map((x) => (x === "-h" ? "--help" : x === "-v" ? "--version" : x));
    a = parseArgs(argv, { repeat: REPEAT, flags: FLAGS });
  } catch (e) {
    fail(e.message);
  }
  let cmd = a.command;
  if (a.version || a.v) cmd = "version";
  if (!cmd || cmd === "help" || a.help || a.h) {
    process.stdout.write(HELP);
    return;
  }
  if (!OPTIONS[cmd]) fail(`unknown command "${cmd}". Run with --help.`);
  checkOptions(cmd, a);
  const dir = a.positional[0] ? resolve(a.positional[0]) : "";

  switch (cmd) {
    case "version": {
      const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
      console.log(pkg.version);
      return;
    }
    case "collect": {
      if (!dir) fail("collect needs <dir>");
      const s = await collectSession(collectOptions(a, dir));
      if (a.json) console.log(JSON.stringify(s ? { session: s.id, operations: s.counts.operations, samples: s.metrics?.samples?.length ?? 0, recording: !!s.recording } : null));
      return;
    }
    case "build": {
      if (!dir) fail("build needs <dir>");
      const r = buildSite(buildOptions(a, dir));
      writeJunit(a, r);
      console.log(a.json ? JSON.stringify(r) : summaryLine(r));
      return;
    }
    case "run": {
      if (!dir) fail("run needs <dir>");
      const opts = buildOptions(a, dir); // validate flags before spending time on collect
      await collectSession(collectOptions(a, dir));
      const r = buildSite(opts);
      let url = r.url;
      if (a.deployAlias) {
        url = deploySite({ siteDir: r.siteDir, alias: a.deployAlias, projectDir: a.projectDir, easCliVersion: a.easCliVersion, log: notes }).url;
      }
      writeJunit(a, { ...r, url });
      if (a.json) console.log(JSON.stringify({ ...r, url }));
      else console.log(url ? `${summaryLine(r)}\n${url}` : summaryLine(r));
      return;
    }
    case "open": {
      if (!dir) fail("open needs <dir>");
      const root = a.out ? resolve(a.out) : resolve(dir, "site");
      if (!existsSync(root)) fail(`site folder not found: ${root} (run build first)`);
      const port = a.port !== undefined ? Number(a.port) : 9323;
      if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`--port must be a number, got "${a.port}"`);
      let server;
      try {
        server = await serveSite({ root, host: a.host, port });
      } catch (e) {
        if (e.code === "EADDRINUSE" && a.port === undefined) server = await serveSite({ root, host: a.host, port: 0 });
        else throw e;
      }
      console.log(`Serving ${root}\n${paint(server.url, "cyan")}\nPress Ctrl-C to stop.`);
      if (!a.noBrowser) openInBrowser(server.url);
      const stop = () => server.close().then(() => process.exit(0));
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      return;
    }
    case "deploy": {
      if (!dir) fail("deploy needs <dir>");
      const siteDir = a.out ? resolve(a.out) : resolve(dir, "site");
      if (!existsSync(siteDir)) fail(`site folder not found: ${siteDir} (run build first)`);
      const r = deploySite({ siteDir, alias: a.alias, projectDir: a.projectDir, easCliVersion: a.easCliVersion, log: notes });
      console.log(a.json ? JSON.stringify(r) : r.url);
      return;
    }
    case "thumbs": {
      const [, siteUrl] = a.positional;
      if (!dir || !siteUrl) fail("thumbs needs <dir> <siteUrl>");
      const html = thumbsHtml({ dir, siteUrl, max: a.max ? Number(a.max) : 4 });
      if (html) console.log(html);
      return;
    }
    case "verdict": {
      const line = a.positional[0] ?? "";
      const n = normalizeVerdict(line, a.fallback || "FAIL");
      console.log(a.badge ? verdictBadge(n) : n);
      return;
    }
    case "comment": {
      const [, siteUrl] = a.positional;
      if (!dir) fail("comment needs <dir> <siteUrl>");
      const { verdict, report } = readVerdictAndReport(a);
      if (!verdict.trim()) fail("--verdict or --verdict-file is required");
      process.stdout.write(commentMarkdown({ dir, siteUrl, verdict, report, title: a.title, agent: a.agent, lines: a.line, max: a.max ? Number(a.max) : 4 }));
      return;
    }
    case "index": {
      if (!dir) fail("index needs <dir-of-sites>");
      let r;
      try {
        r = buildIndex({ dir, out: a.out ? resolve(a.out) : undefined, subject: a.subject, projectName: a.name, log: notes });
      } catch (e) {
        fail(e.message, 1);
      }
      console.log(a.json ? JSON.stringify(r) : `${r.runs} runs\nIndex: ${join(r.siteDir, "index.html")}`);
      return;
    }
    case "sweep": {
      if (a.olderThan !== undefined && !(Number(a.olderThan) >= 0)) fail(`--older-than must be a number of minutes, got "${a.olderThan}"`);
      const r = await sweepSessions({
        olderThanMin: a.olderThan !== undefined ? Number(a.olderThan) : 30,
        nameSuffix: a.nameSuffix ?? PREVIEW_SUFFIX,
        type: a.type ?? "web-preview-only",
        dryRun: Boolean(a.dryRun),
        easCliVersion: a.easCliVersion,
        log: notes,
      });
      if (a.json) console.log(JSON.stringify(r));
      else console.log(`${r.stopped.length} ${r.dryRun ? "would be stopped" : "stopped"}, ${r.kept.length} kept`);
      return;
    }
    case "init": {
      const target = a.positional[0];
      if (!target) {
        console.log(`Targets:\n${Object.entries(TARGETS).map(([k, t]) => `  ${k.padEnd(16)} -> ${t.dest}`).join("\n")}\n\nUsage: eas-simulator-evidence init <target>`);
        return;
      }
      let r;
      try {
        r = initRecipe({ target, projectDir: a.projectDir, force: a.force });
      } catch (e) {
        fail(e.message);
      }
      console.log(`${paint("Wrote", "green")} ${r.dest}`);
      if (r.gitignoreAdded.length) console.log(`${paint("Added to .gitignore:", "green")} ${r.gitignoreAdded.join(", ")}`);
      console.log(`\nNext: ${r.next}`);
      return;
    }
    default:
      fail(`unknown command "${cmd}". Run with --help.`);
  }
}

main().catch((e) => {
  console.error(`error: ${e.message}`);
  process.exit(1);
});
