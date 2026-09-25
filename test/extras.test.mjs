// sweep, comment, junit
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { sweepSessions, listLiveSessions } from "../src/sweep.mjs";
import { commentMarkdown } from "../src/comment.mjs";
import { junitXml } from "../src/junit.mjs";
import { fixture, recorder, quiet, cleanOut } from "./helpers.mjs";

after(cleanOut);

// --- sweep -----------------------------------------------------------------

const T0 = Date.parse("2026-09-25T12:00:00Z");
const sess = (id, name, minutesOld, status = "IN_PROGRESS") => ({
  id, name, status, type: "web-preview-only", createdAt: new Date(T0 - minutesOld * 60000).toISOString(),
});

function fakeEas(pages, calls) {
  let page = 0;
  return async (args) => {
    calls.push(args);
    if (args[0] === "simulator:list") {
      const p = pages[page++] || { sessions: [], pageInfo: { hasNextPage: false } };
      return p;
    }
    if (args[0] === "simulator:stop") return { id: args[2], status: "STOPPED" };
    throw new Error(`unexpected ${args[0]}`);
  };
}

test("sweep stops only matching sessions older than the limit", async () => {
  const calls = [];
  const rec = recorder();
  const r = await sweepSessions({
    olderThanMin: 30, now: () => T0, log: rec,
    eas: fakeEas([{ sessions: [
      sess("old-preview", "PR #12 · evidence-site preview", 45),
      sess("young-preview", "PR #13 · evidence-site preview", 5),
      sess("demo", "Live demo for a customer", 400),
      sess("caps", "PR #14 · EVIDENCE-SITE PREVIEW", 31),
    ], pageInfo: { hasNextPage: false } }], calls),
  });
  assert.deepEqual(r.stopped, ["old-preview", "caps"]);
  assert.deepEqual(r.kept, ["young-preview"]);
  assert.deepEqual(r.candidates, ["old-preview", "young-preview", "caps"]);
  assert.equal(r.listed, 4);
  assert.deepEqual(calls[0].slice(0, 7), ["simulator:list", "--status", "new", "--status", "in-progress", "--limit", "100"]);
  assert.deepEqual(calls[0].slice(7), ["--type", "web-preview-only"]);
  assert.deepEqual(calls.filter((c) => c[0] === "simulator:stop").map((c) => c[2]), ["old-preview", "caps"]);
  assert.ok(rec.logs.some((l) => /stopped old-preview/.test(l)));
  assert.ok(rec.logs.some((l) => /keep\s+young-preview/.test(l)));
});

test("sweep --dry-run lists but does not stop; a 0 limit stops everything matching", async () => {
  let calls = [];
  const r = await sweepSessions({ olderThanMin: 30, dryRun: true, now: () => T0, log: quiet, eas: fakeEas([{ sessions: [sess("a", "x · evidence-site preview", 60)] }], calls) });
  assert.deepEqual(r.stopped, ["a"]);
  assert.equal(r.dryRun, true);
  assert.ok(!calls.some((c) => c[0] === "simulator:stop"));
  calls = [];
  const r2 = await sweepSessions({ olderThanMin: 0, now: () => T0, log: quiet, eas: fakeEas([{ sessions: [sess("b", "y · evidence-site preview", 0)] }], calls) });
  assert.deepEqual(r2.stopped, ["b"]);
});

test("sweep follows pagination and survives a failing stop or list", async () => {
  const calls = [];
  const r = await sweepSessions({
    olderThanMin: 1, now: () => T0, log: quiet,
    eas: async (args) => {
      calls.push(args);
      if (args[0] === "simulator:list") {
        if (!args.includes("--after")) return { sessions: [sess("p1", "a · evidence-site preview", 10)], pageInfo: { hasNextPage: true, endCursor: "c1" } };
        return { sessions: [sess("p2", "b · evidence-site preview", 10)], pageInfo: { hasNextPage: false } };
      }
      if (args[2] === "p2") throw new Error("Not authorized\nstack");
      return {};
    },
  });
  assert.deepEqual(r.stopped, ["p1"]);
  assert.deepEqual(r.failed, ["p2"]);
  assert.ok(calls.some((c) => c.includes("--after") && c.includes("c1")));

  const rec = recorder();
  const r2 = await sweepSessions({ log: rec, eas: async () => { throw new Error("boom"); } });
  assert.deepEqual(r2, { listed: 0, candidates: [], stopped: [], kept: [], failed: [], dryRun: false });
  assert.match(rec.logs[0], /simulator:list failed: boom/);
});

test("sweep tolerates odd list shapes and missing timestamps", async () => {
  const r = await sweepSessions({ olderThanMin: 30, now: () => T0, log: quiet, eas: async (a) => (a[0] === "simulator:list" ? [{ id: "x", name: "z · evidence-site preview" }] : {}) });
  assert.deepEqual(r.stopped, ["x"], "no createdAt counts as infinitely old");
  assert.deepEqual(await listLiveSessions({ eas: async () => null }), []);
  assert.deepEqual(await listLiveSessions({ eas: async () => ({ items: [{ id: "i" }] }) }), [{ id: "i" }]);
});

// --- comment ---------------------------------------------------------------

test("commentMarkdown has the fixed shape", () => {
  const md = commentMarkdown({
    dir: fixture, siteUrl: "https://e.com/site/", verdict: "PASS: FAIL: the count stuck",
    report: "Line one\n\nLine two", title: "Agent verification", agent: "expo-bot",
    lines: ["📡 **Channel** — `pr-12`", "- already a bullet"], max: 2,
  });
  assert.equal(md, `## 🤖 Agent verification

**Verdict:** ❌ FAIL: the count stuck

- 🖼️ **Evidence** — https://e.com/site/
- 📡 **Channel** — \`pr-12\`
- already a bullet

<a href="https://e.com/site/1-checklist.png"><img src="https://e.com/site/1-checklist.png" alt="Checklist" title="Checklist" width="150" /></a> <a href="https://e.com/site/2-task-toggled-on.png"><img src="https://e.com/site/2-task-toggled-on.png" alt="Task toggled on" title="Task toggled on" width="150" /></a>

<details>
<summary>Full report</summary>

Line one

Line two

</details>

_Posted by expo-bot._
`);
});

test("commentMarkdown drops what it does not have", () => {
  const md = commentMarkdown({ verdict: "PASS: ok" });
  assert.equal(md, "## 🤖 Simulator evidence\n\n**Verdict:** ✅ PASS: ok\n");
  const withFooter = commentMarkdown({ verdict: "PASS: ok", footer: "custom" });
  assert.match(withFooter, /\ncustom\n$/);
  const noThumbs = commentMarkdown({ dir: fixture, verdict: "PASS: ok" });
  assert.doesNotMatch(noThumbs, /<img/, "no site url, no thumbnails");
});

// --- junit -----------------------------------------------------------------

test("junitXml maps kinds to pass, failure, and skipped", () => {
  const pass = junitXml({ subject: "PR #12", verdict: "PASS: ok", siteDir: "/s", url: "https://u", durationMs: 106639, timestamp: "T" });
  assert.match(pass, /<testsuites tests="1" failures="0" skipped="0">/);
  assert.match(pass, /<testcase name="PR #12" classname="eas-simulator-evidence" time="106\.639">/);
  assert.match(pass, /<system-out>Evidence site: \/s\nURL: https:\/\/u<\/system-out>/);
  assert.doesNotMatch(pass, /<failure|<skipped/);
  assert.match(pass, /timestamp="T"/);

  const fail = junitXml({ subject: "x", verdict: 'FAIL: Screenshot 2 shows "<bad>" & more' });
  assert.match(fail, /failures="1"/);
  assert.match(fail, /<failure message="FAIL: Screenshot 2 shows &quot;&lt;bad&gt;&quot; &amp; more" type="FAIL">Screenshot 2 shows &quot;&lt;bad&gt;&quot; &amp; more<\/failure>/);

  const skip = junitXml({ subject: "x", verdict: "INCONCLUSIVE: no idea" });
  assert.match(skip, /skipped="1"/);
  assert.match(skip, /<skipped message="INCONCLUSIVE: no idea"\/>/);

  const rep = junitXml({ subject: "x", verdict: "REPLICATED: bug seen" });
  assert.match(rep, /failures="0" skipped="0"/, "a replicated bug is the expected outcome of a repro run");

  const none = junitXml({ subject: "x", verdict: "PASS: ok" });
  assert.match(none, /time="0"/);
  assert.doesNotMatch(none, /system-out/);
});
