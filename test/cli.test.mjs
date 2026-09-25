import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixture, fresh, makeEvidence, cli, cleanOut, root } from "./helpers.mjs";

after(cleanOut);

test("help is printed with no command, with help, and with --help", () => {
  for (const args of [[], ["help"], ["--help"], ["build", "--help"]]) {
    const r = cli(args);
    assert.equal(r.code, 0, args.join(" "));
    assert.match(r.stdout, /^eas-simulator-evidence — /);
    assert.match(r.stdout, /collect <dir>/);
  }
});

test("version", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(cli(["--version"]).stdout.trim(), pkg.version);
  assert.equal(cli(["version"]).stdout.trim(), pkg.version);
});

test("an unknown command exits 2 with a message", () => {
  const r = cli(["frobnicate"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown command "frobnicate"/);
});

test("a missing option value exits 2", () => {
  const r = cli(["build", fixture, "--subject"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--subject needs a value/);
});

test("build: full run with --json prints a summary and nothing else on stdout", () => {
  const out = fresh("cli");
  const r = cli(["build", fixture, "--subject", "PR #12", "--verdict", "PASS: ok", "--out", out, "--name", "Employee Onboarding", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const s = JSON.parse(r.stdout);
  assert.equal(s.kind, "pass");
  assert.equal(s.images, 3);
  assert.equal(s.verdict, "PASS: ok");
  assert.equal(s.siteDir, out);
  assert.ok(existsSync(join(out, "index.html")));
});

test("build: without --json it prints the human line", () => {
  const out = fresh("cli-h");
  const r = cli(["build", fixture, "--subject", "x", "--verdict", "PASS: ok", "--out", out]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, `PASS: ok\nEvidence site: ${out}\n`);
  assert.match(r.stderr, /Evidence site written to .*3 images/);
});

test("build: --verdict-file takes line 1 as the verdict and the rest as the report", () => {
  const out = fresh("cli-vf");
  const r = cli(["build", fixture, "--subject", "x", "--verdict-file", join(fixture, "verdict.txt"), "--out", out, "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const s = JSON.parse(r.stdout);
  assert.match(s.verdict, /^PASS: the progress card went from 2 of 9/);
  assert.ok(s.report > 100);
  const h = readFileSync(join(out, "index.html"), "utf8");
  assert.match(h, /<section id="report">/);
  assert.match(h, /The Checklist tab opened/);
});

test("build: --report-file overrides the verdict file's remainder; --verdict wins over the file's line 1", () => {
  const d = fresh("cli-rf");
  writeFileSync(join(d, "v.txt"), "FAIL: from file\nremainder");
  writeFileSync(join(d, "r.txt"), "the real report");
  const out = join(d, "site");
  const r = cli(["build", fixture, "--subject", "x", "--verdict-file", join(d, "v.txt"), "--verdict", "PASS: explicit", "--report-file", join(d, "r.txt"), "--out", out, "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const s = JSON.parse(r.stdout);
  assert.equal(s.verdict, "PASS: explicit");
  const h = readFileSync(join(out, "index.html"), "utf8");
  assert.match(h, /the real report/);
  assert.doesNotMatch(h, /remainder/);
});

test("build: a stacked verdict is normalized before it reaches the page", () => {
  const out = fresh("cli-norm");
  const r = cli(["build", fixture, "--subject", "x", "--verdict", "PASS: FAIL: nope", "--out", out, "--json"]);
  assert.equal(JSON.parse(r.stdout).verdict, "FAIL: nope");
});

test("build: refuses to run without a subject or a verdict, before writing anything", () => {
  const out = fresh("cli-req");
  let r = cli(["build", fixture, "--verdict", "PASS: x", "--out", out]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--subject is required/);
  r = cli(["build", fixture, "--subject", "x", "--out", out]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--verdict or --verdict-file is required/);
  r = cli(["build", fixture, "--subject", "x", "--verdict", "   ", "--out", out]);
  assert.equal(r.code, 2);
  r = cli(["build", "--subject", "x", "--verdict", "PASS: x"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /build needs <dir>/);
  assert.ok(!existsSync(join(out, "index.html")));
});

test("build: a missing verdict or report file exits 2; a missing evidence dir exits 1", () => {
  let r = cli(["build", fixture, "--subject", "x", "--verdict-file", "/nope/v.txt"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /verdict file not found/);
  r = cli(["build", fixture, "--subject", "x", "--verdict", "PASS: x", "--report-file", "/nope/r.txt"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /report file not found/);
  r = cli(["build", join(fresh("gone"), "missing"), "--subject", "x", "--verdict", "PASS: x"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /evidence dir not found/);
});

test("build: reads app.json from --project-dir and lets flags win", () => {
  const proj = fresh("proj");
  writeFileSync(join(proj, "app.json"), JSON.stringify({ expo: { name: "From App JSON", owner: "acme", slug: "demo" } }));
  const out = fresh("cli-proj");
  let r = cli(["build", fixture, "--subject", "x", "--verdict", "PASS: x", "--out", out, "--project-dir", proj, "--build-id", "0123456789abcdef0123456789abcdef"]);
  assert.equal(r.code, 0, r.stderr);
  let h = readFileSync(join(out, "index.html"), "utf8");
  assert.match(h, /<title>From App JSON · x verification/);
  assert.match(h, /accounts\/acme\/projects\/demo\/simulator-sessions\/create/);

  r = cli(["build", fixture, "--subject", "x", "--verdict", "PASS: x", "--out", out, "--project-dir", proj, "--name", "Flag Name", "--owner", "other", "--slug", "s2", "--build-id", "0123456789abcdef0123456789abcdef"]);
  h = readFileSync(join(out, "index.html"), "utf8");
  assert.match(h, /<title>Flag Name · x verification/);
  assert.match(h, /accounts\/other\/projects\/s2\//);
});

test("build: runs from a directory with no app.json at all", () => {
  const out = fresh("cli-noapp");
  const r = cli(["build", fixture, "--subject", "x", "--verdict", "PASS: x", "--out", out], { cwd: fresh("cwd") });
  assert.equal(r.code, 0, r.stderr);
  assert.match(readFileSync(join(out, "index.html"), "utf8"), /<title>App · x verification/);
});

test("build: --agent and --lane show on the page", () => {
  const out = fresh("cli-agent");
  cli(["build", fixture, "--subject", "x", "--verdict", "PASS: x", "--out", out, "--agent", "QA bot", "--lane", "iOS · Home"]);
  const h = readFileSync(join(out, "index.html"), "utf8");
  assert.match(h, /QA bot verification/);
  assert.match(h, /fact-v">iOS · Home</);
});

test("run: with no session id it still builds the site and exits 0", () => {
  const dir = makeEvidence({ images: ["1-a.png"] });
  const r = cli(["run", dir, "--subject", "x", "--verdict", "PASS: x", "--dotenv", join(dir, "no.env"), "--json"], { env: { EAS_SIMULATOR_SESSION_ID: "" } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /no session id/);
  const s = JSON.parse(r.stdout);
  assert.equal(s.images, 1);
  assert.equal(s.session, null);
  assert.equal(s.url, "");
  assert.ok(existsSync(join(dir, "site", "index.html")));
});

test("run: validates the build flags before collecting", () => {
  const dir = makeEvidence({ images: ["1-a.png"] });
  const r = cli(["run", dir, "--verdict", "PASS: x"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--subject is required/);
});

test("deploy: needs a built site", () => {
  const dir = makeEvidence({ images: ["1-a.png"] });
  const r = cli(["deploy", dir, "--alias", "x"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /site folder not found/);
  assert.equal(cli(["deploy"]).code, 2);
});

test("thumbs: prints the row, or nothing", () => {
  let r = cli(["thumbs", fixture, "https://e.com/site", "--max", "1"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '<a href="https://e.com/site/1-checklist.png"><img src="https://e.com/site/1-checklist.png" alt="Checklist" title="Checklist" width="150" /></a>');
  r = cli(["thumbs", makeEvidence({}), "https://e.com"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "");
  r = cli(["thumbs", fixture]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /thumbs needs <dir> <siteUrl>/);
});

test("verdict: normalizes, badges, and takes a fallback", () => {
  assert.equal(cli(["verdict", "PASS: FAIL: nope"]).stdout.trim(), "FAIL: nope");
  assert.equal(cli(["verdict", "PASS: ok", "--badge"]).stdout.trim(), "✅ PASS: ok");
  assert.equal(cli(["verdict", "no keyword", "--fallback", "INCONCLUSIVE"]).stdout.trim(), "INCONCLUSIVE: malformed verdict line: no keyword");
  assert.equal(cli(["verdict", ""]).stdout.trim(), "FAIL: malformed verdict line:");
  assert.equal(cli(["verdict"]).stdout.trim(), "FAIL: malformed verdict line:");
  assert.equal(cli(["verdict", "--", "--weird"]).stdout.trim(), "FAIL: malformed verdict line: --weird");
});

test("collect: no session id exits 0 with a note, and --json prints null", () => {
  const dir = makeEvidence({});
  const r = cli(["collect", dir, "--dotenv", join(dir, "none.env"), "--json"], { env: { EAS_SIMULATOR_SESSION_ID: "" } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trim(), "null");
  assert.match(r.stderr, /no session id/);
  assert.equal(cli(["collect"]).code, 2);
});
