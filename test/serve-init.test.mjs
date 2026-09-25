import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildSite } from "../src/build.mjs";
import { serveSite, resolveFile, contentType, openInBrowser } from "../src/serve.mjs";
import { initRecipe, ensureGitignore, TARGETS } from "../src/init.mjs";
import { colorEnabled, paint } from "../src/term.mjs";
import { fixture, fresh, quiet, cleanOut, cli, root } from "./helpers.mjs";

after(cleanOut);

const site = () => {
  const out = fresh("site");
  buildSite({ dir: fixture, subject: "x", verdict: "PASS: x", out, log: quiet });
  return out;
};

// --- serve -----------------------------------------------------------------

test("serveSite serves the page, its assets, and 404s the rest", async () => {
  const out = site();
  const s = await serveSite({ root: out, port: 0 });
  try {
    assert.match(s.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    const index = await fetch(s.url);
    assert.equal(index.status, 200);
    assert.equal(index.headers.get("content-type"), "text/html; charset=utf-8");
    assert.match(await index.text(), /<title>/);

    const css = await fetch(`${s.url}colors_and_type.css`);
    assert.equal(css.headers.get("content-type"), "text/css; charset=utf-8");
    const png = await fetch(`${s.url}1-checklist.png`);
    assert.equal(png.status, 200);
    assert.equal(png.headers.get("content-type"), "image/png");
    const json = await fetch(`${s.url}session/session.json`);
    assert.equal(json.headers.get("content-type"), "application/json; charset=utf-8");
    const font = await fetch(`${s.url}fonts/Inter-Variable.woff2`);
    assert.equal(font.headers.get("content-type"), "font/woff2");

    assert.equal((await fetch(`${s.url}nope.html`)).status, 404);
    assert.equal((await fetch(`${s.url}session/`)).status, 404, "a folder without index.html");
    assert.equal((await fetch(`${s.url}..%2F..%2Fpackage.json`)).status, 404, "no path escape");
    const head = await fetch(s.url, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal((await head.text()).length, 0);
  } finally {
    await s.close();
  }
});

test("serveSite refuses a folder without index.html", () => {
  assert.throws(() => serveSite({ root: fresh("empty") }), /no index\.html/);
  assert.throws(() => serveSite({}), /no index\.html/);
});

test("resolveFile blocks escapes and handles encoded names", () => {
  const out = site();
  assert.equal(resolveFile(out, "/"), join(out, "index.html"));
  assert.equal(resolveFile(out, "/index.html?x=1#y"), join(out, "index.html"));
  assert.equal(resolveFile(out, "/1-checklist.png"), join(out, "1-checklist.png"));
  assert.equal(resolveFile(out, "/../package.json"), null);
  assert.equal(resolveFile(out, "/%2e%2e/package.json"), null);
  assert.equal(resolveFile(out, "/%ZZ"), null, "a bad escape is a 404, not a crash");
  writeFileSync(join(out, "a b#.txt"), "hi");
  assert.equal(resolveFile(out, "/a%20b%23.txt"), join(out, "a b#.txt"));
});

test("contentType covers what a site contains and defaults otherwise", () => {
  assert.equal(contentType("x.MP4"), "video/mp4");
  assert.equal(contentType("x.ndjson"), "application/x-ndjson; charset=utf-8");
  assert.equal(contentType("x.unknown"), "application/octet-stream");
});

test("openInBrowser never throws, even for an unknown platform command", () => {
  assert.equal(typeof openInBrowser("http://127.0.0.1:1/", "plan9"), "boolean");
});

test("open: the CLI refuses a missing site and a bad port", () => {
  const dir = fresh("noopen");
  let r = cli(["open", dir]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /site folder not found/);
  r = cli(["open", fixture, "--out", site(), "--port", "abc", "--no-browser"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--port must be a number/);
});

// --- init ------------------------------------------------------------------

test("init copies each recipe to its conventional path and updates .gitignore", () => {
  for (const [target, t] of Object.entries(TARGETS)) {
    const proj = fresh(`init-${target}`);
    const r = initRecipe({ target, projectDir: proj });
    assert.equal(r.dest, t.dest);
    assert.ok(existsSync(join(proj, t.dest)), t.dest);
    assert.equal(readFileSync(join(proj, t.dest), "utf8"), readFileSync(join(root, "recipes", t.recipe), "utf8"));
    assert.deepEqual(r.gitignoreAdded, [".env.eas-simulator", "evidence/"]);
    assert.match(readFileSync(join(proj, ".gitignore"), "utf8"), /\.env\.eas-simulator\n(#[^\n]*\n)?evidence\//);
    assert.ok(r.next.length > 20);
  }
});

test("init refuses to overwrite unless forced, and rejects unknown targets", () => {
  const proj = fresh("init-force");
  initRecipe({ target: "local", projectDir: proj });
  writeFileSync(join(proj, "scripts", "evidence.sh"), "edited");
  assert.throws(() => initRecipe({ target: "local", projectDir: proj }), /already exists/);
  assert.equal(readFileSync(join(proj, "scripts", "evidence.sh"), "utf8"), "edited");
  initRecipe({ target: "local", projectDir: proj, force: true });
  assert.notEqual(readFileSync(join(proj, "scripts", "evidence.sh"), "utf8"), "edited");
  assert.throws(() => initRecipe({ target: "jenkins", projectDir: proj }), /unknown target "jenkins"/);
});

test("ensureGitignore appends only what is missing and keeps the file's ending", () => {
  const proj = fresh("gi");
  writeFileSync(join(proj, ".gitignore"), "node_modules/\nevidence/");
  const r = ensureGitignore(proj);
  assert.deepEqual(r.added, [".env.eas-simulator"]);
  const text = readFileSync(join(proj, ".gitignore"), "utf8");
  assert.equal(text, "node_modules/\nevidence/\n\n# EAS Simulator session config (holds a session auth token)\n.env.eas-simulator\n");
  assert.deepEqual(ensureGitignore(proj).added, [], "second run is a no-op");
  const none = fresh("gi-none");
  ensureGitignore(none);
  assert.match(readFileSync(join(none, ".gitignore"), "utf8"), /^# EAS Simulator/);
});

test("init: the CLI lists targets, writes one, and reports next steps", () => {
  let r = cli(["init"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /github-actions\s+-> \.github\/workflows\/pr-evidence\.yml/);
  const proj = fresh("init-cli");
  r = cli(["init", "github-actions", "--project-dir", proj]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Wrote \.github\/workflows\/pr-evidence\.yml/);
  assert.match(r.stdout, /Added to \.gitignore: \.env\.eas-simulator, evidence\//);
  assert.match(r.stdout, /Next: /);
  r = cli(["init", "github-actions", "--project-dir", proj]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /already exists\. Pass --force/);
  r = cli(["init", "nope", "--project-dir", proj]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown target/);
});

// --- terminal --------------------------------------------------------------

test("color follows TTY, NO_COLOR, and FORCE_COLOR", () => {
  assert.equal(colorEnabled({ isTTY: true }, {}), true);
  assert.equal(colorEnabled({ isTTY: false }, {}), false);
  assert.equal(colorEnabled({ isTTY: true }, { NO_COLOR: "1" }), false);
  assert.equal(colorEnabled({ isTTY: true }, { NO_COLOR: "" }), true, "an empty NO_COLOR does not count");
  assert.equal(colorEnabled({ isTTY: false }, { FORCE_COLOR: "1" }), true);
  assert.equal(colorEnabled({ isTTY: false }, { FORCE_COLOR: "0" }), false);
  assert.equal(paint("x", "green", true), "\u001b[32mx\u001b[0m");
  assert.equal(paint("x", "green", false), "x");
  assert.equal(paint("x", "nope", true), "x");
});

test("the CLI prints no escape codes when piped", () => {
  const out = fresh("plain");
  const r = cli(["build", fixture, "--subject", "x", "--verdict", "PASS: ok", "--out", out]);
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.stdout, /\u001b\[/);
  assert.match(r.stdout, /^PASS: ok\nEvidence site: /);
});

// --- CLI hygiene -----------------------------------------------------------

test("unknown options are errors, with the option named in kebab-case", () => {
  let r = cli(["build", fixture, "--subject", "x", "--verdict", "PASS: x", "--out", fresh("u"), "--build-idd", "abc"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown option --build-idd for "build"/);
  r = cli(["verdict", "PASS: x", "--json"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown option --json for "verdict"/);
  r = cli(["thumbs", fixture, "https://e.com", "--max", "2", "--wat"]);
  assert.equal(r.code, 2);
});

test("short flags -h and -v work", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(cli(["-v"]).stdout.trim(), pkg.version);
  assert.match(cli(["-h"]).stdout, /^eas-simulator-evidence — /);
  assert.match(cli(["build", "-h"]).stdout, /Usage/);
});

test("notes go to stderr; stdout carries only the result", () => {
  const dir = fresh("stdout");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "1-a.png"), readFileSync(join(fixture, "1-checklist.png")));
  const r = cli(["run", dir, "--subject", "x", "--verdict", "PASS: ok", "--dotenv", join(dir, "none")], { env: { EAS_SIMULATOR_SESSION_ID: "" } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /no session id/);
  assert.match(r.stderr, /Evidence site written/);
  assert.equal(r.stdout, `PASS: ok\nEvidence site: ${join(dir, "site")}\n`);
});

test("--wait must be a number", () => {
  const r = cli(["collect", fixture, "--wait", "soon", "--session", "x"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--wait must be a number/);
});

// --- action.yml ------------------------------------------------------------

test("action.yml declares the inputs the CLI accepts and the outputs the run emits", () => {
  const y = readFileSync(join(root, "action.yml"), "utf8");
  assert.match(y, /^name: /m);
  assert.match(y, /using: composite/);
  for (const input of ["dir", "subject", "verdict", "verdict-file", "report-file", "session", "build-id", "agent", "lane", "name", "owner", "slug", "deploy-alias", "working-directory"]) {
    assert.match(y, new RegExp(`^  ${input}:\\n`, "m"), `input ${input}`);
  }
  for (const output of ["url", "site-dir", "kind", "verdict"]) {
    assert.match(y, new RegExp(`^  ${output}:\\n    description`, "m"), `output ${output}`);
    assert.match(y, new RegExp(`steps\\.run\\.outputs\\.${output}`), `output ${output} wired`);
  }
  assert.match(y, /github\.action_path.*bin\/eas-simulator-evidence\.js/);
  assert.doesNotMatch(y, /npx eas-simulator-evidence/, "the action runs its own checkout, not a registry version");
});

test("the action's shell step composes the same flags the CLI accepts", () => {
  const y = readFileSync(join(root, "action.yml"), "utf8");
  const flags = [...y.matchAll(/args\+=\((--[a-z-]+)/g)].map((m) => m[1]);
  const help = cli(["--help"]).stdout;
  for (const f of flags) assert.match(help, new RegExp(`  ${f} `), `${f} is a documented CLI option`);
});
