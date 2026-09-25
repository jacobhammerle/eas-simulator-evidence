// The pull-request comment. One shape for every run so a reviewer learns
// it once: a heading, the verdict with its status emoji, a short list of
// links, a row of thumbnails, the report folded away, a footer.
//
//   commentMarkdown({ dir, siteUrl, verdict, report, title, agent, lines, max })
//
// GitHub and GitLab both render this. Pipe it to `gh pr comment --body-file -`
// or `glab mr note -m "$(...)"`.
import { thumbsHtml } from "./thumbs.mjs";
import { normalizeVerdict, verdictBadge } from "./verdict.mjs";

export function commentMarkdown({
  dir,
  siteUrl = "",
  verdict = "",
  report = "",
  title = "Simulator evidence",
  agent = "",
  lines = [],
  max = 4,
  footer,
} = {}) {
  const line = normalizeVerdict(verdict);
  const parts = [`## 🤖 ${title}`, "", `**Verdict:** ${verdictBadge(line)}`];
  const bullets = [];
  if (siteUrl) bullets.push(`- 🖼️ **Evidence** — ${siteUrl}`);
  for (const l of lines || []) if (l) bullets.push(l.startsWith("- ") ? l : `- ${l}`);
  if (bullets.length) parts.push("", ...bullets);
  const thumbs = siteUrl ? thumbsHtml({ dir, siteUrl, max }) : "";
  if (thumbs) parts.push("", thumbs);
  const text = String(report || "").replace(/\r\n?/g, "\n").trim();
  if (text) parts.push("", "<details>", "<summary>Full report</summary>", "", text, "", "</details>");
  const foot = footer ?? (agent ? `_Posted by ${agent}._` : "");
  if (foot) parts.push("", foot);
  return parts.join("\n") + "\n";
}
