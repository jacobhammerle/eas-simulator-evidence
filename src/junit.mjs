// One JUnit test case per run, so any CI shows the verdict in its own UI.
//
//   junitXml({ subject, verdict, kind, siteDir, url, durationMs, report })
//
// pass and replicated-as-expected map to a passing case; fail maps to a
// <failure>; neutral (INCONCLUSIVE) maps to <skipped>, which CI shows
// without turning the build red.
import { parseVerdict } from "./verdict.mjs";

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function junitXml({
  subject = "run",
  verdict = "",
  siteDir = "",
  url = "",
  durationMs = null,
  report = "",
  suite = "eas-simulator-evidence",
  timestamp = new Date().toISOString(),
} = {}) {
  const v = parseVerdict(verdict);
  const seconds = Number.isFinite(durationMs) ? (durationMs / 1000).toFixed(3) : "0";
  const failures = v.kind === "fail" ? 1 : 0;
  const skipped = v.kind === "neutral" ? 1 : 0;
  const out = [siteDir && `Evidence site: ${siteDir}`, url && `URL: ${url}`, report].filter(Boolean).join("\n");
  const body =
    v.kind === "fail"
      ? `    <failure message="${esc(v.line)}" type="${esc(v.keyword)}">${esc(v.detail)}</failure>\n`
      : v.kind === "neutral"
        ? `    <skipped message="${esc(v.line)}"/>\n`
        : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="1" failures="${failures}" skipped="${skipped}">
  <testsuite name="${esc(suite)}" tests="1" failures="${failures}" errors="0" skipped="${skipped}" time="${seconds}" timestamp="${esc(timestamp)}">
    <testcase name="${esc(subject)}" classname="${esc(suite)}" time="${seconds}">
${body}${out ? `    <system-out>${esc(out)}</system-out>\n` : ""}    </testcase>
  </testsuite>
</testsuites>
`;
}
