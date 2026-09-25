import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KEYWORDS,
  normalizeVerdict,
  verdictKind,
  parseVerdict,
  verdictBadge,
} from "../src/verdict.mjs";

test("every keyword passes through unchanged", () => {
  for (const k of KEYWORDS) {
    assert.equal(normalizeVerdict(`${k}: detail`), `${k}: detail`);
  }
});

test("a keyword with no colon or detail still counts", () => {
  assert.equal(normalizeVerdict("PASS"), "PASS");
  assert.equal(normalizeVerdict("FAIL"), "FAIL");
  assert.equal(verdictKind("PASS"), "pass");
  assert.equal(parseVerdict("PASS").detail, "PASS");
});

test("surrounding whitespace is trimmed", () => {
  assert.equal(normalizeVerdict("   PASS: ok   "), "PASS: ok");
  assert.equal(normalizeVerdict("\tFAIL: no\r"), "FAIL: no");
});

test("a stacked keyword chain collapses to the last one", () => {
  assert.equal(normalizeVerdict("PASS: FAIL: count stuck"), "FAIL: count stuck");
  assert.equal(normalizeVerdict("FAIL: PASS: it worked"), "PASS: it worked");
  assert.equal(normalizeVerdict("PASS: FAIL: PASS: REPLICATED: x"), "REPLICATED: x");
  assert.equal(normalizeVerdict("PASS:FAIL:x"), "FAIL:x");
});

test("a PASS line that mentions FAIL is a FAIL", () => {
  assert.equal(normalizeVerdict("PASS: no — FAIL: the toggle did not update"), "FAIL: the toggle did not update");
  assert.equal(normalizeVerdict("PASS: it FAILED on step 2"), "FAIL: it FAILED on step 2");
  assert.equal(normalizeVerdict("PASS: the failure case was handled"), "PASS: the failure case was handled", "lowercase 'fail' inside a word does not flip it");
});

test("a line with a FAIL: somewhere in it is a FAIL", () => {
  assert.equal(normalizeVerdict("Result — FAIL: the app crashed"), "FAIL: the app crashed");
});

test("only the first line counts", () => {
  assert.equal(normalizeVerdict("PASS: ok\nFAIL: this is the report"), "PASS: ok");
  assert.equal(normalizeVerdict("\n\nPASS: ok"), "FAIL: malformed verdict line: ", "an empty first line is malformed");
});

test("lowercase keywords are not keywords", () => {
  assert.match(normalizeVerdict("pass: ok"), /^FAIL: malformed/);
});

test("malformed lines become the fallback keyword, capped in length", () => {
  assert.equal(normalizeVerdict("looks fine to me"), "FAIL: malformed verdict line: looks fine to me");
  assert.equal(normalizeVerdict("", "INCONCLUSIVE"), "INCONCLUSIVE: malformed verdict line: ");
  assert.equal(normalizeVerdict(null), "FAIL: malformed verdict line: ");
  assert.equal(normalizeVerdict(undefined), "FAIL: malformed verdict line: ");
  const long = "x".repeat(1000);
  assert.equal(normalizeVerdict(long).length, "FAIL: malformed verdict line: ".length + 160);
});

test("non-string input is coerced", () => {
  assert.equal(normalizeVerdict(42), "FAIL: malformed verdict line: 42");
  assert.equal(normalizeVerdict({ toString: () => "PASS: obj" }), "PASS: obj");
});

test("kinds", () => {
  assert.equal(verdictKind("PASS: x"), "pass");
  assert.equal(verdictKind("NOT-REPLICATED: x"), "pass");
  assert.equal(verdictKind("FAIL: x"), "fail");
  assert.equal(verdictKind("REPLICATED: x"), "replicated");
  assert.equal(verdictKind("CONFIRMED: x"), "replicated");
  assert.equal(verdictKind("INCONCLUSIVE: x"), "neutral");
  assert.equal(verdictKind("garbage"), "fail", "malformed lines fail closed");
});

test("parse: label, detail, keyword", () => {
  const p = parseVerdict("NOT-REPLICATED: the crash did not happen");
  assert.equal(p.keyword, "NOT-REPLICATED");
  assert.equal(p.label, "NOT REPLICATED");
  assert.equal(p.detail, "the crash did not happen");
  assert.equal(p.kind, "pass");
  assert.equal(p.line, "NOT-REPLICATED: the crash did not happen");
});

test("parse flags the screenshot a failing verdict names, in any spelling", () => {
  assert.equal(parseVerdict("FAIL: Screenshot 3 shows the count stuck").flaggedScreenshot, 3);
  assert.equal(parseVerdict("FAIL: see screenshot #12").flaggedScreenshot, 12);
  assert.equal(parseVerdict("FAIL: SCREENSHOT 2").flaggedScreenshot, 2);
  assert.equal(parseVerdict("REPLICATED: screenshot 1 has the bug").flaggedScreenshot, 1);
  assert.equal(parseVerdict("FAIL: screenshots 2 and 3").flaggedScreenshot, null, "'screenshots N' is not a single screenshot");
  assert.equal(parseVerdict("FAIL: screenshot 0").flaggedScreenshot, null, "0 is not a tile");
  assert.equal(parseVerdict("PASS: Screenshot 2 looks right").flaggedScreenshot, null);
  assert.equal(parseVerdict("INCONCLUSIVE: Screenshot 2 is blank").flaggedScreenshot, null);
});

test("badge adds the status emoji", () => {
  assert.equal(verdictBadge("PASS: ok"), "✅ PASS: ok");
  assert.equal(verdictBadge("FAIL: no"), "❌ FAIL: no");
  assert.equal(verdictBadge("REPLICATED: bug"), "🐞 REPLICATED: bug");
  assert.equal(verdictBadge("CONFIRMED: idea"), "💡 CONFIRMED: idea");
  assert.equal(verdictBadge("NOT-REPLICATED: fine"), "🟢 NOT-REPLICATED: fine");
  assert.equal(verdictBadge("INCONCLUSIVE: ?"), "⚪ INCONCLUSIVE: ?");
  assert.equal(verdictBadge("PASS: FAIL: x"), "❌ FAIL: x", "the badge normalizes first");
});

test("unicode and html in the detail survive", () => {
  const p = parseVerdict("PASS: “quotes” <b>&amp;</b> ✓ 日本語");
  assert.equal(p.detail, "“quotes” <b>&amp;</b> ✓ 日本語");
});
