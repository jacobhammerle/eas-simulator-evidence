// The verdict grammar. One line, a leading keyword, then a summary:
//
//   PASS: the checklist toggle updated the count
//   FAIL: Screenshot 3 shows the count stuck at 4 of 9
//   REPLICATED: the crash from issue #7 happens on first launch
//
// Every reader of a verdict (the CLI, the page, a CI comment) goes through
// this module so all of them agree on what a line means.

export const KEYWORDS = [
  "PASS",
  "FAIL",
  "REPLICATED",
  "NOT-REPLICATED",
  "CONFIRMED",
  "INCONCLUSIVE",
];

const KW = `(?:${KEYWORDS.join("|")})`;

// Agents do not always write line 1 cleanly. Seen in practice:
//   "PASS: FAIL: ..."       the prompt's '"PASS: ..." or "FAIL: ..."' copied as one line
//   "PASS: no — FAIL: ..."  a pass sentence that turns into a fail
// Rules:
//   - a chain of leading keywords collapses to the LAST one; the keyword
//     next to the summary is the one the agent meant
//   - a PASS line that still says FAIL is a FAIL
//   - a known keyword passes through unchanged
//   - anything else is malformed and becomes "<fallback>: malformed ..."
export function normalizeVerdict(line, fallback = "FAIL") {
  let s = String(line ?? "")
    .split(/\r?\n/)[0]
    .trim();
  s = s.replace(new RegExp(`^(?:${KW}:\\s*)+(?=${KW}:)`), "");
  if (/^PASS:.*FAIL:/.test(s)) return `FAIL: ${s.replace(/^.*FAIL:\s*/, "")}`;
  if (/^PASS:.*FAIL/.test(s)) return `FAIL: ${s.replace(/^PASS:\s*/, "")}`;
  if (new RegExp(`^${KW}(?::|\\b)`).test(s)) return s;
  if (/FAIL:/.test(s)) return `FAIL: ${s.replace(/^.*FAIL:\s*/, "")}`;
  return `${fallback}: malformed verdict line: ${s.slice(0, 160)}`;
}

// pass | fail | replicated | neutral. Drives the page's status pill and the
// comment badge.
export function verdictKind(line) {
  const s = normalizeVerdict(line);
  if (/^(PASS|NOT-?REPLICATED)/i.test(s)) return "pass";
  if (/^(REPLICATED|CONFIRMED)/i.test(s)) return "replicated";
  if (/^FAIL/i.test(s)) return "fail";
  return "neutral";
}

// "PASS: all good" -> { keyword: "PASS", label: "PASS", detail: "all good" }
export function parseVerdict(line) {
  const s = normalizeVerdict(line);
  const keyword = s.match(/^[A-Za-z-]+/)?.[0] ?? "RESULT";
  return {
    line: s,
    kind: verdictKind(s),
    keyword: keyword.toUpperCase(),
    label: keyword.toUpperCase().replace(/-/g, " "),
    detail: s.replace(/^[A-Za-z-]+\s*:?\s*/, "") || s,
    // A failing verdict that names "Screenshot N" flags that tile.
    flaggedScreenshot:
      /^(FAIL|REPLICATED)/i.test(s)
        ? Number(s.match(/screenshot\s*#?\s*(\d+)/i)?.[1]) || null
        : null,
  };
}

const EMOJI = {
  PASS: "✅",
  FAIL: "❌",
  REPLICATED: "🐞",
  CONFIRMED: "💡",
  "NOT-REPLICATED": "🟢",
};

// "PASS: all good" -> "✅ PASS: all good". For CI comments.
export function verdictBadge(line) {
  const { line: s, keyword } = parseVerdict(line);
  return `${EMOJI[keyword] || "⚪"} ${s}`;
}
