// thumbs, config, deploy
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { thumbsHtml, listScreenshots, caption } from "../src/thumbs.mjs";
import { resolveProject, readAppJson } from "../src/config.mjs";
import { deploySite, parseDeployOutput } from "../src/deploy.mjs";
import { fixture, fresh, quiet, makeEvidence, cleanOut } from "./helpers.mjs";

after(cleanOut);

// --- thumbs ------------------------------------------------------------------

test("thumbs prints one linked image per screenshot, in order, capped", () => {
  const html = thumbsHtml({ dir: fixture, siteUrl: "https://example.com/site/", max: 2 });
  assert.equal(html, [
    '<a href="https://example.com/site/1-checklist.png"><img src="https://example.com/site/1-checklist.png" alt="Checklist" title="Checklist" width="150" /></a>',
    '<a href="https://example.com/site/2-task-toggled-on.png"><img src="https://example.com/site/2-task-toggled-on.png" alt="Task toggled on" title="Task toggled on" width="150" /></a>',
  ].join(" "));
  assert.equal(thumbsHtml({ dir: fixture, siteUrl: "https://e.com" }).split("</a>").length - 1, 3, "default max is 4, fixture has 3");
  assert.equal(thumbsHtml({ dir: fixture, siteUrl: "https://e.com", max: 1, width: 80 }).match(/width="80"/g).length, 1);
});

test("thumbs encodes and escapes file names", () => {
  const dir = makeEvidence({ images: ['1-a b"c&d.png'] });
  const html = thumbsHtml({ dir, siteUrl: "https://e.com" });
  assert.match(html, /href="https:\/\/e\.com\/1-a%20b%22c%26d\.png"/);
  assert.match(html, /alt="A b&quot;c&amp;d"/);
});

test("thumbs prints nothing with no images, no dir, or no url", () => {
  assert.equal(thumbsHtml({ dir: makeEvidence({}), siteUrl: "https://e.com" }), "");
  assert.equal(thumbsHtml({ dir: join(fresh("x"), "missing"), siteUrl: "https://e.com" }), "");
  assert.equal(thumbsHtml({ dir: fixture, siteUrl: "" }), "");
  assert.equal(thumbsHtml({ dir: fixture }), "");
  assert.equal(thumbsHtml(), "");
  assert.equal(thumbsHtml({ dir: makeEvidence({ videos: ["1.mp4"] }), siteUrl: "https://e.com" }), "");
});

test("listScreenshots ignores non-images and sorts naturally", () => {
  const dir = makeEvidence({ images: ["10-x.png", "2-y.JPG", "1-z.jpeg"], videos: ["3-v.mp4"] });
  writeFileSync(join(dir, "notes.txt"), "");
  assert.deepEqual(listScreenshots(dir), ["1-z.jpeg", "2-y.JPG", "10-x.png"]);
  assert.deepEqual(listScreenshots(undefined), []);
});

test("caption", () => {
  assert.equal(caption("2-settings-toggle.png"), "Settings toggle");
  assert.equal(caption("01_home_screen.PNG"), "Home screen");
  assert.equal(caption("3.png"), "3.png");
  assert.equal(caption("x.png"), "X");
  assert.equal(caption("7 - spaced .jpg"), "Spaced");
});

// --- config ------------------------------------------------------------------

test("resolveProject reads app.json in both shapes and lets flags win", () => {
  const dir = fresh("app");
  writeFileSync(join(dir, "app.json"), JSON.stringify({ expo: { name: "Demo", slug: "demo", owner: "acme" } }));
  assert.deepEqual(resolveProject({ projectDir: dir }), { projectName: "Demo", expoOwner: "acme", expoSlug: "demo", source: "app.json" });
  assert.equal(resolveProject({ projectDir: dir, name: "Other", owner: "o", slug: "s" }).projectName, "Other");
  assert.equal(resolveProject({ projectDir: dir, owner: "o" }).expoOwner, "o");

  writeFileSync(join(dir, "app.json"), JSON.stringify({ name: "Bare", slug: "bare" }));
  assert.deepEqual(resolveProject({ projectDir: dir }), { projectName: "Bare", expoOwner: "", expoSlug: "bare", source: "app.json" });
});

test("resolveProject without app.json, or with a broken one, falls back", () => {
  const empty = fresh("empty");
  assert.deepEqual(resolveProject({ projectDir: empty }), { projectName: "App", expoOwner: "", expoSlug: "", source: "flags" });
  const broken = fresh("broken");
  writeFileSync(join(broken, "app.json"), "{ nope");
  assert.equal(readAppJson(broken), null);
  assert.equal(resolveProject({ projectDir: broken }).projectName, "App");
  assert.equal(resolveProject({ projectDir: join(broken, "missing-dir") }).projectName, "App");
  assert.equal(resolveProject({ projectDir: broken, name: "Given" }).projectName, "Given");
});

test("resolveProject ignores non-string app.json fields", () => {
  const dir = fresh("types");
  writeFileSync(join(dir, "app.json"), JSON.stringify({ expo: { name: null, slug: 4, owner: {} } }));
  const r = resolveProject({ projectDir: dir });
  assert.equal(r.projectName, "App");
  assert.equal(r.expoSlug, "");
  assert.equal(r.expoOwner, "");
});

// --- deploy ------------------------------------------------------------------

test("parseDeployOutput prefers the alias url and skips progress lines", () => {
  const out = 'Uploading...\n✔ done\n{"url":"https://x--abc.expo.app","aliases":[{"url":"https://x--pr-1.expo.app"}]}\n';
  assert.deepEqual(parseDeployOutput(out), { url: "https://x--pr-1.expo.app", aliasUrl: "https://x--pr-1.expo.app", deploymentUrl: "https://x--abc.expo.app" });
  assert.deepEqual(parseDeployOutput('{"url":"https://only.expo.app"}'), { url: "https://only.expo.app", aliasUrl: "", deploymentUrl: "https://only.expo.app" });
  assert.deepEqual(parseDeployOutput('{"url":"https://d.expo.app","aliases":[]}').url, "https://d.expo.app");
  assert.throws(() => parseDeployOutput("nothing"), /no JSON/);
  assert.throws(() => parseDeployOutput("{}"), /no URL/);
  assert.throws(() => parseDeployOutput('{"aliases":[{}]}'), /no URL/);
});

test("deploySite passes a relative export dir and the alias to eas-cli", () => {
  const projectDir = fresh("proj");
  const siteDir = join(projectDir, "evidence", "site");
  mkdirSync(siteDir, { recursive: true });
  let call;
  const r = deploySite({
    siteDir, alias: "pr-1-evidence", projectDir, easCliVersion: "24.0.0", log: quiet,
    exec: (file, args, options) => { call = { file, args, options }; return 'progress\n{"url":"https://u","aliases":[{"url":"https://a"}]}'; },
  });
  assert.equal(r.url, "https://a");
  assert.equal(call.file, "npx");
  assert.deepEqual(call.args, ["--yes", "eas-cli@24.0.0", "deploy", "--export-dir", "evidence/site", "--non-interactive", "--json", "--alias", "pr-1-evidence"]);
  assert.equal(call.options.cwd, projectDir);
});

test("deploySite without an alias, and with a site outside the project dir", () => {
  const projectDir = fresh("proj2");
  const siteDir = join(fresh("elsewhere"), "site");
  mkdirSync(siteDir, { recursive: true });
  let args;
  deploySite({ siteDir, projectDir, log: quiet, exec: (_f, a) => { args = a; return '{"url":"https://u"}'; } });
  assert.ok(!args.includes("--alias"));
  const exportDir = args[args.indexOf("--export-dir") + 1];
  assert.match(exportDir, /^\.\.\//, "relative path climbs out of the project dir");
  assert.throws(() => deploySite({ log: quiet, exec: () => "" }), /siteDir is required/);
});

test("deploySite surfaces eas-cli failures", () => {
  const projectDir = fresh("proj3");
  assert.throws(() => deploySite({ siteDir: join(projectDir, "site"), projectDir, log: quiet, exec: () => { throw new Error("Not authorized"); } }), /Not authorized/);
  assert.throws(() => deploySite({ siteDir: join(projectDir, "site"), projectDir, log: quiet, exec: () => "no json" }), /no JSON/);
});
